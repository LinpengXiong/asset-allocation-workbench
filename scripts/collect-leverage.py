"""Emit leverage observations from CNBS and BIS primary downloads as JSON."""

import csv
import io
import json
import re
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import openpyxl


cnbs_url = "http://114.115.232.154:8080/"
landing = urlopen(cnbs_url, timeout=30).read().decode("utf-8", "ignore")
form = {name: re.search(r'name="' + name + r'"[^>]*value="([^"]+)', landing).group(1)
        for name in ("__VIEWSTATE", "__VIEWSTATEGENERATOR")}
form.update({"__EVENTTARGET": "RegionPanel1$leftRegion$ctl00$btnDownload", "__EVENTARGUMENT": ""})
binary = urlopen(Request(cnbs_url, data=urlencode(form).encode()), timeout=30).read()
book = openpyxl.load_workbook(io.BytesIO(binary), read_only=True, data_only=True)
china = []
for row in list(book["Data"].values)[2:]:
    if not isinstance(row[0], datetime):
        continue
    quarter = (row[0].month - 1) // 3 + 1
    china.append({
        "period": f"{row[0].year}-Q{quarter}",
        "household": row[1], "corporate": row[2],
        "centralGovernment": row[3], "localGovernment": row[4],
        "government": row[5], "sourceUrl": cnbs_url,
    })

# CNBS/NIFD quarterly reports. Later reports have superseded a few initial
# observations by 0.1 percentage point; below are the revised figures.
nifd = [
    ("2025-Q1", 61.5, 173.7, 26.5, 36.8, 63.3, "4728"),
    ("2025-Q2", 61.1, 174.0, 27.6, 37.8, 65.3, "4728"),
    ("2025-Q3", 60.4, 174.4, 28.8, 38.7, 67.5, "4788"),
    ("2025-Q4", 59.4, 174.7, 29.4, 39.1, 68.5, "4896"),
    ("2026-Q1", 59.0, 180.0, 29.9, 40.4, 70.3, "4896"),
    ("2026-Q2", 57.7, 179.5, 30.5, 40.4, 71.0, "4976"),
]
for period, household, corporate, central, local, government, report_id in nifd:
    china.append({"period": period, "household": household, "corporate": corporate,
                  "centralGovernment": central, "localGovernment": local,
                  "government": government,
                  "sourceUrl": f"http://www.nifd.cn/SeriesReport/Details/{report_id}"})

keys = {
    "corporateAdvanced": "Q.5R.N.A.M.770.A",
    "corporateEmerging": "Q.4T.N.A.M.770.A",
    "householdAdvanced": "Q.5R.H.A.M.770.A",
    "householdEmerging": "Q.4T.H.A.M.770.A",
    "governmentAdvanced": "Q.5R.G.A.N.770.A",
    "governmentEmerging": "Q.4T.G.A.N.770.A",
}
bis = {}
for name, key in keys.items():
    url = f"https://stats.bis.org/api/v2/data/dataflow/BIS/WS_TC/2.0/{key}?format=csv&startPeriod=2011-Q1"
    response = urlopen(Request(url, headers={"User-Agent": "asset-allocation-workbench/1.0"}), timeout=40)
    rows = list(csv.DictReader(io.TextIOWrapper(response, encoding="utf-8")))
    bis[name] = {"key": key, "url": url, "rows": [
        {"period": row["TIME_PERIOD"], "value": float(row["OBS_VALUE"])}
        for row in rows if row.get("OBS_VALUE")
    ]}

print(json.dumps({
    "unit": "%",
    "chinaSource": "国家金融与发展实验室国家资产负债表研究中心（CNBS）季度杠杆率原始下载及后续 NIFD 季报",
    "bisSource": "BIS Total Credit Statistics, credit-to-GDP, break-adjusted; 企业和居民为市值口径，政府为名义口径",
    "note": "中外为不同机构口径，仅作趋势对照；部分中国季度数据以后续报告修订值为准。BIS 对照序列只更新到已发布的 2026-Q1。",
    "china": china, "bis": bis,
}, ensure_ascii=False, separators=(",", ":")))
