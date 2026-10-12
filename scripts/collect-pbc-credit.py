"""Extract verified monthly credit observations from PBC original releases.

Refreshes the derived JSON snapshot. The 2023 releases
alternate between monthly and year-to-date departmental breakdowns.
"""

import concurrent.futures
import json
import re
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


ids = {
    2023: [
        "2025092212553076752", "2025092212553043320", "2025092212553128690",
        "2025092212553299625", "2025092212553223669", "2025092212553392665",
        "2025092212553361129", "2025092212553479819", "2025092212553465205",
        "2025092212553553490", "2025092212553629758", "2025092212553684550",
    ],
    2024: [
        "2025092212553720837", "2025092212553782501", "2025092212553942589",
        "2025092212554025225", "2025092212554128681", "2025092212554139432",
        "2025092212554232639", "2025092212554212585", "2025092212554385951",
        "2025092212554352381", "2025092212554425517", "2025092212554556876",
    ],
    2025: [
        "2025092212554572702", "2025092212554596450", "2025092212554667292",
        "2025092212554748591", "2025092212554778119", "2025092212554857593",
        "2025092212554853258", "5837479", "5868082", "5899343",
        "2025121215073692061", "2026011509294440745",
    ],
    2026: [
        "2026021314205610794", "2026031314240986260", "2026041311133582598",
        "2026051414253144700", "2026061214273613328", "2026071512340454869",
        "2026081414193264304", "2026091414593871200",
    ],
}


def amount(text):
    match = re.search(r"(增加|减少)([\d.]+)(万亿元|亿元)", text)
    if not match:
        raise ValueError(f"amount not found: {text[:90]}")
    value = float(match.group(2)) * (10000 if match.group(3) == "万亿元" else 1)
    return round(value * (-1 if match.group(1) == "减少" else 1))


def get_one(year, month, identifier):
    url = f"https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/{identifier}/index.html"
    for attempt in range(4):
        try:
            raw = urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read()
            break
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt * 2)
    parser = PlainText()
    parser.feed(raw.decode("utf-8", "ignore"))
    text = " ".join(parser.parts)
    section = re.search(r"分部门看，住户贷款.*?非银行业金融机构贷款", text, re.S)
    if not section:
        raise ValueError(f"department breakdown not found: {url}")
    sections = section.group().split("企（事）业单位贷款")
    if len(sections) != 2:
        raise ValueError(f"enterprise breakdown not found: {url}")
    home = sections[0]
    firm = sections[1]
    fields = {}
    for prefix, segment in (("household", home), ("enterprise", firm)):
        for maturity, label in (("short", "短期贷款"), ("long", "中长期贷款")):
            match = re.search(label + r"(增加|减少)[\d.]+(?:万亿元|亿元)", segment)
            if not match:
                raise ValueError(f"{prefix} {label} missing: {url}")
            fields[f"{prefix}{maturity.title()}"] = amount(match.group())
    # Read the heading in each original report, not just the indicator labels.
    # In 2023, non-quarterly reports explicitly describe the departmental
    # breakdown for that month; quarter-end reports describe year-to-date.
    reported_basis = "month" if year == 2023 and month in (1, 2, 4, 5, 7, 8, 10, 11) else "ytd"
    return {"period": f"{year}-{month:02d}", **fields, "reportedBasis": reported_basis, "url": url}


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    futures = [pool.submit(get_one, year, month, identifier)
               for year, year_ids in ids.items()
               for month, identifier in enumerate(year_ids, 1)]
    rows = sorted((future.result() for future in futures), key=lambda row: row["period"])

for index, row in enumerate(rows):
    previous = rows[index - 1] if index and rows[index - 1]["period"][:4] == row["period"][:4] else None
    for field in ("householdShort", "householdLong", "enterpriseShort", "enterpriseLong"):
        reported = row[field]
        if row["reportedBasis"] == "month":
            row[f"{field}Ytd"] = reported + (previous[f"{field}Ytd"] if previous else 0)
        else:
            row[f"{field}Ytd"] = reported
            row[field] = reported - (previous[f"{field}Ytd"] if previous else 0)

data = {
    "unit": "亿元",
    "basis": "金融机构人民币贷款分部门新增额；2023年部分原报为当月值，其余当月值由同年累计值差分；累计披露金额有舍入误差",
    "sources": "中国人民银行月度金融统计数据报告",
    "rows": rows,
}
target = Path(__file__).resolve().parents[1] / "app/data/macro-finance-credit.json"
target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(f"Updated {len(rows)} monthly periods")
