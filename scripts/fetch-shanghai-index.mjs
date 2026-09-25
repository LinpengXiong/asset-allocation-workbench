const response = await fetch("https://qt.gtimg.cn/q=sh000001", {
  headers: { "user-agent": "Mozilla/5.0" },
});
if (!response.ok) throw new Error(`Tencent quote HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
const text = new TextDecoder("gb18030").decode(bytes);
const match = text.match(/="([^"]+)"/);
if (!match) throw new Error("Unexpected Tencent quote response");
const fields = match[1].split("~");
const value = Number(fields[3]);
const observedRaw = fields[30];
const changePct = Number(fields[32]);
if (!Number.isFinite(value) || !/^\d{14}$/.test(observedRaw)) throw new Error("Incomplete quote payload");
const observedAt = `${observedRaw.slice(0, 4)}-${observedRaw.slice(4, 6)}-${observedRaw.slice(6, 8)}T${observedRaw.slice(8, 10)}:${observedRaw.slice(10, 12)}:${observedRaw.slice(12, 14)}+08:00`;
console.log(JSON.stringify({
  name: "上证指数",
  code: "000001.SH",
  value,
  changePct,
  observedAt,
  sourceUrl: "https://qt.gtimg.cn/q=sh000001",
}, null, 2));
