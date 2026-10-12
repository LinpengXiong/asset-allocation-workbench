import fs from "node:fs/promises";
import path from "node:path";

const file = path.join(process.cwd(), "collector/latest-payload.json");
const payload = JSON.parse(await fs.readFile(file, "utf8"));
const response = await fetch("https://qt.gtimg.cn/q=sh000001", { headers: { "user-agent": "Mozilla/5.0" } });
if (!response.ok) throw new Error(`Tencent quote HTTP ${response.status}`);
const raw = new TextDecoder("gb18030").decode(new Uint8Array(await response.arrayBuffer()));
const match = raw.match(/="([^"]+)"/);
if (!match) throw new Error("Unexpected Tencent quote response");
const fields = match[1].split("~");
const value = Number(fields[3]);
const changePct = Number(fields[32]);
const timestamp = fields[30];
if (!Number.isFinite(value) || !Number.isFinite(changePct) || !/^\d{14}$/.test(timestamp)) {
  throw new Error("Incomplete Tencent quote");
}
const asOf = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
const observedAt = `${asOf}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}+08:00`;
if (asOf < payload.asOf) throw new Error(`Quote ${asOf} is older than local payload ${payload.asOf}`);
const sourceId = `tencent-sh000001-${timestamp.slice(0, 8)}`;
payload.asOf = asOf;
payload.collectedAt = observedAt;
payload.status = "partial";
payload.index = { name: "上证指数", code: "000001.SH", value, changePct, observedAt, sourceId };
payload.sources = payload.sources.filter((source) => source.id !== sourceId);
payload.sources.unshift({ id: sourceId, title: "上证指数行情", publisher: "腾讯财经",
  url: "https://qt.gtimg.cn/q=sh000001", observedAt,
  note: "指数行情快照；其余因子、现仓和评分沿用上一期数据。" });
payload.notes = [...new Set([`指数截至 ${asOf}；19 项大类因子与 6 项风格因子未随本次行情更新，已核验因子的研究证据主要截至 2026 年 7 月。`, ...payload.notes])];
await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ asOf, value, changePct, factorsPreserved: payload.factors.length,
  styleFactorsPreserved: payload.styleFactors.length, file }));
