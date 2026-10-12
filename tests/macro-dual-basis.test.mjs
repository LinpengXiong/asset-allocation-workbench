import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isDualBasisRule, validateDualBasisObservation, validateDualBasisComponent,
  FISCAL_MONTHLY_BASIS, FISCAL_AMOUNT_BASIS } from "../lib/macro-dual-basis.mjs";
import { continuousScoreDetails, interpolateScore } from "../lib/macro-scoring-continuous.mjs";
import { scoreIndicator, evaluateMacroRating } from "../lib/macro-rating.mjs";

const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
// Independent immutable fixtures keep this contract valid before and after the
// active framework migrates. No test rewrites a historical release or record.
const frozen = read("deliverables/macro-rating-framework-before-v1-19-2026-10-11.json");
const frozenCurrent = read("deliverables/macro-rating-current-before-v1-19-2026-10-11.json");
const frozenHistory = read("deliverables/macro-rating-history-before-v1-19-2026-10-11.json");
const fiscalEvidence = read("deliverables/macro-fiscal-momentum-v1-20-candidate.json");
const dualEvidence = read("deliverables/macro-dual-basis-v1-20-evidence.json");
const asOf = "2026-10-11";
const near = (actual, expected, tolerance = 1e-9) => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};
const direct = {
  G01: { value: 5.3, basis: "年初累计实际同比", series: "industrialValueAdded",
    sourceUrl: "https://www.stats.gov.cn/zwfwck/sjfb/202609/t20260915_1965308.html" },
  G17: { value: 1, basis: "年初累计名义同比", series: "goodsRetailSales" },
  G10: { value: 19.3, basis: "年初累计美元金额同比", series: "goodsExportsUsd" },
};
function fixture(id) {
  const rule = structuredClone(frozen.indicators.find((item) => item.id === id));
  const observation = structuredClone(frozenCurrent.observations[id]);
  const anchors = structuredClone(rule.scoring.anchors);
  const cumulativeWeight = id === "G10" ? .5 : id === "P01F" ? .6 : .4;
  const fiscal = id.startsWith("P");
  const cumulativeBasis = fiscal ? rule.measurementBasis : direct[id].basis;
  const monthlyBasis = fiscal ? FISCAL_MONTHLY_BASIS : rule.measurementBasis;
  rule.scoring = { method: "weighted-components", dualBasis: "year-to-date-and-latest-month",
    components: [
      { key: "yearToDateGrowth", label: "年初累计同比", weight: cumulativeWeight,
        input: fiscal ? "observation.value" : "observation.scoringInputs.yearToDateGrowth",
        unit: "%", basis: cumulativeBasis, anchors: structuredClone(anchors) },
      { key: "latestMonthGrowth", label: "最新单月同比", weight: 1 - cumulativeWeight,
        input: fiscal ? "observation.scoringInputs.latestMonthGrowth" : "observation.value",
        unit: "%", basis: monthlyBasis, anchors: structuredClone(anchors) },
    ] };
  observation.scoringInputs = {};
  if (!fiscal) {
    const extra = direct[id];
    observation.scoringInputs.yearToDateGrowth = {
      key: "yearToDateGrowth", value: extra.value, period: observation.period,
      unit: "%", basis: extra.basis, series: extra.series, scope: "全国",
      periodScope: "2026-01—2026-08", originalPublisher: observation.originalPublisher,
      sourceUrl: extra.sourceUrl ?? observation.sourceUrl, releaseDate: observation.releaseDate,
      verifiedAt: asOf, verified: true, latestAvailablePeriod: observation.period,
      ...(observation.revisionVersion ? { revisionVersion: observation.revisionVersion } : {}),
      rawEvidence: { kind: "official-dual-yoy-row", reportedMonthlyYoyPct: observation.value,
        reportedCumulativeYoyPct: extra.value },
    };
  } else {
    const series = id === "P01E" ? "全国一般公共预算支出" : "全国政府性基金预算支出";
    const oldSeries = observation.fiscalExpenditure.series;
    const amount = (period) => {
      const source = fiscalEvidence.observations.find((item) => item.period === period && item.series === oldSeries);
      return { value: source.value, unit: "亿元", period: source.period, periodScope: source.periodScope,
        basis: FISCAL_AMOUNT_BASIS, series, scope: "全国", reportedYoyPct: source.reportedYoyPct,
        originalPublisher: "财政部", sourceUrl: source.canonicalSourceUrl ?? source.sourceUrl,
        releaseDate: source.releaseDate, verifiedAt: asOf, verified: true };
    };
    const currentYear = { preceding: amount("2026-07"), current: amount("2026-08") };
    const previousYear = { preceding: amount("2025-07"), current: amount("2025-08") };
    const value = ((currentYear.current.value - currentYear.preceding.value)
      / (previousYear.current.value - previousYear.preceding.value) - 1) * 100;
    observation.scoringInputs.latestMonthGrowth = { key: "latestMonthGrowth", value,
      unit: "%", basis: FISCAL_MONTHLY_BASIS, series, scope: "全国", period: observation.period,
      latestAvailablePeriod: observation.period, originalPublisher: "财政部", verified: true,
      sourceUrl: observation.sourceUrl, releaseDate: observation.releaseDate, verifiedAt: asOf,
      comparabilityNote: "根据四期官方累计金额差分；未发现统一重修订版本，不冒称官方直接公布单月同比。",
      rawEvidence: { kind: "single-month-cumulative-amounts", currentYear, previousYear,
        comparability: { sameScope: true, revisionNote: "原月报金额与本年两期官方累计同比交叉核对；非统一重修订版。" } } };
  }
  return { rule, observation };
}
const score = ({ rule, observation }, cutoff = asOf) => continuousScoreDetails(rule, observation, cutoff);
const scorePoints = (data, cutoff = asOf) => score(data, cutoff)?.points ?? null;
const extra = ({ rule, observation }) => observation.scoringInputs[rule.id.startsWith("P")
  ? "latestMonthGrowth" : "yearToDateGrowth"];
const fiscalParts = (data) => {
  const raw = extra(data).rawEvidence;
  return [raw.currentYear.preceding, raw.currentYear.current,
    raw.previousYear.preceding, raw.previousYear.current];
};

test("three published monthly metrics score the same-table cumulative and latest rates separately", () => {
  for (const id of ["G01", "G17", "G10"]) {
    const data = fixture(id), untouched = structuredClone(data);
    assert.equal(isDualBasisRule(data.rule), true);
    assert.equal(validateDualBasisObservation(data.rule, data.observation, asOf), true);
    const details = score(data);
    assert.equal(details.components.length, 2);
    assert.deepEqual(details.components.map((part) => part.key), ["yearToDateGrowth", "latestMonthGrowth"]);
    const expected = data.rule.scoring.components.reduce((sum, part) => sum + part.weight
      * interpolateScore(part.key === "yearToDateGrowth" ? extra(data).value : data.observation.value, part.anchors), 0);
    near(details.points, expected);
    near(scoreIndicator(data.rule, data.observation, asOf, frozen.freshness), expected);
    for (const part of details.components) {
      assert.equal(part.period, "2026-08"); assert.equal(part.releaseDate, data.observation.releaseDate);
      assert.equal(part.verifiedAt, asOf); assert.match(part.sourceUrl, /gov\.cn/);
      assert.notEqual(part.basis, "近3月同比");
    }
    assert.notEqual(details.components[0].basis, details.components[1].basis);
    assert.deepEqual(data, untouched);
  }
});
test("fiscal latest-month growth is derived from adjacent cumulative AMOUNTS, preserving the main raw rate", () => {
  for (const [id, expected] of [["P01E", -.13450260935061742], ["P01F", -21.371016235718578]]) {
    const data = fixture(id), untouched = structuredClone(data);
    near(extra(data).value, expected);
    const details = score(data);
    near(details.components[1].value, expected);
    near(details.components[0].value, data.observation.value);
    near(details.points, details.components.reduce((sum, part) => sum + part.points * part.weight, 0));
    near(scoreIndicator(data.rule, data.observation, asOf, frozen.freshness), details.points);
    assert.deepEqual(data, untouched);
  }
});
test("independently audited production candidates satisfy the same contracts including six-decimal fiscal rounding", () => {
  for (const id of ["G01", "G17", "G10", "P01E", "P01F"]) {
    const data = fixture(id), item = dualEvidence.items.find((entry) => entry.id === id);
    const key = id.startsWith("P") ? "latestMonthGrowth" : "yearToDateGrowth";
    const evidence = structuredClone(item[key]);
    data.observation.scoringInputs[key] = evidence;
    const details = score(data);
    assert.notEqual(details, null, id);
    const component = details.components.find((part) => part.key === key);
    near(component.value, evidence.value, 1e-6);
    assert.notEqual(scoreIndicator(data.rule, data.observation, asOf, frozen.freshness), null, id);
    assert.equal(data.observation.value, frozenCurrent.observations[id].value);
  }
});
test("a missing secondary rate never gives a partial complete score or redistributes its allocation", () => {
  for (const id of ["G01", "G17", "G10", "P01E", "P01F"]) {
    const data = fixture(id); delete data.observation.scoringInputs;
    assert.equal(score(data), null);
    assert.equal(scoreIndicator(data.rule, data.observation, asOf, frozen.freshness), null);
  }
});
test("both components require unique approved keys, correct units, inputs, basis and allocations summing to one", () => {
  for (const id of ["G01", "P01E"]) for (const mutate of [
    (data) => { data.rule.scoring.components.pop(); },
    (data) => { data.rule.scoring.components[1].key = "yearToDateGrowth"; },
    (data) => { data.rule.scoring.components[1].key = "recentThreeMonthGrowth"; },
    (data) => { data.rule.scoring.components[1].weight = 0; },
    (data) => { data.rule.scoring.components[1].weight += .001; },
    (data) => { data.rule.scoring.components[1].unit = "百分点"; },
    (data) => { data.rule.scoring.components[0].basis = "当月同比"; },
    (data) => { data.rule.scoring.components[0].input = "observation.value"; data.rule.scoring.components[1].input = "observation.value"; },
    (data) => { data.rule.scoring.components[0].label = ""; },
    (data) => { data.rule.scoring.components[0].anchors = [[0, 3]]; },
  ]) { const data = fixture(id); mutate(data); assert.equal(score(data), null); }
});
test("a new marker cannot grant the new contract to unrelated or historical methods", () => {
  const data = fixture("G01");
  delete data.rule.scoring.dualBasis; assert.equal(isDualBasisRule(data.rule), false); assert.equal(score(data), null);
  const arbitrary = fixture("G01"); arbitrary.rule.id = "G99";
  assert.equal(isDualBasisRule(arbitrary.rule), false); assert.equal(score(arbitrary), null);
  for (const id of ["G01", "G17", "G10", "P01E", "P01F"]) {
    const rule = frozen.indicators.find((item) => item.id === id);
    assert.equal(isDualBasisRule(rule), false);
    assert.equal(continuousScoreDetails(rule, frozenCurrent.observations[id], asOf).components[0].key, undefined);
  }
});
test("paired official rows must match their monthly main value, cumulative value and exact national series", () => {
  for (const id of ["G01", "G17", "G10"]) for (const mutate of [
    (item) => { item.rawEvidence.reportedMonthlyYoyPct += .1; },
    (item) => { item.rawEvidence.reportedCumulativeYoyPct += .1; },
    (item) => { item.rawEvidence.kind = "cumulative-rate-difference"; },
    (item) => { item.rawEvidence.notDerivedFromPublishedAmounts = false; },
    (item) => { item.rawEvidence = null; },
    (item) => { item.series = "socialRetailSales"; },
    (item) => { item.scope = "限额以上企业"; },
    (item) => { item.unit = "百分点"; },
    (item) => { item.basis = "累计增速环比变化"; },
    (item) => { item.periodScope = "2026-08单月"; },
    (item) => { item.key = "latestMonthGrowth"; },
  ]) { const data = fixture(id); mutate(extra(data)); assert.equal(score(data), null); }
});
test("customs original HTTP tables are permitted only for customs, with unchanged currency and release vintage", () => {
  const data = fixture("G10"); assert.match(extra(data).sourceUrl, /^http:/); assert.notEqual(score(data), null);
  extra(data).sourceUrl = extra(data).sourceUrl.replace(/^http:/, "https:"); assert.notEqual(score(data), null);
  for (const mutate of [
    (item) => { item.sourceUrl = "http://www.stats.gov.cn/raw.html"; },
    (item) => { item.sourceUrl = "https://www.customs.gov.cn.example.com/raw.html"; },
    (item) => { item.currency = "CNY"; },
    (item) => { item.revisionVersion = "2026-08-01-旧海关月表"; },
    (item) => { delete item.revisionVersion; },
  ]) { const wrong = fixture("G10"); mutate(extra(wrong)); assert.equal(score(wrong), null); }
});
test("every added observation needs real official publication, verification and an already-ended matching month", () => {
  for (const id of ["G01", "G17", "G10", "P01E", "P01F"]) for (const mutate of [
    (item) => { item.verified = false; },
    (item) => { item.originalPublisher = "普通媒体"; },
    (item) => { item.value = null; },
    (item) => { item.value = "5.3"; },
    (item) => { item.sourceUrl = "https://example.com/raw"; },
    (item) => { item.sourceUrl = "https://user:password@www.stats.gov.cn/raw"; },
    (item) => { item.releaseDate = "2026-08-01"; },
    (item) => { item.releaseDate = "2026-10-12"; },
    (item) => { item.releaseDate = "2026-02-30"; },
    (item) => { item.verifiedAt = "2026-09-01"; },
    (item) => { item.verifiedAt = "2026-10-12"; },
    (item) => { item.period = "2026-07"; },
    (item) => { item.latestAvailablePeriod = "2026-09"; },
  ]) { const data = fixture(id); mutate(extra(data)); assert.equal(score(data), null); }
});
test("the main observation remains subject to the same publisher, period, date and source requirements", () => {
  for (const id of ["G01", "G10", "P01E"]) for (const mutate of [
    (item) => { item.verified = false; },
    (item) => { item.originalPublisher = "普通媒体"; },
    (item) => { item.unit = "百分点"; },
    (item) => { item.basis = "错误口径"; },
    (item) => { item.latestAvailablePeriod = "2026-09"; },
    (item) => { item.sourceUrl = "https://example.com/raw"; },
    (item) => { item.releaseDate = "2026-08-01"; },
    (item) => { item.releaseDate = "2026-10-12"; },
    (item) => { item.verifiedAt = "2026-09-01"; },
  ]) { const data = fixture(id); mutate(data.observation); assert.equal(score(data), null); }
  for (const cutoff of ["2026-09-01", "2026-02-30", "2026-10", null]) assert.equal(score(fixture("G01"), cutoff), null);
});
test("a duplicate main-value entry cannot contradict the untouched published main observation", () => {
  for (const id of ["G01", "P01E"]) {
    const data = fixture(id), key = id.startsWith("P") ? "yearToDateGrowth" : "latestMonthGrowth";
    data.observation.scoringInputs[key] = { ...structuredClone(data.observation), value: data.observation.value + 1 };
    assert.equal(score(data), null);
  }
});
test("NBS January is not synthesized and February keeps the official combined release scope", () => {
  for (const id of ["G01", "G17"]) {
    const data = fixture(id);
    data.observation.period = data.observation.latestAvailablePeriod = "2026-01";
    extra(data).period = extra(data).latestAvailablePeriod = "2026-01";
    extra(data).periodScope = "2026-01—2026-01";
    assert.equal(score(data), null);
    data.observation.period = data.observation.latestAvailablePeriod = "2026-02";
    extra(data).period = extra(data).latestAvailablePeriod = "2026-02";
    extra(data).periodScope = "2026-01—2026-02";
    assert.equal(score(data), null);
    data.observation.periodScope = "1—2月合并";
    extra(data).monthlyPeriodScope = "1—2月合并";
    assert.notEqual(score(data), null);
  }
});
test("fiscal differences require all four original national amount records with the exact scope and unit", () => {
  for (const id of ["P01E", "P01F"]) for (let index = 0; index < 4; index++) for (const mutate of [
    (part) => { part.value = undefined; },
    (part) => { part.unit = "%"; },
    (part) => { part.basis = "年初累计可比同比"; },
    (part) => { part.series = "全国地方土地出让相关支出"; },
    (part) => { part.scope = "中央本级"; },
    (part) => { part.periodScope = "单月"; },
    (part) => { part.verified = false; },
    (part) => { part.originalPublisher = "普通媒体"; },
    (part) => { part.sourceUrl = "http://gks.mof.gov.cn/raw.htm"; },
    (part) => { part.reportedYoyPct = undefined; },
  ]) { const data = fixture(id); mutate(fiscalParts(data)[index]); assert.equal(score(data), null); }
});
test("fiscal evidence does not accept skipped months, year boundaries, mismatched year-ago periods or duplicates", () => {
  for (const mutate of [
    (raw) => { raw.currentYear.preceding.period = "2026-06"; },
    (raw) => { raw.previousYear.preceding.period = "2025-06"; },
    (raw) => { raw.currentYear.preceding.period = "2025-12"; },
    (raw) => { raw.previousYear.current.period = "2024-08"; },
    (raw) => { raw.previousYear.preceding.period = "2025-08"; },
    (raw) => { raw.currentYear.current.period = "2026-09"; },
    (raw) => { delete raw.previousYear.current; },
    (raw) => { raw.kind = "rolling-three-month-cumulative-amounts"; },
  ]) { const data = fixture("P01E"); mutate(extra(data).rawEvidence); assert.equal(score(data), null); }
});
test("fiscal January/February merged amounts cannot become invented single-month observations", () => {
  const data = fixture("P01E");
  data.observation.period = data.observation.latestAvailablePeriod = "2026-02";
  data.observation.periodScope = "1—2月合并";
  data.observation.fiscalExpenditure.period = "2026-02";
  extra(data).period = extra(data).latestAvailablePeriod = "2026-02";
  for (const [index, part] of fiscalParts(data).entries()) {
    part.period = index === 0 ? "2026-01" : index === 1 ? "2026-02" : index === 2 ? "2025-01" : "2025-02";
    part.periodScope = `${part.period.slice(0, 4)}-01—${part.period}`;
  }
  assert.equal(score(data), null);
});
test("nonpositive fiscal single-month numerator or denominator blocks a comparable growth rate", () => {
  for (const mutate of [
    (raw) => { raw.currentYear.preceding.value = raw.currentYear.current.value; },
    (raw) => { raw.currentYear.preceding.value = raw.currentYear.current.value + 1; },
    (raw) => { raw.previousYear.preceding.value = raw.previousYear.current.value; },
    (raw) => { raw.previousYear.preceding.value = 0; },
    (raw) => { raw.currentYear.current.value = -1; },
  ]) { const data = fixture("P01E"); mutate(extra(data).rawEvidence); assert.equal(score(data), null); }
});
test("fiscal current amount, raw publication and recomputed growth cannot disagree with the main record", () => {
  for (const mutate of [
    (data) => { extra(data).value = data.observation.value - extra(data).rawEvidence.currentYear.preceding.reportedYoyPct; },
    (data) => { extra(data).value += .01; },
    (data) => { extra(data).rawEvidence.currentYear.current.value += 100; },
    (data) => { extra(data).rawEvidence.currentYear.current.reportedYoyPct += .1; },
    (data) => { extra(data).rawEvidence.currentYear.preceding.reportedYoyPct += .1; },
    (data) => { extra(data).rawEvidence.currentYear.current.sourceUrl = "https://gks.mof.gov.cn/another.htm"; },
    (data) => { data.observation.fiscalExpenditure.series = "governmentFundExpenditure"; },
    (data) => { data.observation.fiscalExpenditure.cumulativeExpenditure += 1; },
    (data) => { data.observation.fiscalExpenditure.reportedYoyPct += .1; },
  ]) { const data = fixture("P01E"); mutate(data); assert.equal(score(data), null); }
});
test("fiscal raw publication and verification dates cannot postdate the derived source or cutoff", () => {
  for (let index = 0; index < 4; index++) for (const mutate of [
    (part) => { part.releaseDate = "2026-10-12"; },
    (part) => { part.verifiedAt = "2026-10-12"; },
    (part) => { part.verifiedAt = "2025-01-01"; },
    (part) => { part.releaseDate = "2024-01-01"; },
  ]) { const data = fixture("P01E"); mutate(fiscalParts(data)[index]); assert.equal(score(data), null); }
});
test("comparability screening is required and a claim of a common revision needs an actual matching revision", () => {
  for (const mutate of [
    (data) => { delete extra(data).comparabilityNote; },
    (data) => { extra(data).rawEvidence.comparability.sameScope = false; },
    (data) => { delete extra(data).rawEvidence.comparability.revisionNote; },
    (data) => { extra(data).rawEvidence.comparability.sameRevisionVersion = true; },
    (data) => { fiscalParts(data)[0].revisionVersion = "old"; },
    (data) => { fiscalParts(data).forEach((part, index) => { part.revisionVersion = index === 0 ? "old" : "new"; }); },
  ]) { const data = fixture("P01E"); mutate(data); assert.equal(score(data), null); }
});
test("component evidence is returned only for a declared component and never mutates an observation", () => {
  const data = fixture("G01"), untouched = structuredClone(data);
  const component = data.rule.scoring.components[0];
  near(validateDualBasisComponent(data.rule, data.observation, component, asOf), 5.3);
  assert.equal(validateDualBasisComponent(data.rule, data.observation, { ...component, key: "unrelated" }, asOf), null);
  assert.deepEqual(data, untouched);
});
test("frozen old scores and existing snapshot component shapes remain exactly reproducible", () => {
  for (const snapshot of frozenHistory.snapshots) {
    const current = { asOf: snapshot.asOf, observations: Object.fromEntries(snapshot.rows.map((row) => [row.id, row.observation])) };
    const result = evaluateMacroRating(snapshot.framework, current);
    near(result.formalScore, snapshot.score, 1e-6);
    for (const row of snapshot.rows) {
      const rule = snapshot.framework.indicators.find((item) => item.id === row.id);
      near(scoreIndicator(rule, row.observation, snapshot.asOf, snapshot.framework.freshness), row.points);
      const details = continuousScoreDetails(rule, row.observation, snapshot.asOf);
      if (details) assert.ok(details.components.every((part) => part.period === undefined && part.basis === undefined));
    }
  }
});
