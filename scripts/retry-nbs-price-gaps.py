#!/usr/bin/env python3
"""Retry NBS original pages listed as temporary fetch failures in an audit JSON."""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

COLLECTOR = Path(__file__).with_name("collect-nbs-price-history.py")
SPEC = importlib.util.spec_from_file_location("nbs_prices", COLLECTOR)
assert SPEC and SPEC.loader
NBS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NBS)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.input.read_text())
    tasks = []
    for row in data["rows"]:
        period = row["period"]
        year, month = map(int, period.split("-"))
        for note in row.get("auditNotes", []):
            url = note.get("source", "")
            if NBS.valid_article_url(url):
                entry = {"url": url, "titleO": f"{year}年{month}月份数据发布"}
                tasks.append((period, entry))
    values: dict[str, dict[str, tuple[float, str]]] = {}
    unique_pages: dict[str, list[str]] = {}
    for period, entry in tasks:
        unique_pages.setdefault(entry["url"], []).append(period)

    def read_page(url: str):
        body = NBS.clean_text(NBS.get(url))
        return url, body

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = [pool.submit(read_page, url) for url in unique_pages]
        for future in as_completed(futures):
            try:
                url, body = future.result()
            except Exception:
                continue
            for period in set(unique_pages[url]):
                row = next(row for row in data["rows"] if row["period"] == period)
                year, month = map(int, period.split("-"))
                if "cpi" not in row:
                    value = NBS.parse_article_value(body, "cpi")
                    if value is not None:
                        values.setdefault(period, {})["cpi"] = (value, url)
                if "ppi" not in row:
                    value = NBS.parse_article_value(body, "ppi")
                    if value is not None:
                        values.setdefault(period, {})["ppi"] = (value, url)
                if "coreCpi" not in row:
                    patterns = (
                        r"扣除食品和能源(?:价格)?(?:后)?的?核心\s*CPI.{0,70}?同比(上涨|上升|增长|下降|持平)",
                        r"核心\s*CPI.{0,60}?同比(上涨|上升|增长|下降|持平)",
                    )
                    for pattern in patterns:
                        match = re.search(pattern, body)
                        if not match:
                            continue
                        if match.group(1) == "持平":
                            value = 0.0
                        else:
                            amount = re.match(r"\s*" + NBS.NUMBER_PATTERN + r"\s*%", body[match.end():])
                            value = float(amount.group(1)) if amount else None
                            if value is not None and match.group(1) == "下降":
                                value = -value
                        if value is not None:
                            values.setdefault(period, {})["coreCpi"] = (value, url)
                            break
    for row in data["rows"]:
        for family, (value, url) in values.get(row["period"], {}).items():
            row.setdefault(family, value)
            row.setdefault(f"{family}Url", url)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print("retried", len(unique_pages), "official source pages; recovered", sum(map(len, values.values())), "observations")


if __name__ == "__main__":
    main()
