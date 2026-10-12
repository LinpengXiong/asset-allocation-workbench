import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROFIT_BREADTH_BASIS, PROFIT_BREADTH_INDUSTRIES, PROFIT_BREADTH_KEY,
  validateProfitBreadthInput, validateStandaloneProfitBreadthObservation } from "../lib/macro-profit-breadth.mjs";
import { continuousScoreDetails, scoreContinuous } from "../lib/macro-scoring-continuous.mjs";
import { scoreIndicator } from "../lib/macro-rating.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [history, breadthAudit] = await Promise.all([
  readJson("../app/data/macro-rating-history.json"),
  readJson("../deliverables/macro-v1-18-profit-breadth-input.json"),
]);
// Use a frozen historical five-component record, not the concurrently migrating live JSON.
const legacyRecord = history.snapshots.find((record) => {
  const rule = record.framework.indicators.find((item) => item.id === "G02");
  return rule?.scoring?.components?.length === 5
    && rule.scoring.components.some((component) => component.key === PROFIT_BREADTH_KEY);
});
assert.ok(legacyRecord, "A preserved five-component G02 snapshot is required");
const legacyRule = legacyRecord.framework.indicators.find((item) => item.id === "G02");
const legacyRow = legacyRecord.rows.find((item) => item.id === "G02");
const cutoff = legacyRecord.asOf;
const clone = (value) => structuredClone(value);
const close = (actual, expected, tolerance = 1e-9) => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${expected}, got ${actual}`);
};
const g02Rule = () => {
  const rule = clone(legacyRule);
  rule.name = "规模以上工业企业盈利增长与质量";
  rule.weight = 0.03;
  const weights = {
    cumulativeComparableProfitGrowth: 0.5,
    officialCurrentMonthComparableProfitGrowth: 0.25,
    reportedProfitMarginYoyChange: 0.125,
    reportedReceivablesDaysYoyChange: 0.125,
  };
  rule.scoring.components = rule.scoring.components.filter((item) => item.key !== PROFIT_BREADTH_KEY)
    .map((item) => ({ ...item, weight: weights[item.key] }));
  return rule;
};
const g02Observation = () => {
  const observation = clone(legacyRow.observation);
  delete observation.scoringInputs[PROFIT_BREADTH_KEY];
  return observation;
};
const g19Rule = () => ({
  id: "G19", pillar: "增长动力", group: "工业生产", name: "行业利润改善广度",
  frequency: "月度", unit: "%", mode: "高优", weight: 0.03,
  originalPublisher: "国家统计局", measurementBasis: PROFIT_BREADTH_BASIS,
  aggregation: "行业利润改善广度",
  scoring: { method: "piecewise-linear", anchors: [[0, 1], [25, 2], [50, 3], [75, 4], [100, 5]] },
});
const g19Observation = () => {
  const item = clone(breadthAudit.input);
  delete item.key;
  return { ...item, indicatorId: "G19" };
};
const g19Score = (item = g19Observation(), rule = g19Rule(), asOf = cutoff) => scoreIndicator(rule, item, asOf);

test("G02 and G19 split the authorized total into independent 3% weights and four quality components", () => {
  const rule = g02Rule();
  assert.equal(rule.weight + g19Rule().weight, 0.06);
  assert.deepEqual(rule.scoring.components.map((item) => item.weight), [0.5, 0.25, 0.125, 0.125]);
  assert.equal(rule.scoring.components.some((item) => item.key === PROFIT_BREADTH_KEY), false);
  close(scoreContinuous(rule, g02Observation(), cutoff), 3.5570833333333334);
  close(scoreIndicator(rule, g02Observation(), cutoff), 3.5570833333333334);
  close(g19Score(), 3.1463414634146343);
});

test("standalone G19 needs no G02 profitQuality or scoringInputs wrapper", () => {
  const item = g19Observation();
  assert.equal(Object.hasOwn(item, "scoringInputs"), false);
  assert.equal(Object.hasOwn(item, "profitQuality"), false);
  assert.equal(item.indicatorId, "G19");
  assert.equal(item.rawEvidence.industries.length, 41);
  close(validateStandaloneProfitBreadthObservation(item, cutoff), 22 / 41 * 100);
  close(continuousScoreDetails(g19Rule(), item, cutoff).components[0].value, 22 / 41 * 100);
});

test("the frozen historical G02 five-component rule remains unchanged and recomputable", () => {
  const before = JSON.stringify(legacyRecord);
  const observation = clone(legacyRow.observation);
  assert.deepEqual(legacyRule.scoring.components.map((item) => item.weight), [0.4, 0.2, 0.2, 0.1, 0.1]);
  close(validateProfitBreadthInput(observation.scoringInputs[PROFIT_BREADTH_KEY], observation, cutoff), 22 / 41 * 100);
  close(scoreContinuous(legacyRule, observation, cutoff), legacyRow.points);
  close(scoreIndicator(legacyRule, observation, cutoff, legacyRecord.framework.freshness), legacyRow.points);
  assert.equal(JSON.stringify(legacyRecord), before);
});

test("new G02 is not silently affected by an old breadth wrapper left in a historical observation", () => {
  const observation = clone(legacyRow.observation);
  const expected = scoreContinuous(g02Rule(), observation, cutoff);
  observation.scoringInputs[PROFIT_BREADTH_KEY].value = 100;
  observation.scoringInputs[PROFIT_BREADTH_KEY].rawEvidence.industries = [];
  close(scoreContinuous(g02Rule(), observation, cutoff), expected);
  close(expected, 3.5570833333333334);
  assert.equal(scoreContinuous(legacyRule, observation, cutoff), null);
});

test("four-component G02 still refuses missing current growth, profit-margin or collection evidence", () => {
  for (const key of ["officialCurrentMonthComparableProfitGrowth", "reportedProfitMarginYoyChange",
    "reportedReceivablesDaysYoyChange"]) {
    const observation = g02Observation();
    delete observation.scoringInputs[key];
    assert.equal(scoreContinuous(g02Rule(), observation, cutoff), null);
    assert.equal(scoreIndicator(g02Rule(), observation, cutoff), null);
  }
  const observation = g02Observation();
  delete observation.value;
  assert.equal(scoreContinuous(g02Rule(), observation, cutoff), null);
});

test("four-component G02 preserves same-scope and independently sourced quality gates", () => {
  for (const mutate of [
    (item) => { delete item.profitQuality; },
    (item) => { item.profitQuality.sameScope = false; },
    (item) => { item.profitQuality.period = "2026-07"; },
    (item) => { item.profitQuality.profitMargin.sourceUrl = "https://example.com/guess"; },
    (item) => { item.scoringInputs.reportedProfitMarginYoyChange.rawEvidence.currentProfitMargin += 0.1; },
    (item) => { item.scoringInputs.reportedReceivablesDaysYoyChange.rawEvidence.currentReceivablesDays += 0.1; },
    (item) => { item.scoringInputs.officialCurrentMonthComparableProfitGrowth.rawEvidence.notDerivedFromPublishedAmounts = false; },
  ]) {
    const item = g02Observation(); mutate(item);
    assert.equal(scoreIndicator(g02Rule(), item, cutoff), null);
  }
});

test("G19 never substitutes cumulative total growth or profitable-industry counts for improvement breadth", () => {
  for (const value of [15.7, 100, 3.1463414634, null, "53.658537", -1, 101, NaN, Infinity]) {
    const item = g19Observation(); item.value = value;
    assert.equal(g19Score(item), null);
    assert.equal(scoreContinuous(g19Rule(), item, cutoff), null);
  }
  const rounded = g19Observation(); rounded.value = 53.658537;
  close(g19Score(rounded), 3.1463414634146343);
  // All 41 industries currently have positive profits; only 22 show improvement.
  assert.equal(rounded.rawEvidence.industries.filter((row) => row.profit > 0).length, 41);
});

test("G19 requires exactly all 41 official major groups and does not shrink its denominator", () => {
  for (const mutate of [
    (item) => { item.rawEvidence.industries.pop(); },
    (item) => { item.rawEvidence.industries[1] = clone(item.rawEvidence.industries[0]); },
    (item) => { item.rawEvidence.industries[0].name = "自选景气行业"; },
    (item) => { item.rawEvidence.expectedIndustryCount = 30; item.rawEvidence.industries = item.rawEvidence.industries.slice(0, 30); },
    (item) => { item.rawEvidence.classification = "其他分类"; },
    (item) => { delete item.rawEvidence; },
  ]) {
    const item = g19Observation(); mutate(item);
    assert.equal(validateStandaloneProfitBreadthObservation(item, cutoff), null);
    assert.equal(g19Score(item), null);
    assert.equal(scoreContinuous(g19Rule(), item, cutoff), null);
  }
  assert.deepEqual(g19Observation().rawEvidence.industries.map((item) => item.name), [...PROFIT_BREADTH_INDUSTRIES]);
});

test("standalone breadth retains numeric tokens and explicit negative-base facts, not client classification", () => {
  for (const mutate of [
    (rows) => { rows[0].status = "改善"; },
    (rows) => { rows[0].officialYoyPct += 1; },
    (rows) => { rows[0].sourceTableRow.profitYoy = "999.0"; },
    (rows) => { rows[0].sourceTableRow.profit = "1.0"; },
    (rows) => { rows[19].officialSpecialChange = null; },
    (rows) => { rows[19].officialSpecialChange.originalText = rows[19].name + "未实现扭亏为盈。"; },
    (rows) => { rows[19].priorProfitSign = "positive"; },
    (rows) => { rows[19].sourceTableRow.profitYoy = "0.0"; },
  ]) {
    const item = g19Observation(); mutate(item.rawEvidence.industries);
    assert.equal(g19Score(item), null);
  }
});

test("G19 standalone and direct interpolation paths reject wrong identifier, scope, period or units", () => {
  for (const mutate of [
    (item) => { delete item.indicatorId; },
    (item) => { item.indicatorId = "G02"; },
    (item) => { item.scope = "全部上市公司"; },
    (item) => { item.unit = "分"; },
    (item) => { item.basis = "当月分行业利润改善广度"; },
    (item) => { item.period = "2026-01"; },
    (item) => { item.latestAvailablePeriod = "2026-07"; },
    (item) => { item.rawEvidence.aggregation = "8月单月"; },
    (item) => { item.rawEvidence.notDerivedFromPublishedAmounts = false; },
    (item) => { item.rawEvidence.industries[0].period = "2026-07"; },
  ]) {
    const item = g19Observation(); mutate(item);
    assert.equal(g19Score(item), null);
    assert.equal(scoreContinuous(g19Rule(), item, cutoff), null);
  }
});

test("source, release, verification and cutoff gates also apply to standalone G19", () => {
  for (const mutate of [
    (item) => { item.verified = false; },
    (item) => { item.originalPublisher = "媒体"; },
    (item) => { item.sourceUrl = "https://www.stats.gov.cn/sj/sjjd/202609/t20260928_1965426.html"; },
    (item) => { item.sourceUrl = "https://stats.gov.cn.example.com/sj/zxfbhjd/202609/t20260928_1965425.html"; },
    (item) => { item.releaseDate = "2026-08-30"; },
    (item) => { item.releaseDate = "2026-10-12"; },
    (item) => { item.verifiedAt = "2026-09-27"; },
    (item) => { item.verifiedAt = "2026-10-12"; },
    (item) => { item.rawEvidence.industries[0].sourceUrl = "https://example.com/table"; },
    (item) => { item.rawEvidence.industries[0].verifiedAt = "2026-10-12"; },
    (item) => { item.rawEvidence.industries[0].verified = false; },
  ]) {
    const item = g19Observation(); mutate(item);
    assert.equal(g19Score(item), null);
    assert.equal(scoreContinuous(g19Rule(), item, cutoff), null);
  }
  assert.equal(g19Score(g19Observation(), g19Rule(), "2026-09-27"), null);
});

test("G19 cannot bypass complete-table validation through legacy limits or a changed scoring method", () => {
  const item = g19Observation(); item.rawEvidence.industries = [];
  const hardRule = { ...g19Rule(), scoring: undefined, limits: [25, 50, 75, 90] };
  assert.equal(g19Score(item, hardRule), null);
  const compositeRule = g19Rule();
  compositeRule.scoring = { method: "weighted-components", components: [
    { key: "a", label: "a", input: "observation.value", unit: "%", basis: PROFIT_BREADTH_BASIS, weight: 0.5, anchors: g19Rule().scoring.anchors },
    { key: "b", label: "b", input: "observation.value", unit: "%", basis: PROFIT_BREADTH_BASIS, weight: 0.5, anchors: g19Rule().scoring.anchors },
  ] };
  assert.equal(scoreContinuous(compositeRule, g19Observation(), cutoff), null);
  assert.equal(g19Score(g19Observation(), compositeRule), null);
});
