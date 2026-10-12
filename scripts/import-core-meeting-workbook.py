#!/usr/bin/env python3
"""Mechanically preserve the user's core-meeting workbook for the dashboard."""

import json
import sys
from pathlib import Path

import openpyxl


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: import-core-meeting-workbook.py INPUT.xlsx OUTPUT.json")

    source = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    workbook = openpyxl.load_workbook(source, read_only=True, data_only=False)
    sheets = []
    for sheet in workbook.worksheets:
        grid = [
            ["" if value is None else str(value) for value in row]
            for row in sheet.iter_rows(values_only=True)
        ]
        sheets.append({"name": sheet.title, "grid": grid})

    payload = {
        "sourceName": source.name,
        "status": "用户提供的研究原稿；逐格保留原文，尚未逐项核验。官方会议事实与原稿观点分开展示。",
        "sheets": sheets,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Preserved {len(sheets)} sheets from {source.name} in {output}")


if __name__ == "__main__":
    main()
