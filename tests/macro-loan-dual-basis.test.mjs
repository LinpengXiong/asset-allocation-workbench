import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { LOAN_DUAL_BASIS_MARKER, LOAN_YTD_BASIS, LOAN_MONTH_BASIS, LOAN_SCOPE,
  LOAN_TRIAL_SCALES, loanTrialAnchors, isLoanDualBasisRule,
  validateLoanDualBasisObservation, buildLoanDualBasisScaleDiagnostics } from "../lib/macro-loan-dual-basis.mjs";
import { continuousScoreDetails, interpolateScore } from "../lib/macro-scoring-continuous.mjs";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";

const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const frozen = read("deliverables/macro-rating-framework-before-v1-21-2026-10-11.json");
const frozenCurrent = read("deliverables/macro-rating-current-before-v1-21-2026-10-11.json");
const frozenHistory = read("deliverables/macro-rating-history-before-v1-21-2026-10-11.json");
const historicalRows = read("app/data/macro-finance-credit.json").rows;
const cutoff = "2026-10-11";
const near = (actual, expected, tolerance = 1e-9) => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};
const comparability = { sameScope: true, revisionNote: "初步数；未发现全期统一重修订版本。",
  roundingNote: "保留原文金额披露粒度，差分误差界为端点半粒度之和。" };
function fixture(id = "F01") {
  const rule = structuredClone(frozen.indicators.find((item) => item.id === id));
  const observation = structuredClone(frozenCurrent.observations[id]);
  delete rule.aggregation;
  rule.scoring = { method: "weighted-components", dualBasis: LOAN_DUAL_BASIS_MARKER, components: [
    { key: "yearToDateMoreIncrease", label: "年初累计同比多增", weight: .4,
      input: "observation.scoringInputs.yearToDateMoreIncrease", unit: "亿元", basis: LOAN_YTD_BASIS,
      scoreTransform: "calendar-month-average", anchorUnit: "亿元/月",
      anchors: loanTrialAnchors(LOAN_TRIAL_SCALES[id].cumulativeMonthAverage) },
    { key: "latestMonthMoreIncrease", label: "最新单月同比多增", weight: .6,
      input: "observation.scoringInputs.latestMonthMoreIncrease", unit: "亿元", basis: LOAN_MONTH_BASIS,
      anchorUnit: "亿元", anchors: loanTrialAnchors(LOAN_TRIAL_SCALES[id].latestMonth) },
  ] };
  const endpoint = (part) => ({ ...structuredClone(part), series: rule.componentSeries, scope: LOAN_SCOPE,
    currency: "CNY", originalPublisher: "中国人民银行", verified: true, verifiedAt: cutoff,
    periodScope: `${part.period.slice(0, 4)}-01—${part.period}`,
    roundingUnit: id === "F01" && part.period.startsWith("2026") ? 1 : 100 });
  const currentYear = { preceding: endpoint(observation.components[5].cumulativeParts[0]),
    current: endpoint(observation.components[5].cumulativeParts[1]) };
  const previousYear = { preceding: endpoint(observation.components[2].cumulativeParts[0]),
    current: endpoint(observation.components[2].cumulativeParts[1]) };
  const metadata = { period: observation.period, unit: "亿元", series: rule.componentSeries,
    scope: LOAN_SCOPE, currency: "CNY", originalPublisher: "中国人民银行", verified: true,
    sourceUrl: observation.sourceUrl, releaseDate: observation.releaseDate, verifiedAt: cutoff,
    latestAvailablePeriod: observation.period };
  observation.scoringInputs = {
    yearToDateMoreIncrease: { ...metadata, key: "yearToDateMoreIncrease", basis: LOAN_YTD_BASIS,
      periodScope: `${observation.period.slice(0, 4)}-01—${observation.period}`,
      value: currentYear.current.value - previousYear.current.value,
      roundingErrorBound: (currentYear.current.roundingUnit + previousYear.current.roundingUnit) / 2,
      rawEvidence: { kind: "loan-year-to-date-amount-difference", current: structuredClone(currentYear.current),
        previous: structuredClone(previousYear.current), comparability: structuredClone(comparability) } },
    latestMonthMoreIncrease: { ...metadata, key: "latestMonthMoreIncrease", basis: LOAN_MONTH_BASIS,
      value: currentYear.current.value - currentYear.preceding.value
        - (previousYear.current.value - previousYear.preceding.value),
      roundingErrorBound: [currentYear.preceding, currentYear.current, previousYear.preceding, previousYear.current]
        .reduce((sum, part) => sum + part.roundingUnit / 2, 0),
      rawEvidence: { kind: "loan-single-month-cumulative-amounts", currentYear, previousYear,
        comparability: structuredClone(comparability) } },
  };
  return { rule, observation };
}
const score = (data, asOf = cutoff) => scoreIndicator(data.rule, data.observation, asOf, frozen.freshness);
const details = (data, asOf = cutoff) => continuousScoreDetails(data.rule, data.observation, asOf);
const monthly = (data) => data.observation.scoringInputs.latestMonthMoreIncrease;
const cumulative = (data) => data.observation.scoringInputs.yearToDateMoreIncrease;
const rawParts = (data) => { const raw = monthly(data).rawEvidence;
  return [raw.currentYear.preceding, raw.currentYear.current, raw.previousYear.preceding, raw.previousYear.current]; };
function recalculate(data) {
  const raw = monthly(data).rawEvidence;
  const currentMonth = raw.currentYear.current.value - raw.currentYear.preceding.value;
  const previousMonth = raw.previousYear.current.value - raw.previousYear.preceding.value;
  monthly(data).value = currentMonth - previousMonth;
  cumulative(data).rawEvidence.current = structuredClone(raw.currentYear.current);
  cumulative(data).rawEvidence.previous = structuredClone(raw.previousYear.current);
  cumulative(data).value = raw.currentYear.current.value - raw.previousYear.current.value;
  data.observation.components[5].value = currentMonth;
  data.observation.components[2].value = previousMonth;
  data.observation.value = data.observation.components.slice(3).reduce((sum, part) => sum + part.value, 0)
    - data.observation.components.slice(0, 3).reduce((sum, part) => sum + part.value, 0);
}

test("two amount differences have independent fixed scales and retain the old main observation", () => {
  for (const [id, ytd, month, expected] of [["F01", -10612, -1022, 1.5334], ["F02", -17400, -1500, 1.6]]) {
    const data = fixture(id), before = structuredClone(data);
    assert.equal(isLoanDualBasisRule(data.rule), true);
    assert.equal(validateLoanDualBasisObservation(data.rule, data.observation, cutoff), true);
    assert.equal(cumulative(data).value, ytd); assert.equal(monthly(data).value, month);
    const result = details(data);
    near(result.points, expected); near(score(data), expected);
    assert.deepEqual(result.components.map((part) => part.key), ["yearToDateMoreIncrease", "latestMonthMoreIncrease"]);
    const cum = result.components[0], latest = result.components[1];
    assert.equal(cum.value, ytd); assert.equal(cum.scoreValue, ytd / 8); assert.equal(cum.unit, "亿元");
    assert.equal(cum.scoreUnit, "亿元/月"); assert.equal(cum.scoreTransform, "calendar-month-average");
    assert.equal(latest.value, month); assert.equal(latest.scoreValue, undefined);
    assert.equal(cum.roundingErrorBound, id === "F01" ? 50.5 : 100);
    assert.equal(latest.roundingErrorBound, id === "F01" ? 101 : 200);
    for (const part of result.components) {
      assert.equal(part.period, "2026-08"); assert.equal(part.releaseDate, "2026-09-14");
      assert.equal(part.verifiedAt, cutoff); assert.equal(part.sourceUrl, data.observation.sourceUrl);
    }
    assert.equal(data.observation.value, frozenCurrent.observations[id].value);
    assert.deepEqual(data.observation.components, frozenCurrent.observations[id].components);
    assert.deepEqual(data, before);
  }
});
test("no component is an unrequested rolling-three-month score or negative-base percentage", () => {
  const data = fixture();
  assert.equal(monthly(data).value, -1022);
  assert.equal(monthly(data).rawEvidence.currentYear.current.value, 188);
  assert.equal(monthly(data).rawEvidence.currentYear.preceding.value, 1010);
  assert.equal(details(data).components.reduce((sum, part) => sum + part.weight, 0), 1);
  assert.notEqual(details(data).components[1].value, data.observation.value);
  assert.equal(data.rule.aggregation, undefined);
});
test("negative and zero prior-year monthly new lending are valid amount comparisons", () => {
  for (const previousMonth of [0, -250]) {
    const data = fixture(); const raw = monthly(data).rawEvidence;
    raw.previousYear.current.value = raw.previousYear.preceding.value + previousMonth;
    recalculate(data);
    assert.notEqual(score(data), null);
    near(monthly(data).value, -822 - previousMonth);
  }
});
test("missing either component or any raw endpoint produces null rather than redistributing", () => {
  for (const id of ["F01", "F02"]) for (const mutate of [
    (data) => { delete data.observation.scoringInputs; },
    (data) => { delete data.observation.scoringInputs.yearToDateMoreIncrease; },
    (data) => { delete data.observation.scoringInputs.latestMonthMoreIncrease; },
    (data) => { delete cumulative(data).rawEvidence.previous; },
    (data) => { delete monthly(data).rawEvidence.currentYear.preceding; },
    (data) => { delete monthly(data).rawEvidence.previousYear.current; },
  ]) { const data = fixture(id); mutate(data); assert.equal(score(data), null); assert.equal(details(data), null); }
});
test("rule marker, approved series, unit, allocation, shape and transform are required", () => {
  for (const mutate of [
    (data) => { data.rule.id = "F99"; },
    (data) => { delete data.rule.scoring.dualBasis; },
    (data) => { data.rule.scoring.dualBasis = "year-to-date-and-latest-month"; },
    (data) => { data.rule.componentSeries = "allLoans"; },
    (data) => { data.rule.originalPublisher = "国家统计局"; },
    (data) => { data.rule.unit = "%"; },
    (data) => { data.rule.aggregation = "近3月同比多增"; },
    (data) => { data.rule.scoring.components[0].weight = .5; },
    (data) => { data.rule.scoring.components[0].weight = 0; },
    (data) => { data.rule.scoring.components.pop(); },
    (data) => { data.rule.scoring.components[0].key = "latestMonthMoreIncrease"; },
    (data) => { data.rule.scoring.components[0].basis = LOAN_MONTH_BASIS; },
    (data) => { data.rule.scoring.components[0].input = "observation.value"; },
    (data) => { data.rule.scoring.components[0].scoreTransform = "rolling-three-month-average"; },
    (data) => { data.rule.scoring.components[0].anchorUnit = "亿元"; },
    (data) => { data.rule.scoring.components[1].scoreTransform = "calendar-month-average"; },
    (data) => { data.rule.scoring.components[1].anchorUnit = "亿元/月"; },
    (data) => { data.rule.scoring.components[0].anchors = [[0, 3]]; },
  ]) { const data = fixture(); mutate(data); assert.equal(score(data), null); }
});
test("wrong department, currency, scope, cumulative basis or period scope is rejected", () => {
  for (const mutate of [
    (item) => { item.series = "enterpriseLong"; },
    (item) => { item.currency = "USD"; },
    (item) => { item.scope = "全国本外币贷款"; },
    (item) => { item.unit = "万亿元"; },
    (item) => { item.basis = "年初累计增速"; },
    (item) => { item.basis = "月末余额"; },
    (item) => { item.periodScope = "2025-01—2026-08"; },
  ]) for (const location of ["endpoint", "input"]) {
    const data = fixture(); mutate(location === "endpoint" ? rawParts(data)[0] : cumulative(data));
    assert.equal(score(data), null);
  }
});
test("only genuine PBC HTTPS origins without disguised hosts, credentials or ports are allowed", () => {
  for (const url of ["http://www.pbc.gov.cn/example", "https://pbc.gov.cn.evil.example/report",
    "https://user@www.pbc.gov.cn/report", "https://www.pbc.gov.cn:444/report", "https://www.stats.gov.cn/report"])
    for (const location of ["endpoint", "input", "main"]) {
      const data = fixture(); const item = location === "endpoint" ? rawParts(data)[0]
        : location === "input" ? monthly(data) : data.observation;
      item.sourceUrl = url; assert.equal(score(data), null);
    }
});
test("unverified, impossible, future or prematurely published evidence cannot become a score", () => {
  for (const mutate of [
    (item) => { item.verified = false; },
    (item) => { delete item.verified; },
    (item) => { item.originalPublisher = "万得"; },
    (item) => { item.releaseDate = "2026-08-01"; },
    (item) => { item.releaseDate = "2026-10-12"; },
    (item) => { item.releaseDate = "2026-02-30"; },
    (item) => { item.verifiedAt = "2026-10-12"; },
    (item) => { item.verifiedAt = "2025-01-01"; },
    (item) => { item.latestAvailablePeriod = "2026-09"; },
  ]) {
    const data = fixture(); mutate(monthly(data)); assert.equal(score(data), null);
    const raw = fixture(); mutate(rawParts(raw)[1]); assert.equal(score(raw), null);
  }
  assert.equal(score(fixture(), "2026-08-31"), null);
  assert.equal(score(fixture(), "2027-03-01"), null);
});
test("adjacent within-year AMOUNTS are required, with matched prior-year comparison months", () => {
  for (const mutate of [
    (data) => { rawParts(data)[0].period = "2026-06"; },
    (data) => { rawParts(data)[0].period = "2025-12"; },
    (data) => { rawParts(data)[2].period = "2025-06"; },
    (data) => { rawParts(data)[3].period = "2024-08"; },
    (data) => { monthly(data).rawEvidence.kind = "cumulative-growth-difference"; },
    (data) => { cumulative(data).rawEvidence.kind = "monthly-rate-sum"; },
    (data) => { cumulative(data).value += .1; },
    (data) => { monthly(data).value += .1; },
  ]) { const data = fixture(); mutate(data); assert.equal(score(data), null); }
});
test("rounding uncertainty is recomputed from original disclosure grain, not erased or used to fudge values", () => {
  for (const mutate of [
    (data) => { delete rawParts(data)[0].roundingUnit; },
    (data) => { rawParts(data)[0].roundingUnit = 0; },
    (data) => { monthly(data).roundingErrorBound -= 1; },
    (data) => { cumulative(data).roundingErrorBound = 0; },
    (data) => { monthly(data).value += 10; },
    (data) => { delete monthly(data).rawEvidence.comparability.roundingNote; },
    (data) => { delete cumulative(data).rawEvidence.comparability.revisionNote; },
  ]) { const data = fixture(); mutate(data); assert.equal(score(data), null); }
});
test("both cumulative endpoints must exactly match the corresponding monthly evidence version", () => {
  for (const mutate of [
    (data) => { cumulative(data).rawEvidence.current.value += 1; cumulative(data).value += 1; },
    (data) => { cumulative(data).rawEvidence.current.sourceUrl += "?other-version"; },
    (data) => { cumulative(data).rawEvidence.previous.roundingUnit = 1; },
    (data) => { cumulative(data).rawEvidence.current.revisionVersion = "revised"; },
    (data) => { monthly(data).rawEvidence.comparability.sameScope = false; },
    (data) => { monthly(data).rawEvidence.comparability.sameRevisionVersion = true; },
  ]) { const data = fixture(); mutate(data); assert.equal(score(data), null); }
});
test("unchanged old main metadata/value are still internally consistent provenance, not silently rescored", () => {
  for (const mutate of [
    (data) => { data.observation.value += 1; },
    (data) => { data.observation.basis = LOAN_MONTH_BASIS; },
    (data) => { data.observation.components[5].value += 1; data.observation.value += 1; },
    (data) => { data.observation.components[2].sourceUrl += "?different"; },
    (data) => { data.observation.components[0].period = "2025-05"; },
  ]) { const data = fixture(); mutate(data); assert.equal(score(data), null); }
});
test("January is not created by a cross-year cumulative subtraction", () => {
  const data = fixture(); data.observation.period = "2026-01";
  data.observation.latestAvailablePeriod = "2026-01";
  assert.equal(validateLoanDualBasisObservation(data.rule, data.observation, cutoff), false);
});
test("2025-only quantile diagnostics reproduce the independent frozen scales, not the old 3-month anchors", () => {
  const diagnostic = buildLoanDualBasisScaleDiagnostics(historicalRows);
  assert.notEqual(diagnostic, null);
  for (const [id, expected] of [["F01", [765.5, 2790, 296.75, 799.95]],
    ["F02", [1450, 3800, 1586.111111111111, 2055]]]) {
    const item = diagnostic[id]; assert.equal(item.training.length, 12); assert.equal(item.holdout.length, 8);
    assert.ok(item.training.every((row) => row.period.startsWith("2025-")));
    assert.ok(item.holdout.every((row) => row.period.startsWith("2026-")));
    near(item.latestMonth.absoluteP50, expected[0]); near(item.latestMonth.absoluteP90, expected[1]);
    near(item.cumulativeMonthAverage.absoluteP50, expected[2]); near(item.cumulativeMonthAverage.absoluteP90, expected[3]);
    assert.equal(item.latestMonth.roundedInner, LOAN_TRIAL_SCALES[id].latestMonth.inner);
    assert.equal(item.latestMonth.roundedOuter, LOAN_TRIAL_SCALES[id].latestMonth.outer);
    assert.equal(item.cumulativeMonthAverage.roundedInner, LOAN_TRIAL_SCALES[id].cumulativeMonthAverage.inner);
    assert.equal(item.cumulativeMonthAverage.roundedOuter, LOAN_TRIAL_SCALES[id].cumulativeMonthAverage.outer);
    for (const row of item.training) {
      near(row.yearToDateMoreIncrease, row.current.value - row.previous.value);
      near(row.cumulativeMonthAverage, row.yearToDateMoreIncrease / Number(row.period.slice(5)));
      assert.match(row.current.sourceUrl, /^https:\/\/www\.pbc\.gov\.cn\//);
    }
    const oldAnchors = frozen.indicators.find((rule) => rule.id === id).scoring.anchors;
    assert.notDeepEqual(loanTrialAnchors(item.fixedTrialScales.latestMonth), oldAnchors);
  }
  const noCurrent = historicalRows.filter((row) => row.period < "2026-01");
  const earlier = buildLoanDualBasisScaleDiagnostics(noCurrent);
  for (const id of ["F01", "F02"]) {
    assert.deepEqual(earlier[id].latestMonth, diagnostic[id].latestMonth);
    assert.deepEqual(earlier[id].cumulativeMonthAverage, diagnostic[id].cumulativeMonthAverage);
  }
});
test("incomplete, duplicate or mixed reconstruction calibration rows cannot claim a complete official window", () => {
  for (const mutate of [
    (rows) => rows.filter((row) => row.period !== "2024-06"),
    (rows) => [...rows, structuredClone(rows.find((row) => row.period === "2025-06"))],
    (rows) => rows.map((row) => row.period === "2024-06" ? { ...row, reportedBasis: "month" } : row),
    (rows) => rows.map((row) => row.period === "2025-08" ? { ...row, householdLongYtd: null } : row),
    (rows) => rows.map((row) => row.period === "2025-08" ? { ...row, url: "https://example.com" } : row),
  ]) assert.equal(buildLoanDualBasisScaleDiagnostics(mutate(structuredClone(historicalRows))), null);
});
test("saved diagnostic transparently exposes the short-sample tail saturation and current rounding intervals", () => {
  const saved = read("deliverables/macro-loan-dual-v1-21-calibration.json");
  assert.equal(saved.version, "V1.21"); assert.equal(saved.marker, LOAN_DUAL_BASIS_MARKER);
  for (const id of ["F01", "F02"]) {
    const computed = buildLoanDualBasisScaleDiagnostics(historicalRows)[id], item = saved.rules[id];
    assert.deepEqual(item.latestMonth, computed.latestMonth);
    assert.deepEqual(item.cumulativeMonthAverage, computed.cumulativeMonthAverage);
    assert.deepEqual(item.fixedTrialScales, LOAN_TRIAL_SCALES[id]);
    assert.equal(item.training.length, 12); assert.equal(item.holdout.length, 8);
    near(saved.current[id].points, score(fixture(id)));
    const ranges = saved.current[id].roundingSensitivity;
    assert.ok(ranges.parentScoreInterval[0] <= saved.current[id].points);
    assert.ok(ranges.parentScoreInterval[1] >= saved.current[id].points);
  }
  assert.equal(saved.rules.F01.saturationDiagnostics.holdoutCumulative.atLowerEndpoint, 8);
  assert.equal(saved.rules.F02.saturationDiagnostics.holdoutCumulative.atLowerEndpoint, 5);
  assert.match(saved.status, /不是.*回测/); assert.ok(saved.limits.some((limit) => /正向对称/.test(limit)));
});
test("every new score anchor and rounding endpoint remains finite and auditable", () => {
  for (const id of ["F01", "F02"]) {
    const data = fixture(id);
    for (const part of data.rule.scoring.components) {
      for (const [value, points] of part.anchors) near(interpolateScore(value, part.anchors), points);
      const evidence = data.observation.scoringInputs[part.key], divisor = part.scoreTransform ? 8 : 1;
      const low = interpolateScore((evidence.value - evidence.roundingErrorBound) / divisor, part.anchors);
      const high = interpolateScore((evidence.value + evidence.roundingErrorBound) / divisor, part.anchors);
      assert.ok(low <= high); assert.ok(low >= 1 && high <= 5);
    }
  }
});
test("all previously saved snapshots reproduce with their original methods and component detail shapes", () => {
  for (const snapshot of frozenHistory.snapshots) {
    const current = { asOf: snapshot.asOf, observations: Object.fromEntries(snapshot.rows.map((row) => [row.id, row.observation])) };
    const result = evaluateMacroRating(snapshot.framework, current);
    near(result.formalScore, snapshot.score, 1e-6);
    for (const row of snapshot.rows) near(scoreIndicator(snapshot.framework.indicators.find((rule) => rule.id === row.id),
      row.observation, snapshot.asOf, snapshot.framework.freshness), row.points);
    for (const id of ["F01", "F02"]) {
      const rule = snapshot.framework.indicators.find((item) => item.id === id);
      const observation = current.observations[id];
      assert.equal(isLoanDualBasisRule(rule), false);
      const components = continuousScoreDetails(rule, observation, snapshot.asOf).components;
      assert.equal(components.length, 1); assert.equal(components[0].key, undefined);
      assert.equal(components[0].period, undefined); assert.equal(components[0].scoreValue, undefined);
    }
  }
});
