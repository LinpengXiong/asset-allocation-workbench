#!/usr/bin/env python3
"""Collect 70-city second-hand home MoM indices from original NBS monthly tables.

Run with the bundled Python (which includes lxml). Search finds the original
release; only the release table supplies observations. Missing months stay blank.
"""

from __future__ import annotations

import argparse
import http.client
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from statistics import median

from lxml import html


SEARCH_URL = "https://api.so-gov.cn/query/s"
OUTPUT = Path(__file__).resolve().parents[1] / "app/data/macro-secondhand-price.json"
TITLE = re.compile(r"(20\d{2})年(\d{1,2})月(?:份)?70个大中城市商品住宅销售价格变动情况")
RELEASE = re.compile(r"/t(20\d{6})_")
VISIBLE_DATE = re.compile(r"\b(20\d{2})[/.-](\d{1,2})[/.-](\d{1,2})\b")


def fetch(url: str, data: bytes | None = None) -> bytes:
    last_error = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, data=data, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=45) as response:
                body = response.read()
            if len(body) < 1000:
                raise ValueError("short response")
            return body
        except (OSError, ValueError, http.client.IncompleteRead) as error:
            last_error = error
            time.sleep(0.7 * (attempt + 1))
    raise RuntimeError(f"unable to read {url}: {last_error}")


def find_release(period: str) -> str:
    year, month = map(int, period.split("-"))
    query = f"{year}年{month}月份70个大中城市商品住宅销售价格变动情况"
    payload = urllib.parse.urlencode({
        "siteCode": "bm36000002", "qt": query, "keyPlace": "1", "page": "1", "pageSize": "100",
    }).encode()
    results = json.loads(fetch(SEARCH_URL, payload)).get("resultDocs", [])
    for result in results:
        item = result.get("data", {})
        title = re.sub(r"<[^>]+>", "", item.get("title", ""))
        match = TITLE.search(re.sub(r"\s+", "", title))
        url = item.get("url", "")
        if match and (int(match[1]), int(match[2])) == (year, month) and url.startswith("https://www.stats.gov.cn/"):
            return url
    raise ValueError(f"official release not found for {period}")


def parse_release(period: str, url: str) -> dict:
    root = html.fromstring(fetch(url))
    title = "".join(root.xpath("//title//text()"))
    year, month = map(int, period.split("-"))
    if f"{year}年{month}月" not in re.sub(r"\s+", "", title):
        raise ValueError(f"release title does not match {period}: {title}")
    tables = root.xpath("//table")
    if len(tables) < 2:
        raise ValueError(f"second-hand price table missing: {period}")
    cities = []
    for row in tables[1].xpath(".//tr"):
        cells = ["".join(cell.xpath(".//text()")) for cell in row.xpath("./td|./th")]
        cells = [re.sub(r"\s+", "", cell).replace("\u3000", "") for cell in cells]
        if len(cells) == 8:
            for city, index in ((cells[0], cells[1]), (cells[4], cells[5])):
                if city and re.fullmatch(r"\d{2,3}(?:\.\d+)?", index):
                    cities.append({"city": city, "momIndex": float(index)})
    names = [item["city"] for item in cities]
    if len(cities) != 70 or len(set(names)) != 70:
        raise ValueError(f"expected 70 unique city MoM indices, got {len(cities)} for {period}")
    if any(not 80 <= item["momIndex"] <= 120 for item in cities):
        raise ValueError(f"implausible MoM index in {period}")
    visible_dates = []
    for match in VISIBLE_DATE.finditer(root.text_content()[:3000]):
        try:
            candidate = date(*map(int, match.groups()))
            if 0 <= (candidate.year - year) * 12 + candidate.month - month <= 3:
                visible_dates.append(candidate)
        except ValueError:
            pass
    release_date = min(visible_dates) if visible_dates else None
    if release_date is None:
        release = RELEASE.search(url)
        if release:
            candidate = date.fromisoformat(f"{release[1][:4]}-{release[1][4:6]}-{release[1][6:]}")
            if 0 <= (candidate.year - year) * 12 + candidate.month - month <= 3:
                release_date = candidate
    if release_date is None:
        raise ValueError(f"original publication date cannot be verified for {period}")
    return {
        "period": period, "releaseDate": release_date.isoformat(), "sourceUrl": url,
        "cities": cities, "medianMomPct": round(median(item["momIndex"] - 100 for item in cities), 3),
    }


def periods(start: str, end: str) -> list[str]:
    year, month = map(int, start.split("-"))
    last = tuple(map(int, end.split("-")))
    result = []
    while (year, month) <= last:
        result.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return result


def collect(period: str) -> dict:
    return parse_release(period, find_release(period))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2024-01")
    parser.add_argument("--end", default="2026-08")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    existing = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {"monthly": [], "gaps": []}
    by_period = {item["period"]: item for item in existing["monthly"]}
    wanted = periods(args.start, args.end)
    missing = [period for period in wanted if period not in by_period]
    gaps = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(collect, period): period for period in missing}
        for future in as_completed(futures):
            period = futures[future]
            try:
                by_period[period] = future.result()
                print(f"{period}: {by_period[period]['medianMomPct']:+.3f}%")
            except Exception as error:
                gaps[period] = str(error)
                print(f"{period}: missing ({error})")
    monthly = [by_period[period] for period in sorted(by_period)]
    for index, item in enumerate(monthly):
        window = monthly[max(0, index - 2):index + 1]
        expected = periods(window[0]["period"], item["period"])
        item["threeMonthMeanPct"] = round(sum(part["medianMomPct"] for part in window) / 3, 4) if len(window) == 3 and [part["period"] for part in window] == expected else None
    payload = {
        "name": "70城二手住宅价格环比中位数近3月均值（工作台计算）",
        "publisher": "国家统计局", "unit": "%", "frequency": "月度",
        "method": "逐月读取官方表2的70个城市二手住宅销售价格环比指数（上月=100）；各城指数减100，取70城中位数，再取连续3个月中位数的算术平均。不是国家统计局发布的全国房价指数。",
        "sourceSearch": SEARCH_URL, "monthly": monthly,
        "gaps": [{"period": period, "reason": gaps[period]} for period in sorted(gaps)],
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"saved {len(monthly)} official months, {len(gaps)} new gaps to {OUTPUT}")


if __name__ == "__main__":
    main()
