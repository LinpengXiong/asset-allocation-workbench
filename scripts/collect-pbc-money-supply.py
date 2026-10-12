"""Collect PBC monthly M0/M1/M2 growth rates from official historical tables and reports."""

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CREDIT = json.loads((ROOT / "app/data/macro-finance-credit.json").read_text())

# PBC annual Money Supply tables. The M2 method was revised for 2017 in 2018;
# use the PBC's recompiled 2017 balances in the 2018 table when present.
TABLES = {
    2016: "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2017/01/2017011618241733781.htm",
    2017: "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2018/04/2018041812261055101.htm",
    2018: "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2019/01/2019011619032875652.htm",
    2019: "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2020/01/2020011716393273983.htm",
    2020: "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2021/01/2021011817552169087.htm",
    2021: "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2022/01/2022011716025879078.htm",
    2022: "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2023/01/2023011616255071886.htm",
    2023: "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2024/01/2024011616043249340.htm",
    2024: "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2025/01/2025011417034089529.htm",
}
REVISED_2022_M0 = [18.5, 5.8, 10.0, 11.5, 13.5, 13.9, 13.9, 14.3, 13.6, 14.4, 14.1, 15.3]
REVISED_2024_M1 = [3.3, 2.6, 2.3, 0.6, -0.8, -1.7, -2.6, -3.0, -3.3, -2.3, -0.7, 1.2]
PBC_M1_REVISION = "https://www.pbc.gov.cn/diaochatongjisi/attachDir/2025/11/2025111913535682666.pdf"
PBC_M0_REVISION = "https://www.pbc.gov.cn/diaochatongjisi/fileDir/resource/cms/2024/11/2024111416041159339.htm"


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, _attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ""

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(self.cell.split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def get(url):
    for attempt in range(4):
        try:
            return urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=25).read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt * 2)


def numeric_cells(row):
    return [float(cell.replace(",", "")) for cell in row if re.fullmatch(r"[\d,]+(?:\.\d+)?", cell)]


def parse_table(year, raw):
    parser = TableParser()
    parser.feed(raw.decode("gb18030", "ignore"))
    rows = []
    for row in parser.rows:
        values = numeric_cells(row)
        if len(values) != 12:
            continue
        if any("2017." in cell or "2018." in cell or "2016." in cell or "2019." in cell or "2020." in cell or "2021." in cell or "2022." in cell for cell in row):
            continue
        rows.append((row, values))
    # The official table layout places M2, M1, and M0 as three consecutive rows
    # containing twelve balances each. Nearby footnote tables are excluded by
    # requiring the first M2 row to contain balances on a consistent scale.
    candidates = [values for _, values in rows]
    if len(candidates) < 3:
        raise ValueError(f"Could not identify M2/M1/M0 rows for {year}")
    m2 = max(candidates, key=max)
    m1 = max((values for values in candidates if values is not m2 and max(values) < max(m2) * .5), key=max)
    m0 = max((values for values in candidates if values is not m2 and values is not m1 and max(values) < 200_000), key=max)
    return {month: {"m0": m0[month - 1], "m1": m1[month - 1], "m2": m2[month - 1]} for month in range(1, 13)}


def parse_report(row):
    text_parser = TableParser()
    raw = get(row["url"])
    class Text(HTMLParser):
        def __init__(self):
            super().__init__(); self.parts = []
        def handle_data(self, data): self.parts.append(data)
    parser = Text(); parser.feed(raw.decode("utf-8", "ignore"))
    text = " ".join(" ".join(parser.parts).split())
    found = {}
    patterns = {
        "m2": r"广义货币(?:（|\()M2(?:）|\))余额[^。]{0,100}?同比增长([\d.]+)%",
        "m1": r"狭义货币(?:（|\()M1(?:）|\))余额[^。]{0,100}?同比增长([\d.]+)%",
        "m0": r"流通中货币(?:（|\()M0(?:）|\))余额[^。]{0,100}?同比增长([\d.]+)%",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, text)
        if not match:
            raise ValueError(f"{key} growth not found in {row['url']}")
        found[key] = float(match.group(1))
    year, month = map(int, row["period"].split("-"))
    return {"period": row["period"], **found, "sourceUrl": row["url"]}


with ThreadPoolExecutor(max_workers=2) as pool:
    table_results = dict(zip(TABLES, pool.map(get, TABLES.values())))
tables = {year: parse_table(year, raw) for year, raw in table_results.items()}

rows = []
for year in range(2017, 2025):
    for month in range(1, 13):
        current = tables[year][month]
        prior = tables[year - 1][month]
        growth = {key: round((current[key] / prior[key] - 1) * 100, 1) for key in ("m0", "m1", "m2")}
        if year == 2022:
            growth["m0"] = REVISED_2022_M0[month - 1]
        rows.append({"period": f"{year}-{month:02d}", **growth, "sourceUrl": TABLES[year]})

recent = [row for row in CREDIT["rows"] if int(row["period"][:4]) == 2023 or int(row["period"][:4]) >= 2025]
with ThreadPoolExecutor(max_workers=2) as pool:
    rows.extend(pool.map(parse_report, recent))
rows_by_period = {row["period"]: row for row in rows}
rows = [rows_by_period[period] for period in sorted(rows_by_period)]

# Replace the legacy M1 series with PBC's comparable, retrospectively revised
# monthly 2024 growth rates. Leave the two methods visibly separated in UI.
for row in rows:
    if row["period"].startswith("2024-"):
        month = int(row["period"][-2:])
        row["m1"] = REVISED_2024_M1[month - 1]
        row["m1Basis"] = "revised-2024"
    elif row["period"] < "2024-01":
        row["m1Basis"] = "legacy"
    else:
        row["m1Basis"] = "revised"
    row["scissors"] = round(row["m1"] - row["m2"], 1)

data = {
    "unit": "%",
    "basis": "月末余额同比；M1于2025年调整统计范围，2024年为央行回溯可比增速；2023-12旧口径与2024-01新口径之间断线。M0自2022-12起含流通中数字人民币。",
    "m1RevisionSource": PBC_M1_REVISION,
    "m0RevisionSource": PBC_M0_REVISION,
    "rows": rows,
}
(ROOT / "app/data/macro-money-supply.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(f"Wrote {len(rows)} official monthly rows ({rows[0]['period']} to {rows[-1]['period']})")
