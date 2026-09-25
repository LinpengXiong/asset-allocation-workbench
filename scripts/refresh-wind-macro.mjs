import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const cli = process.env.WIND_CLI_PATH || path.join(process.env.HOME, ".agents/skills/wind-mcp-skill/scripts/cli.mjs");
const node = process.env.WIND_NODE_PATH || process.execPath;
const advisory = JSON.parse(await fs.readFile(path.join(root, "app/data/advisory.json"), "utf8"));
const indicators = advisory.macroIndicators ?? [];

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr.slice(0, 400) || `Wind CLI exit ${code}`)));
  });
}

const frequency = { 日度: "日", 日: "日", 周度: "周", 周: "周", 月度: "月", 月: "月", 季度: "季", 季: "季", 年度: "年", 年: "年" };
const normalize = (value) => String(value ?? "").toLowerCase().replace(/[：:（）()、，,\s]/g, "").replace(/同比|环比/g, "");
const freqOf = (value) => frequency[String(value ?? "")] ?? String(value ?? "");
const parseMetrics = (raw) => JSON.parse(raw.content?.find((item) => item.type === "text")?.text ?? "{}").metrics ?? [];

const decisions = [];
for (const indicator of indicators) {
  const decision = { id: indicator.id, name: indicator.name, frequency: indicator.frequency, expectedSource: indicator.expectedSource, matched: false, fallback: "" };
  try {
    const raw = await run(["call", "economic_data", "search_economic_indicator", JSON.stringify({ question: `中国 ${indicator.name}` })]);
    const metrics = parseMetrics(raw);
    const exact = metrics.filter((metric) => {
      const name = normalize(indicator.name);
      const metricName = normalize(metric.name);
      const nameMatch = metricName.includes(name) || name.includes(metricName);
      const unitMatch = !indicator.unit || !metric.unit || normalize(indicator.unit) === normalize(metric.unit);
      const freqMatch = !indicator.frequency || freqOf(indicator.frequency) === freqOf(metric.freq);
      const sourceMatch = !indicator.expectedSource || !metric.source || normalize(indicator.expectedSource).includes(normalize(metric.source)) || normalize(metric.source).includes(normalize(indicator.expectedSource));
      return nameMatch && unitMatch && freqMatch && sourceMatch;
    });
    if (exact.length !== 1) {
      decision.fallback = exact.length === 0 ? "无唯一名称/单位/频率/来源一致的 Wind 指标" : "存在多个同口径候选，需人工确认";
    } else {
      const metric = exact[0];
      try {
        const values = parseMetrics(await run(["call", "economic_data", "query_economic_indicator_data", JSON.stringify({ question: metric.code, observation: "1" })]));
        const value = values[0];
        if (!value?.date?.length || !value?.value?.length) decision.fallback = "Wind 指标无可用观测值";
        else { decision.matched = true; decision.wind = { code: metric.code, name: metric.name, unit: metric.unit, freq: metric.freq, source: metric.source, date: value.date.at(-1), value: value.value.at(-1) }; }
      } catch { decision.fallback = "Wind 取值失败，保留现有数据"; }
    }
  } catch { decision.fallback = "Wind 搜索失败，保留现有数据"; }
  decisions.push(decision);
  console.error(`${decisions.length}/${indicators.length} ${indicator.id} ${decision.matched ? "matched" : "fallback"}`);
}
const report = { generatedAt: new Date().toISOString(), policy: "仅唯一且名称/单位/频率/来源一致并有观测值的指标标记 matched；不直接改写 payload 或评分。", summary: { total: decisions.length, matched: decisions.filter((item) => item.matched).length, fallback: decisions.filter((item) => !item.matched).length }, decisions };
const output = process.env.WIND_MACRO_REPORT || path.join(root, "output", "wind-macro-refresh-report.json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.summary, output }));
