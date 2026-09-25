import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function loadEnv(file) {
  const values = {};
  const text = await fs.readFile(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const split = line.indexOf("=");
    values[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return values;
}

function parseCli(raw) {
  const envelope = JSON.parse(raw);
  const text = envelope.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Wind CLI returned no data");
  const payload = JSON.parse(text);
  if (!Array.isArray(payload.data?.rows) || !payload.data.rows.length) throw new Error("Wind index response has no rows");
  const columns = payload.data.columns.map((column) => column.name);
  return Object.fromEntries(columns.map((column, index) => [column, payload.data.rows[0][index]]));
}

async function runWindCli(cliPath, windcode) {
  const params = JSON.stringify({ windcode, indexes: "中文简称,最新交易日,交易时间,最新成交价,前收盘价,涨跌幅" });
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.WIND_NODE_PATH || process.execPath, [cliPath, "call", "index_data", "get_index_price_indicators", params], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(parseCli(stdout)) : reject(new Error(`Wind CLI failed (${code}): ${stderr.slice(0, 400)}`)));
  });
}

const args = process.argv.slice(2);
const publish = args.includes("--publish");
const windcode = args.find((arg) => !arg.startsWith("--")) || "000001.SH";
const projectRoot = process.cwd();
const envPath = process.env.COLLECTOR_ENV_FILE || path.join(projectRoot, ".collector.env");
const local = await loadEnv(envPath);
const siteUrl = process.env.SITE_URL || local.SITE_URL;
const updateToken = process.env.UPDATE_TOKEN || local.UPDATE_TOKEN;
if (!siteUrl || !updateToken) throw new Error("SITE_URL and UPDATE_TOKEN are required");
const cliPath = process.env.WIND_CLI_PATH || path.join(process.env.WIND_SKILL_DIR || `${process.env.HOME}/.agents/skills/wind-mcp-skill`, "scripts/cli.mjs");
const currentResponse = await fetch(`${siteUrl.replace(/\/$/, "")}/api/update`, { headers: { authorization: `Bearer ${updateToken}` } });
const currentResult = await currentResponse.json().catch(() => ({}));
if (!currentResponse.ok || !currentResult.payload) throw new Error(`Download current payload failed (${currentResponse.status})`);
const quote = await runWindCli(cliPath, windcode);
const observedAt = quote["交易时间"] || new Date().toISOString();
const date = String(quote["最新交易日"] || observedAt.slice(0, 10).replaceAll("-", ""));
const asOf = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
const value = Number(quote["最新成交价"]);
const previous = Number(quote["前收盘价"]);
if (!Number.isFinite(value) || !Number.isFinite(previous)) throw new Error("Wind quote value is not numeric");
const payload = structuredClone(currentResult.payload);
payload.asOf = asOf;
payload.collectedAt = observedAt;
payload.index = {
  ...payload.index,
  name: quote["中文简称"] || payload.index?.name || "上证指数",
  code: windcode,
  value,
  changePct: Number(quote["涨跌幅"]),
  observedAt,
  sourceId: `wind-index-${windcode}-${date}`,
};
payload.sources = Array.isArray(payload.sources) ? payload.sources : [];
payload.sources = payload.sources.filter((source) => source.id !== payload.index.sourceId);
payload.sources.unshift({
  id: payload.index.sourceId,
  title: `${payload.index.name} Wind 指数行情`,
  publisher: "Wind 金融数据服务",
  url: "https://mcp.wind.com.cn/vserver_index_data/mcp/",
  observedAt,
  note: "只更新指数快照；19 个大类因子、6 个风格因子及其评分沿用上一期 payload。",
});
const outputPath = process.env.WIND_OUTPUT_PATH || path.join(projectRoot, "collector", "latest-payload.json");
const tempPath = `${outputPath}.wind-tmp`;
await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(projectRoot, "scripts/validate-payload.mjs"), tempPath], { stdio: "inherit" });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Payload validation failed (${code})`)));
});
await fs.rename(tempPath, outputPath);
if (publish) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(projectRoot, "scripts/publish-data.mjs"), outputPath, envPath], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Publish failed (${code})`)));
  });
}
console.log(JSON.stringify({ provider: "wind", windcode, asOf, value, changePct: Number(quote["涨跌幅"]), published: publish, factorsPreserved: { factors: payload.factors.length, styleFactors: payload.styleFactors.length } }));
