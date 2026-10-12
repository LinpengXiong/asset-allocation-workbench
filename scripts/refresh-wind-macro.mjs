import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const cli = process.env.WIND_CLI_PATH || path.join(process.env.HOME, ".agents/skills/wind-mcp-skill/scripts/cli.mjs");
const node = process.env.WIND_NODE_PATH || process.execPath;
const advisory = JSON.parse(await fs.readFile(path.join(root, "app/data/advisory.json"), "utf8"));
const pendingOnly = process.argv.includes("--pending");
const indicators = (advisory.macroIndicators ?? []).filter((item) => !pendingOnly || item.status === "待采集");
const output = process.env.WIND_MACRO_REPORT || path.join(root, "output", "wind-macro-refresh-report.json");

function run(tool, params) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [cli, "call", "economic_data", tool, JSON.stringify(params)], {
      stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.slice(0, 400) || `Wind CLI exit ${code}`));
      try {
        const envelope = JSON.parse(stdout);
        if (envelope.ok === false || envelope.isError) throw new Error(`${envelope.code ?? "backend_error"}: ${envelope.message ?? "Wind 调用失败"}`);
        const responseText = envelope.content?.find((item) => item.type === "text")?.text ?? "";
        if (responseText.startsWith("没有搜索到指标")) return resolve([]);
        const body = JSON.parse(responseText);
        if (!Array.isArray(body.metrics)) throw new Error("Wind 返回内容缺少 metrics");
        resolve(body.metrics);
      } catch (error) { reject(error); }
    });
  });
}

const previous = process.argv.includes("--resume")
  ? JSON.parse(await fs.readFile(output, "utf8"))
  : { decisions: [] };
const decisions = previous.decisions ?? [];
try {
  for (const indicator of indicators) {
    if (decisions.some((item) => item.id === indicator.id)) continue;
    const candidates = await run("search_economic_indicator", { question: `中国 ${indicator.name}` });
    decisions.push({ id: indicator.id, name: indicator.name, frequency: indicator.frequency,
      expectedSource: indicator.expectedSource, candidates });
    console.error(`${decisions.length}/${indicators.length} ${indicator.id}: ${candidates.length} candidates`);
  }
} finally {
  const report = { generatedAt: new Date().toISOString(),
    policy: "候选仅供逐项核对名称、单位、频率和来源；未自动改写指标库或评分。",
    summary: { requested: indicators.length, searched: decisions.length }, decisions };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report.summary, output }));
}
