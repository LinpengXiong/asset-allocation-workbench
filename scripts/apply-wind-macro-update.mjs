import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const advisoryPath = path.join(root, "app/data/advisory.json");
const auditPath = path.join(root, "output/wind-macro-values.json");
const advisory = JSON.parse(await fs.readFile(advisoryPath, "utf8"));
const audit = JSON.parse(await fs.readFile(auditPath, "utf8"));
const byCode = new Map(audit.metrics.map((metric) => [metric.meta.code, metric]));
const byId = new Map(advisory.macroIndicators.map((indicator) => [indicator.id, indicator]));

function series(code, source, unit) {
  const metric = byCode.get(code);
  if (!metric || metric.meta.source !== source || (unit && metric.meta.unit !== unit)) {
    throw new Error(`Wind series mismatch: ${code}`);
  }
  if (metric.date.length !== metric.value.length || !metric.date.length) throw new Error(`Invalid Wind observations: ${code}`);
  return metric;
}

function observation(metric, offset = 0) {
  const index = metric.date.length - 1 - offset;
  if (index < 0 || !Number.isFinite(metric.value[index])) throw new Error(`Missing observation: ${metric.meta.code}`);
  return { date: metric.date[index], value: metric.value[index] };
}

function period(date, frequency) {
  const year = date.slice(0, 4);
  const month = date.slice(4, 6);
  if (frequency === "季") return `${year} Q${Math.ceil(Number(month) / 3)}`;
  if (frequency === "月") return `${year}-${month}`;
  return `${year}-${month}-${date.slice(6, 8)}`;
}

function fill(id, code, options) {
  const metric = series(code, options.source, options.unit);
  const current = observation(metric);
  const previous = observation(metric, 1);
  const target = byId.get(id);
  if (!target || (target.status !== "待采集" && !target.currentSource?.includes(`Wind ${code}`))) {
    throw new Error(`Unexpected indicator state: ${id}`);
  }
  target.currentValue = options.format(current.value);
  target.prior = options.format(previous.value);
  target.period = period(current.date, metric.meta.freq);
  target.trend = options.trend(current.value, previous.value);
  target.score = options.score ?? null;
  target.currentSource = `${metric.meta.source}（Wind ${code}${options.note ? `；${options.note}` : ""}）`;
  target.status = "已核验";
}

const decimal = (digits, suffix = "") => (value) => `${value.toFixed(digits)}${suffix}`;
const direction = (current, previous) => current > previous ? "较上期上升" : current < previous ? "较上期下降" : "与上期持平";

fill("M04", "U6096599", { source: "世界银行", format: (value) => `${((value - 1) * 100).toFixed(2)}%`,
  trend: direction, score: 3, note: "基数=1，换算为较基准期百分比" });
fill("M12", "M0325601", { source: "中国货币网", unit: "点", format: decimal(2), trend: direction, score: 3 });
fill("M19", "M5786898", { source: "长江商学院", format: decimal(2), trend: direction, score: 2 });
fill("M25", "S0036034", { source: "国家统计局", unit: "%", format: decimal(1, "%"), trend: direction, score: 2 });
fill("M31", "S2707411", { source: "国家统计局", unit: "%", format: decimal(1, "%"), trend: direction, score: 1 });
fill("M41", "M0000607", { source: "海关总署", unit: "%", format: decimal(1, "%"), trend: direction, score: 5,
  note: "与美元出口金额系列 M0000606 配套" });
fill("M42", "M0000609", { source: "海关总署", unit: "%", format: decimal(1, "%"), trend: direction, score: 5,
  note: "与美元进口金额系列 M0000608 配套" });
fill("M62", "M1006337", { source: "中国货币网", unit: "%", format: decimal(4, "%"), trend: direction, score: 4 });
fill("M63", "M0041653", { source: "中国货币网", unit: "%", format: decimal(4, "%"), trend: direction, score: 4 });

const exports = series("M0000606", "海关总署", "亿美元");
const imports = series("M0000608", "海关总署", "亿美元");
const latestExports = observation(exports);
const latestImports = observation(imports);
const priorExports = observation(exports, 1);
const priorImports = observation(imports, 1);
if (latestExports.date !== latestImports.date || priorExports.date !== priorImports.date) throw new Error("Trade series dates differ");
const surplus = latestExports.value - latestImports.value;
const priorSurplus = priorExports.value - priorImports.value;
for (const id of ["M13", "M43"]) {
  const target = byId.get(id);
  if (target.status !== "待采集" && !target.currentSource?.includes("Wind M0000606 - M0000608")) {
    throw new Error(`Unexpected indicator state: ${id}`);
  }
  target.currentValue = decimal(2)(surplus);
  target.prior = decimal(2)(priorSurplus);
  target.period = period(latestExports.date, "月");
  target.trend = direction(surplus, priorSurplus);
  target.score = id === "M13" ? 2 : null;
  target.currentSource = "海关总署（Wind M0000606 - M0000608，亿美元）";
  target.status = "已核验";
}

const services = series("M5481116", "国家外汇管理局", "亿美元");
const serviceQuarters = new Map();
for (const [index, date] of services.date.entries()) {
  const key = period(date, "季");
  const quarter = serviceQuarters.get(key) ?? { count: 0, value: 0 };
  quarter.count += 1;
  quarter.value += services.value[index];
  serviceQuarters.set(key, quarter);
}
const completeServiceQuarters = [...serviceQuarters].filter(([, value]) => value.count === 3);
const [servicePeriod, serviceCurrent] = completeServiceQuarters.at(-1) ?? [];
const [priorServicePeriod, servicePrevious] = completeServiceQuarters.at(-2) ?? [];
if (!servicePeriod || !priorServicePeriod) throw new Error("Missing complete services quarter");
const serviceTarget = byId.get("M14");
if (serviceTarget.status !== "待采集" && !serviceTarget.currentSource?.includes("Wind M5481116")) {
  throw new Error("Unexpected indicator state: M14");
}
serviceTarget.currentValue = decimal(2)(serviceCurrent.value);
serviceTarget.prior = `${priorServicePeriod}：${decimal(2)(servicePrevious.value)}`;
serviceTarget.period = servicePeriod;
serviceTarget.trend = direction(serviceCurrent.value, servicePrevious.value);
serviceTarget.score = 3;
serviceTarget.currentSource = "国家外汇管理局（Wind M5481116，三个月求和）";
serviceTarget.status = "已核验";

const ccfiTarget = byId.get("M44");
if (ccfiTarget.status === "待采集") {
  const ccfi = series("S0000066", "根据新闻整理", "1998年1月1日=1000");
  ccfiTarget.currentValue = decimal(2)(observation(ccfi).value);
  ccfiTarget.prior = decimal(2)(observation(ccfi, 1).value);
  ccfiTarget.period = period(observation(ccfi).date, "周");
  ccfiTarget.trend = "Wind 周度参考值；待上海航运交易所原始发布核验";
  ccfiTarget.currentSource = "Wind S0000066（根据新闻整理，待官方核验）";
}

const missingReasons = {
  M56: "Wind 财政赤字率目标序列最新为 2025 年，尚缺 2026 年数据",
  M65: "Wind 积分不足，1年期国债收益率提取中断",
  M66: "Wind 积分不足，10Y-1Y 期限利差计算中断",
};
for (const [id, reason] of Object.entries(missingReasons)) {
  const target = byId.get(id);
  if (target?.status === "待采集") target.trend = reason;
}

const verified = advisory.macroIndicators.filter((indicator) => indicator.status === "已核验");
const pending = advisory.macroIndicators.filter((indicator) => indicator.status === "待采集");
const latestDate = audit.metrics.flatMap((metric) => metric.date).filter((date) => /^\d{8}$/.test(date)).sort().at(-1);
advisory.updatedAt = new Date().toISOString();
advisory.dataThrough = `指标分项截至 ${period(latestDate, "日")}；研究观点为 2026-07 快照`;
advisory.macroNote = `现行 ${advisory.macroIndicators.length} 项指标中 ${verified.length} 项已核验、${pending.length} 项待采集；各项采用各自的观测周期，并非都更新至同一日期。宏观观点、情景和资产评级仍为 7 月研究快照，暂不发布加权总分。`;
advisory.macroFramework.totalIndicators = advisory.macroIndicators.length;
advisory.macroFramework.verifiedIndicators = verified.length;
advisory.macroFramework.coveragePct = Math.round(verified.length / advisory.macroIndicators.length * 1000) / 10;
for (const pillar of advisory.macroPillars) {
  const rows = advisory.macroIndicators.filter((indicator) => indicator.primary === pillar.name);
  pillar.coverage = `${rows.filter((indicator) => indicator.status === "已核验").length}/${rows.length}`;
}

await fs.writeFile(advisoryPath, `${JSON.stringify(advisory, null, 2)}\n`);
console.log(JSON.stringify({ verified: verified.length, pending: advisory.macroIndicators.length - verified.length,
  scored: verified.filter((indicator) => indicator.score != null).length, advisoryPath }));
