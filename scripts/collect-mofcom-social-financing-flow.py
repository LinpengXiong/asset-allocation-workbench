"""Fetch the official MOFCOM-hosted monthly AFRE flow table (source: PBC)."""

import http.client
import json
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "app/data/macro-social-financing.json"
SOURCE_URL = "https://data.mofcom.gov.cn/gnmy/shrzgm.shtml"
API_URL = "https://data.mofcom.gov.cn/datamofcom/front/gnmy/shrzgmDateQuery"
START = "202001"
END = date.today().strftime("%Y%m")

request = Request(
    API_URL,
    data=f"start_date={START}&end_date={END}".encode(),
    headers={
        "User-Agent": "Mozilla/5.0",
        "Referer": SOURCE_URL,
        "Content-Type": "application/x-www-form-urlencoded",
    },
    method="POST",
)
response = urlopen(request, timeout=30)
try:
    payload = response.read()
except http.client.IncompleteRead as error:
    payload = error.partial

source_rows = json.loads(payload)
rows = [
    {"period": f"{row['date'][:4]}-{row['date'][4:6]}", "total": row["tiosfs"], "sourceUrl": SOURCE_URL}
    for row in source_rows
    if row.get("date", "") >= START and row.get("tiosfs") is not None
]
rows.sort(key=lambda row: row["period"])
if not rows or rows[0]["period"] != "2020-01":
    raise SystemExit("Official monthly AFRE flow series did not return the expected 2020-01 start.")
if len({row["period"] for row in rows}) != len(rows):
    raise SystemExit("Official monthly AFRE flow series contains duplicate months.")

data = json.loads(DATA_PATH.read_text())
data["monthlyIncrement"] = {
    "provider": "商务部公共商务信息服务（数据来源：中国人民银行）",
    "unit": "亿元",
    "basis": "社会融资规模当月增量；流量值，正负方向均保留。数据接口返回缺少的月份不插值。",
    "sourceUrl": SOURCE_URL,
    "fetchedAt": date.today().isoformat(),
    "coverageStart": rows[0]["period"],
    "coverageEnd": rows[-1]["period"],
    "rows": rows,
}
DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(f"Updated {len(rows)} official monthly AFRE-flow observations: {rows[0]['period']}–{rows[-1]['period']}.")
