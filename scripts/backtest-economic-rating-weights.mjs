/**
 * Retrospective diagnostic for economic-operation score weights.
 * NBS current-vintage history is not a point-in-time release archive. Results
 * are exploratory, not a tradable or publication-ready out-of-sample backtest.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [framework, priceHistory, gdpHistory] = await Promise.all([
  load("../app/data/macro-rating-v1.json"),
  load("../app/data/macro-price-history.json"),
  load("../app/data/macro-gdp-deflator-history.json"),
]);

const nbsEndpoint = "https://data.stats.gov.cn/dg/website/publicrelease/web/external/stream/esData";
const nbsRoot = "fc982599aa684be7969d7b90b1bd0e84";
const officialSeries = {
  unemployment: { cid: "ee3b7046b390415b9b7745e3d16f6052", id: "3888eac6062945a79c8a27e5f13d4953" },
  hours: { cid: "ee3b7046b390415b9b7745e3d16f6052", id: "40ab91b1ef4948e89633c5c7f55b9713" },
  manufacturingPmi: { cid: "93ffbb1aa85740d3aa2618371508b606", id: "a09aa989bdcf4cffa2021795722eb916" },
  nonManufacturingPmi: { cid: "7a64a6e25aec4a8e9dde044ecd9e2cce", id: "88a150208f6e4a1db8babe41ae700f66" },
};

async function fetchOfficialSeries(cid, ids) {
  const body = JSON.stringify({ cid, indicatorIds: ids, das: [{ text: "全国", value: "000000000000" }],
    dts: ["202001MM-202608MM"], showType: "1", rootId: nbsRoot });
  // Each attempt gets a fresh output buffer: curl --retry can otherwise append
  // a second response to a partially received first response on stdout.
  let payload;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = execFileSync("curl", ["--fail-with-body", "-L", "-sS", "--max-time", "30",
        "-X", "POST", nbsEndpoint, "-H", "Content-Type: application/json", "--data", body],
      { encoding: "utf8", maxBuffer: 15 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      payload = JSON.parse(raw);
      break;
    } catch {
      if (attempt === 2) throw new Error("Official series request failed after three fresh attempts; no partial response was used.");
    }
  }
  assert.equal(payload.success, true, `NBS returned ${payload.message ?? "an error"}`);
  const byId = Object.fromEntries(ids.map((id) => [id, new Map()]));
  for (const row of payload.data) {
    const period = `${row.code.slice(0, 4)}-${row.code.slice(4, 6)}`;
    for (const item of row.values ?? []) {
      if (!byId[item._id]) continue;
      const value = Number(item.value);
      if (item.value !== "" && Number.isFinite(value)) byId[item._id].set(period, value);
    }
  }
  return byId;
}

const [labor, manufacturing, nonManufacturing] = await Promise.all([
  fetchOfficialSeries(officialSeries.unemployment.cid, [officialSeries.unemployment.id, officialSeries.hours.id]),
  fetchOfficialSeries(officialSeries.manufacturingPmi.cid, [officialSeries.manufacturingPmi.id]),
  fetchOfficialSeries(officialSeries.nonManufacturingPmi.cid, [officialSeries.nonManufacturingPmi.id]),
]);
const monthly = {
  unemployment: labor[officialSeries.unemployment.id],
  hours: labor[officialSeries.hours.id],
  manufacturingPmi: manufacturing[officialSeries.manufacturingPmi.id],
  nonManufacturingPmi: nonManufacturing[officialSeries.nonManufacturingPmi.id],
};
const price = new Map(priceHistory.rows.map((row) => [row.period, row]));
const gdpRows = gdpHistory.rows.filter((row) => row.period >= "2020-Q1" && row.period <= "2026-Q2");
const rules = framework.indicators.filter((rule) => rule.pillar === "经济运行");
assert.equal(rules.length, 8);

function score(rule, value) {
  const limits = rule.limits;
  if (rule.mode === "高优") return value < limits[0] ? 1 : value < limits[1] ? 2 : value < limits[2] ? 3 : value < limits[3] ? 4 : 5;
  if (rule.mode === "低优") return value < limits[0] ? 5 : value < limits[1] ? 4 : value < limits[2] ? 3 : value < limits[3] ? 2 : 1;
  for (const [lower, upper, points] of [[6, 7, 5], [4, 5, 4], [2, 3, 3], [0, 1, 2]]) {
    if (value >= limits[lower] && value <= limits[upper]) return points;
  }
  return 1;
}

const month = (year, monthIndex) => `${year}-${String(monthIndex).padStart(2, "0")}`;
const candidates = {
  baselineV1_2: { E01: .085, E02: .035, E03: .025, E04: .015, E05: .065, E07: .025, E08: .025, E09: .025 },
  approvedV1_3: Object.fromEntries(rules.map((rule) => [rule.id, rule.weight])),
  balanced_ppi_3_unemployment_4_5: { E01: .085, E02: .035, E03: .025, E04: .03, E05: .045, E07: .025, E08: .025, E09: .03 },
  conservative_ppi_3_unemployment_4_5: { E01: .085, E02: .035, E03: .025, E04: .03, E05: .045, E07: .03, E08: .025, E09: .025 },
  focused_ppi_3_5_unemployment_4: { E01: .085, E02: .035, E03: .025, E04: .035, E05: .04, E07: .03, E08: .025, E09: .025 },
  ppi_3_5_unemployment_4: { E01: .085, E02: .03, E03: .02, E04: .035, E05: .04, E07: .03, E08: .03, E09: .03 },
  ppi_4_unemployment_3_5: { E01: .085, E02: .03, E03: .02, E04: .04, E05: .035, E07: .03, E08: .03, E09: .03 },
  ppi_4_5_unemployment_3: { E01: .085, E02: .03, E03: .02, E04: .045, E05: .03, E07: .03, E08: .03, E09: .03 },
  equal: Object.fromEntries(rules.map((rule) => [rule.id, .30 / rules.length])),
};
for (const weights of Object.values(candidates)) assert.ok(Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - .30) < 1e-10);

const quarters = [];
for (const row of gdpRows) {
  const [year, quarter] = row.period.split("-Q").map(Number);
  const periodMonths = [month(year, quarter * 3 - 2), month(year, quarter * 3 - 1), month(year, quarter * 3)];
  const prices = price.get(periodMonths[2]);
  const manufacturingValues = periodMonths.map((period) => monthly.manufacturingPmi.get(period));
  const nonManufacturingValues = periodMonths.map((period) => monthly.nonManufacturingPmi.get(period));
  const values = {
    E01: row.realGdpIndex - 100,
    E02: prices?.cpi,
    E03: prices?.coreCpi,
    E04: prices?.ppi,
    E05: monthly.unemployment.get(periodMonths[2]),
    E07: row.value,
    E08: manufacturingValues.every(Number.isFinite) ? manufacturingValues.reduce((a, b) => a + b, 0) / 3 : null,
    E09: nonManufacturingValues.every(Number.isFinite) ? nonManufacturingValues.reduce((a, b) => a + b, 0) / 3 : null,
  };
  const complete = Object.values(values).every(Number.isFinite);
  quarters.push({ period: row.period, year, values, complete,
    scores: complete ? Object.fromEntries(rules.map((rule) => [rule.id, score(rule, values[rule.id])])) : null,
    real: row.realGdpIndex - 100,
    nominal: (row.nominalGdp / row.priorYearNominalGdp - 1) * 100,
    hours: monthly.hours.get(periodMonths[2]) ?? null,
  });
}

function midranks(values) {
  const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array(values.length);
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end++;
    for (let cursor = start; cursor < end; cursor++) result[ordered[cursor].index] = (start + end + 1) / 2;
    start = end;
  }
  return result;
}
function spearman(xs, ys) {
  if (xs.length < 5 || xs.length !== ys.length) return null;
  const a = midranks(xs), b = midranks(ys);
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0);
  const denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0)
    * b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denominator ? Number((numerator / denominator).toFixed(3)) : null;
}
const summarize = (subset, weights, horizon, target) => {
  const aligned = subset.filter((item) => item.current.complete && item.future);
  const predicted = aligned.map(({ current }) => rules.reduce((sum, rule) => sum + weights[rule.id] * current.scores[rule.id], 0) / .30);
  return { n: aligned.length, rho: spearman(predicted, aligned.map(({ future }) => future[target])) };
};
const pairs = (horizon, minimumYear = 2020) => quarters.slice(0, -horizon).map((current, index) => ({ current, future: quarters[index + horizon] }))
  .filter(({ current }) => current.year >= minimumYear);

const gradeCounts = Object.fromEntries(rules.map((rule) => [rule.id, [1, 2, 3, 4, 5].map((point) => quarters.filter((q) => q.scores?.[rule.id] === point).length)]));
const indicatorSignals = Object.fromEntries(rules.map((rule) => {
  const aligned = pairs(1).filter(({ current }) => current.complete);
  return [rule.id, {
    nextReal: spearman(aligned.map(({ current }) => current.scores[rule.id]), aligned.map(({ future }) => future.real)),
    nextNominal: spearman(aligned.map(({ current }) => current.scores[rule.id]), aligned.map(({ future }) => future.nominal)),
  }];
}));
const scoreOverlap = {
  ppiDeflator: spearman(quarters.map((q) => q.scores.E04), quarters.map((q) => q.scores.E07)),
  cpiCoreCpi: spearman(quarters.map((q) => q.scores.E02), quarters.map((q) => q.scores.E03)),
  gdpManufacturingPmi: spearman(quarters.map((q) => q.scores.E01), quarters.map((q) => q.scores.E08)),
};
const results = Object.fromEntries(Object.entries(candidates).map(([name, weights]) => [name, {
  oneQuarterReal: summarize(pairs(1), weights, 1, "real"),
  oneQuarterNominal: summarize(pairs(1), weights, 1, "nominal"),
  since2022Real: summarize(pairs(1, 2022), weights, 1, "real"),
  since2022Nominal: summarize(pairs(1, 2022), weights, 1, "nominal"),
  recent2024Real: summarize(pairs(1, 2024), weights, 1, "real"),
  recent2024Nominal: summarize(pairs(1, 2024), weights, 1, "nominal"),
  twoQuarterReal: summarize(pairs(2), weights, 2, "real"),
  twoQuarterNominal: summarize(pairs(2), weights, 2, "nominal"),
}]));
console.log(JSON.stringify({
  source: "国家统计局公开月度数据库（PMI、失业率、工时）及工作台已核验的国家统计局价格月报、同版季度GDP序列",
  limitations: ["当前修订版本回看，不是逐期历史发布版本", "样本仅2020Q1—2026Q2，2024年以后仅为近期子样本、并非真正样本外检验", "预测目标为未来季度GDP，不等于投资收益", "季度末指标发布日需再逐期复核", "现有五档阈值固定不变，阈值本身也需单独验证"],
  completeness: { quarters: quarters.length, complete: quarters.filter((q) => q.complete).length,
    missing: quarters.filter((q) => !q.complete).map((q) => q.period),
    officialMonthly: Object.fromEntries(Object.entries(monthly).map(([key, map]) => [key, map.size])) },
  gradeCounts, indicatorSignals, scoreOverlap, results,
  weights: candidates,
}, null, 2));
