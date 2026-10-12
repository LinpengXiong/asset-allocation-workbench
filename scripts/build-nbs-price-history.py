#!/usr/bin/env python3
"""Assemble a continuous monthly calendar from audited NBS monthly releases.

Unverified observations remain null; the plot deliberately shows gaps instead
of interpolating. This script only merges original NBS-source audit snapshots.
"""

from __future__ import annotations

import json
from pathlib import Path


def read_rows(path: str) -> dict[str, dict]:
    data = json.loads(Path(path).read_text())
    return {row["period"]: {key: value for key, value in row.items() if key != "auditNotes"} for row in data["rows"]}


def main() -> None:
    rows: dict[str, dict] = {}
    for path in (
        "/private/tmp/nbs-price-audit-2012-2014.json",
        "/private/tmp/nbs-price-audit-2010-2019.json",
        "/private/tmp/nbs-price-audit-2020-2026.json",
    ):
        rows.update(read_rows(path))

    # The 2010 and 2011 NBS statistical bulletins publish the full monthly
    # national CPI year-on-year series as charts. Keep these values tied to
    # those official source pages rather than substituting annual averages.
    cpi_bulletins = {
        2010: (
            [1.5, 2.7, 2.4, 2.8, 3.1, 2.9, 3.3, 3.5, 3.6, 4.4, 5.1, 4.6],
            "https://www.stats.gov.cn/xxgk/sjfb/tjgb2020/201310/P020200617516947609878.PDF",
        ),
        2011: (
            [4.9, 4.9, 5.4, 5.3, 5.5, 6.4, 6.5, 6.2, 6.1, 5.5, 4.2, 4.1],
            "https://www.stats.gov.cn/xxgk/sjfb/tjgb2020/201310/P020200617516948221768.PDF",
        ),
    }
    for year, (values, url) in cpi_bulletins.items():
        for month, value in enumerate(values, start=1):
            rows.setdefault(f"{year}-{month:02d}", {"period": f"{year}-{month:02d}"}).update({
                "cpi": value,
                "cpiUrl": url,
            })

    # Officially verified 2010 monthly PPI observations. Values not yet
    # matched to a same-month original release remain null in the calendar.
    ppi_2010 = {
        "2010-01": (2.6, "https://gdzd.stats.gov.cn/dcsj/wjzs/gysczccjgzs/201003/t20100303_8391.html"),
        "2010-02": (5.4, "https://www.stats.gov.cn/sj/zxfb/202303/t20230301_1919188.html"),
        "2010-03": (5.9, "https://www.stats.gov.cn/sj/xwfbh/fbhwd/202303/t20230301_1919195.html"),
        "2010-04": (6.8, "https://www.miit.gov.cn/gxsj/tjfx/zh/art/2020/art_c9a68533ac9643aca419686cbe02fdc2.html"),
        "2010-05": (7.1, "https://www.stats.gov.cn/sj/zxfb/202303/t20230301_1919201.html"),
        "2010-06": (6.4, "https://www.stats.gov.cn/sj/xwfbh/fbhwd/202303/t20230301_1919207.html"),
        "2010-07": (4.8, "https://www.stats.gov.cn/sj/zxfb/202303/t20230301_1919214.html"),
        "2010-08": (4.3, "https://www.stats.gov.cn/sj/zxfb/202303/t20230301_1919218.html"),
        "2010-09": (4.3, "https://www.stats.gov.cn/sj/xwfbh/fbhwd/202303/t20230301_1919224.html"),
        "2010-12": (5.9, "https://www.stats.gov.cn/sj/zxfb/202303/t20230301_1919238.html"),
    }
    for period, (value, url) in ppi_2010.items():
        rows.setdefault(period, {"period": period}).update({"ppi": value, "ppiUrl": url})

    # Two omissions in the official search-index capture, verified against
    # their original monthly releases.
    rows.setdefault("2015-01", {"period": "2015-01"}).update({
        "cpi": 0.8,
        "cpiUrl": "https://www.stats.gov.cn/sj/zxfb/202302/t20230203_1898695.html",
        "ppi": -4.3,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202302/t20230203_1898696.html",
    })
    rows.setdefault("2024-01", {"period": "2024-01"}).update({
        "cpi": -0.8,
        "cpiUrl": "https://www.stats.gov.cn/sj/zxfb/202402/t20240208_1947623.html",
        "ppi": -2.5,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202402/t20240208_1947624.html",
        "coreCpi": 0.4,
        "coreCpiUrl": "https://www.stats.gov.cn/sj/zxfb/202402/t20240208_1947625.html",
    })
    rows.setdefault("2024-04", {"period": "2024-04"}).update({
        "ppi": -2.5,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202405/t20240511_1950304.html",
    })
    rows.setdefault("2024-05", {"period": "2024-05"}).update({
        "ppi": -1.4,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202406/t20240612_1954520.html",
    })
    rows.setdefault("2024-06", {"period": "2024-06"}).update({
        "ppi": -0.8,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202407/t20240710_1955509.html",
    })
    rows.setdefault("2024-07", {"period": "2024-07"}).update({
        "cpi": 0.5,
        "cpiUrl": "https://www.stats.gov.cn/sj/zxfb/202408/t20240809_1955948.html",
        "ppi": -0.8,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202408/t20240809_1955986.html",
    })
    rows.setdefault("2024-08", {"period": "2024-08"}).update({
        "ppi": -1.8,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202409/t20240909_1956310.html",
    })
    rows.setdefault("2024-09", {"period": "2024-09"}).update({
        "ppi": -2.8,
        "ppiUrl": "https://www.stats.gov.cn/zwfwck/sjfb/202410/t20241013_1956898.html",
    })
    rows.setdefault("2024-10", {"period": "2024-10"}).update({
        "ppi": -2.9,
        "ppiUrl": "https://www.stats.gov.cn/zwfwck/sjfb/202411/t20241109_1957352.html",
        "coreCpi": 0.2,
        "coreCpiUrl": "https://www.stats.gov.cn/sj/sjjd/202411/t20241115_1957470.html",
    })
    rows.setdefault("2024-09", {"period": "2024-09"}).update({
        "coreCpi": 0.1,
        "coreCpiUrl": "https://www.stats.gov.cn/sj/sjjd/202411/t20241115_1957470.html",
    })
    rows.setdefault("2024-11", {"period": "2024-11"}).update({
        "ppi": -2.5,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202412/t20241209_1957688.html",
    })
    rows.setdefault("2024-12", {"period": "2024-12"}).update({
        "ppi": -2.3,
        "ppiUrl": "https://www.stats.gov.cn/zwfwck/sjfb/202501/t20250109_1958169.html",
        "coreCpi": 0.4,
        "coreCpiUrl": "https://www.stats.gov.cn/sj/sjjd/202501/t20250117_1958346.html",
    })
    rows.setdefault("2025-01", {"period": "2025-01"}).update({
        "ppi": -2.3,
        "ppiUrl": "https://www.stats.gov.cn/zwfwck/sjfb/202502/t20250209_1958645.html",
    })
    rows.setdefault("2025-02", {"period": "2025-02"}).update({
        "ppi": -2.2,
        "ppiUrl": "https://www.stats.gov.cn/zwfwck/sjfb/202503/t20250309_1958914.html",
    })
    rows.setdefault("2025-08", {"period": "2025-08"}).update({
        "ppi": -2.9,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202509/t20250910_1961108.html",
    })
    rows.setdefault("2025-09", {"period": "2025-09"}).update({
        "ppi": -2.3,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfbhjd/202510/t20251015_1961520.html",
    })
    rows.setdefault("2025-10", {"period": "2025-10"}).update({
        "ppi": -2.1,
        "ppiUrl": "https://www.stats.gov.cn/zs/tjwh/tjkw/tjqk/zgxxb/202511/P020251111320050348958.pdf",
    })
    rows.setdefault("2025-11", {"period": "2025-11"}).update({
        "ppi": -2.2,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202512/t20251210_1962014.html",
        "coreCpi": 1.2,
        "coreCpiUrl": "https://www.stats.gov.cn/sj/zxfbhjd/202512/t20251210_1962013.html",
    })
    rows.setdefault("2025-10", {"period": "2025-10"}).update({
        "coreCpi": 1.2,
        "coreCpiUrl": "https://www.stats.gov.cn/sj/zxfbhjd/202511/t20251109_1961821.html",
    })
    rows.setdefault("2025-12", {"period": "2025-12"}).update({
        "ppi": -1.9,
        "ppiUrl": "https://www.stats.gov.cn/zs/tjwh/tjkw/tjqk/zgxxb/202601/P020260112309892559292.pdf",
    })
    rows.setdefault("2026-01", {"period": "2026-01"}).update({
        "ppi": -1.4,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202602/t20260211_1962587.html",
    })
    rows.setdefault("2026-02", {"period": "2026-02"}).update({
        "ppi": -0.9,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfb/202603/t20260309_1962729.html",
    })
    rows.setdefault("2026-03", {"period": "2026-03"}).update({
        "ppi": 0.5,
        "ppiUrl": "https://www.stats.gov.cn/sj/zxfbhjd/202604/t20260410_1963265.html",
    })
    rows.setdefault("2025-07", {"period": "2025-07"}).update({
        "ppi": -3.6,
        "ppiUrl": "https://www.stats.gov.cn/sj/sjjd/202508/t20250809_1960633.html",
    })
    rows.setdefault("2025-06", {"period": "2025-06"}).update({
        "coreCpi": 0.7,
        "coreCpiUrl": "https://www.stats.gov.cn/zs/tjwh/tjkw/tjqk/zgxxb/202508/P020250825563811558707.pdf",
    })
    rows.setdefault("2025-07", {"period": "2025-07"}).update({
        "coreCpi": 0.8,
        "coreCpiUrl": "https://www.stats.gov.cn/zs/tjwh/tjkw/tjqk/zgxxb/202508/P020250818329475224130.pdf",
    })
    rows.setdefault("2025-09", {"period": "2025-09"}).update({
        "coreCpi": 1.0,
        "coreCpiUrl": "https://www.stats.gov.cn/sj/sjjd/202510/t20251015_1961519.html",
    })
    rows.setdefault("2025-12", {"period": "2025-12"}).update({
        "coreCpi": 1.2,
        "coreCpiUrl": "https://www.stats.gov.cn/xxgk/jd/sjjd2020/202601/t20260119_1962341.html",
    })
    rows.setdefault("2026-08", {"period": "2026-08"}).update({
        "coreCpi": 1.0,
        "coreCpiUrl": "https://www.stats.gov.cn/xxgk/jd/sjjd2020/202609/t20260909_1965261.html",
    })

    # Additional single-month core CPI values checked against original NBS
    # releases. Do not substitute two-month or half-year averages for monthly
    # observations when an exact monthly value is not explicitly published.
    core_cpi_overrides = {
        "2021-02": (0.0, "https://www.stats.gov.cn/sj/sjjd/202302/t20230202_1896457.html"),
        "2021-03": (0.3, "https://www.stats.gov.cn/sj/sjjd/202302/t20230202_1896465.html"),
        "2023-01": (1.0, "https://www.stats.gov.cn/sj/sjjd/202302/t20230223_1918384.html"),
        "2023-02": (0.6, "https://www.stats.gov.cn/sj/sjjd/202303/t20230309_1936954.html"),
        "2023-04": (0.7, "https://www.stats.gov.cn/sj/sjjd/202305/t20230511_1939346.html"),
        "2023-07": (0.8, "https://www.stats.gov.cn/sj/sjjd/202308/t20230809_1941865.html"),
        "2023-12": (0.6, "https://www.stats.gov.cn/sj/sjjd/202401/t20240112_1946467.html"),
        "2024-02": (1.2, "https://www.stats.gov.cn/sj/sjjd/202403/t20240318_1947993.html"),
        "2024-03": (0.6, "https://www.stats.gov.cn/sj/sjjd/202404/t20240411_1948497.html"),
        "2024-04": (0.7, "https://www.stats.gov.cn/sj/sjjd/202405/t20240511_1950306.html"),
        "2024-05": (0.6, "https://www.stats.gov.cn/sj/sjjd/202406/t20240612_1954521.html"),
        "2024-06": (0.6, "https://www.stats.gov.cn/xxgk/jd/sjjd2020/202407/t20240710_1955510.html"),
        "2024-07": (0.4, "https://www.stats.gov.cn/zwfwck/sjfb/202408/t20240809_1955950.html"),
        "2024-11": (0.3, "https://www.stats.gov.cn/sj/sjjd/202412/t20241216_1957773.html"),
        "2025-01": (0.6, "https://www.stats.gov.cn/sj/sjjd/202502/t20250209_1958644.html"),
        "2025-03": (0.5, "https://www.stats.gov.cn/sj/sjjd/202504/t20250410_1959259.html"),
        "2025-04": (0.5, "https://www.stats.gov.cn/sj/sjjd/202505/t20250510_1959769.html"),
        "2025-05": (0.6, "https://www.stats.gov.cn/sj/sjjd/202506/t20250609_1960092.html"),
        "2025-06": (0.7, "https://www.stats.gov.cn/sj/zxfb/202507/t20250715_1960414.html"),
        "2025-08": (0.9, "https://www.stats.gov.cn/sj/sjjd/202509/t20250910_1961105.html"),
        "2026-01": (0.8, "https://www.stats.gov.cn/sj/sjjd/202602/t20260211_1962586.html"),
        "2026-02": (1.8, "https://www.stats.gov.cn/sj/sjjd/202603/t20260309_1962728.html"),
        "2026-03": (1.1, "https://www.stats.gov.cn/sj/sjjd/202604/t20260416_1963332.html"),
        "2026-04": (1.2, "https://www.stats.gov.cn/sj/sjjd/202605/t20260511_1963657.html"),
        "2026-05": (1.1, "https://www.stats.gov.cn/sj/sjjd/202606/t20260610_1963924.html"),
        "2026-06": (1.0, "https://www.stats.gov.cn/sj/zxfbhjd/202607/t20260709_1964082.html"),
        "2026-07": (0.9, "https://www.stats.gov.cn/sj/sjjd/202608/t20260809_1965009.html"),
    }
    for period, (value, url) in core_cpi_overrides.items():
        rows.setdefault(period, {"period": period}).update({"coreCpi": value, "coreCpiUrl": url})

    periods = []
    year, month = 2010, 1
    while (year, month) <= (2026, 8):
        periods.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1

    output = []
    for period in periods:
        row = rows.get(period, {"period": period})
        row["period"] = period
        row["scissors"] = round(row["ppi"] - row["cpi"], 1) if row.get("ppi") is not None and row.get("cpi") is not None else None
        output.append(row)

    latest_price_period = max(row["period"] for row in output if row.get("cpi") is not None and row.get("ppi") is not None)
    latest_core_period = max(row["period"] for row in output if row.get("coreCpi") is not None)
    result = {
        "description": "国家统计局原始月度发布；CPI/PPI/核心CPI均为当月同比（%），剪刀差为同月PPI同比减CPI同比（百分点）；未经核验的月份留空、不插值。",
        "sourcePriority": "official-original-release-only",
        "latestPeriod": latest_price_period,
        "latestCorePeriod": latest_core_period,
        "basis": "当月同比；剪刀差按同月同比直接相减",
        "seriesNotes": [
            "2010—2011年CPI来自国家统计局年度统计公报所附月度同比图；2011年CPI更换对比基期并调整权数。PPI自2011年1月改用新的调查制度、分类目录及权数，观察长序列时应注意制度口径断点。",
            "2026年CPI、PPI开展基期轮换，但同比口径仍为当月对上年同月；原始发布链接按月保留。",
            "国家统计局公开官方材料没有稳定提供全时期逐月核心CPI单一下载表；未能从官方逐月原文核实的月份保留空值。",
        ],
        "rows": output,
    }
    path = Path("app/data/macro-price-history.json")
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    missing = {key: sum(row.get(key) is None for row in output) for key in ("cpi", "ppi", "coreCpi", "scissors")}
    print(f"saved {path}: {len(output)} monthly rows; latest monthly CPI/PPI={latest_price_period}; latest core CPI={latest_core_period}; missing={missing}")


if __name__ == "__main__":
    main()
