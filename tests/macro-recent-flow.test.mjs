import assert from "node:assert/strict";
import test from "node:test";
import {
  RECENT_FISCAL_BASIS, RECENT_FISCAL_KEY, RECENT_PROFIT_BASIS, RECENT_PROFIT_KEY,
  RECENT_PROFIT_SCOPE, validateRecentFiscalInput, validateRecentProfitInput,
} from "../lib/macro-recent-flow.mjs";

// Synthetic records exercise the evidence contract; no fixture is claimed to be
// a retrieved official observation or used as production macro data.
const cutoff = "2026-10-11";
const close = (actual, expected) => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} != ${expected}`);
};
const publishDate = (period) => {
  const year = Number(period.slice(0, 4)), month = Number(period.slice(5));
  return `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-28`;
};
const metadata = (period, publisher) => ({
  period, releaseDate: publishDate(period), verifiedAt: cutoff, verified: true,
  originalPublisher: publisher,
  sourceUrl: publisher === "财政部"
    ? `https://gks.mof.gov.cn/tongjishuju/${period.replace("-", "")}/fixture.htm`
    : `https://www.stats.gov.cn/sj/zxfb/${period.replace("-", "")}/fixture.html`,
});
const fiscalFixture = (series = "generalBudgetExpenditure") => {
  const amount = (value, period) => ({ ...metadata(period, "财政部"), value,
    unit: "亿元", basis: "年初累计支出金额", scope: "全国", series });
  const current = { start: amount(1200, "2026-05"), end: amount(1900, "2026-08") };
  const yearAgo = { start: amount(1000, "2025-05"), end: amount(1800, "2025-08") };
  const observation = { ...metadata("2026-08", "财政部"), value: 5.5, unit: "%",
    basis: "全国年初累计支出可比同比", latestAvailablePeriod: "2026-08",
    fiscalExpenditure: { period: "2026-08", series, scope: "全国", unit: "亿元",
      basis: "年初累计可比同比", cumulativeExpenditure: 1900, reportedYoyPct: 5.5 } };
  const input = { ...metadata("2026-08", "财政部"), key: RECENT_FISCAL_KEY,
    value: -12.5, unit: "%", basis: RECENT_FISCAL_BASIS, latestAvailablePeriod: "2026-08",
    rawEvidence: { kind: "rolling-three-month-cumulative-amounts", current, yearAgo,
      comparability: { sameScope: true, revisionNote: "四端全国同预算支出累计金额，已核对修订说明。" } } };
  return { input, observation, series };
};
const fiscalValid = ({ input, observation, series }, asOf = cutoff) =>
  validateRecentFiscalInput(input, observation, asOf, series);
const fiscalParts = (fixture) => [fixture.input.rawEvidence.current.start,
  fixture.input.rawEvidence.current.end, fixture.input.rawEvidence.yearAgo.start,
  fixture.input.rawEvidence.yearAgo.end];
const profitFixture = () => {
  const monthly = (value, period) => ({ ...metadata(period, "国家统计局"), value, unit: "%",
    basis: "当月可比同比", scope: RECENT_PROFIT_SCOPE,
    rawEvidence: { reportedYoyPct: value, notDerivedFromPublishedAmounts: true,
      aggregation: `${Number(period.slice(5))}月单月` } });
  const parts = [monthly(20, "2026-06"), monthly(-5, "2026-07"), monthly(3, "2026-08")];
  const observation = { ...metadata("2026-08", "国家统计局"), value: 15, unit: "%",
    basis: "年初累计可比同比", latestAvailablePeriod: "2026-08",
    profitQuality: { sameScope: true, period: "2026-08" }, scoringInputs: {
      officialCurrentMonthComparableProfitGrowth: { ...structuredClone(parts.at(-1)), latestAvailablePeriod: "2026-08" },
    } };
  const input = { ...metadata("2026-08", "国家统计局"), key: RECENT_PROFIT_KEY,
    value: 6, unit: "%", basis: RECENT_PROFIT_BASIS, scope: RECENT_PROFIT_SCOPE,
    label: "近三个月官方单月利润可比同比均值", latestAvailablePeriod: "2026-08",
    rawEvidence: { kind: "official-monthly-yoy-mean", components: parts } };
  return { input, observation };
};
const profitValid = ({ input, observation }, asOf = cutoff) => validateRecentProfitInput(input, observation, asOf);

test("both fiscal budgets derive a recent amount growth without altering cumulative official growth", () => {
  for (const series of ["generalBudgetExpenditure", "governmentFundExpenditure"]) {
    const fixture = fiscalFixture(series), original = structuredClone(fixture);
    close(fiscalValid(fixture), -12.5);
    assert.equal(fixture.observation.value, 5.5);
    assert.deepEqual(fixture, original);
  }
});

test("fiscal four-end raw amounts are mandatory, not cumulative growth-rate substitutes", () => {
  for (const path of ["current", "yearAgo"]) for (const end of ["start", "end"]) {
    const missing = fiscalFixture();
    delete missing.input.rawEvidence[path][end];
    assert.equal(fiscalValid(missing), null);
    for (const change of [
      (part) => { part.unit = "%"; },
      (part) => { part.basis = "年初累计可比同比"; },
      (part) => { part.value = -1; },
      (part) => { part.value = "1900"; },
      (part) => { part.value = Number.NaN; },
    ]) {
      const fixture = fiscalFixture();
      change(fixture.input.rawEvidence[path][end]);
      assert.equal(fiscalValid(fixture), null);
    }
  }
});

test("fiscal scope, budget series and comparative-vintage note cannot be borrowed or omitted", () => {
  for (let index = 0; index < 4; index++) for (const change of [
    (part) => { part.scope = "地方"; },
    (part) => { part.series = "governmentFundExpenditure"; },
    (part) => { part.series = "budgetRevenue"; },
  ]) {
    const fixture = fiscalFixture(); change(fiscalParts(fixture)[index]);
    assert.equal(fiscalValid(fixture), null);
  }
  for (const change of [
    (f) => { f.series = "other"; },
    (f) => { f.observation.fiscalExpenditure.series = "governmentFundExpenditure"; },
    (f) => { f.input.rawEvidence.comparability.sameScope = false; },
    (f) => { f.input.rawEvidence.comparability.revisionNote = "  "; },
    (f) => { delete f.input.rawEvidence.comparability; },
  ]) {
    const fixture = fiscalFixture(); change(fixture);
    assert.equal(fiscalValid(fixture), null);
  }
});

test("fiscal windows must be two matching, non-reset, complete three-month periods", () => {
  for (const change of [
    (f) => { f.input.rawEvidence.current.start.period = "2026-06"; },
    (f) => { f.input.rawEvidence.yearAgo.start.period = "2025-04"; },
    (f) => { f.input.rawEvidence.yearAgo.end.period = "2025-07"; },
    (f) => { f.input.rawEvidence.current.start.period = "2025-12"; },
    (f) => { f.input.rawEvidence.current.end.period = "2026-03"; },
  ]) {
    const fixture = fiscalFixture(); change(fixture);
    assert.equal(fiscalValid(fixture), null);
  }
  // Even arithmetically matching January–April endpoints are not accepted: the
  // February monthly amount cannot be separated from a 1–2 month publication.
  const early = fiscalFixture();
  for (const [record, period] of [[early.input.rawEvidence.current.start, "2026-01"],
    [early.input.rawEvidence.current.end, "2026-04"], [early.input.rawEvidence.yearAgo.start, "2025-01"],
    [early.input.rawEvidence.yearAgo.end, "2025-04"]]) Object.assign(record, metadata(period, "财政部"));
  for (const record of [early.input, early.observation]) Object.assign(record,
    metadata("2026-04", "财政部"), { latestAvailablePeriod: "2026-04" });
  early.observation.fiscalExpenditure.period = "2026-04";
  assert.equal(fiscalValid(early), null);
});

test("March–May is the earliest complete fiscal window after a combined January–February amount", () => {
  const fixture = fiscalFixture();
  for (const [record, period] of [[fixture.input.rawEvidence.current.start, "2026-02"],
    [fixture.input.rawEvidence.current.end, "2026-05"], [fixture.input.rawEvidence.yearAgo.start, "2025-02"],
    [fixture.input.rawEvidence.yearAgo.end, "2025-05"]]) Object.assign(record, metadata(period, "财政部"));
  for (const record of [fixture.input, fixture.observation]) Object.assign(record,
    metadata("2026-05", "财政部"), { latestAvailablePeriod: "2026-05" });
  fixture.observation.fiscalExpenditure.period = "2026-05";
  close(fiscalValid(fixture), -12.5);
});

test("nonpositive fiscal recent amounts and zero prior-year denominators refuse a score", () => {
  for (const [path, value] of [["current", 1200], ["current", 1000], ["yearAgo", 1000], ["yearAgo", 900]]) {
    const fixture = fiscalFixture(); fixture.input.rawEvidence[path].end.value = value;
    if (path === "current") fixture.observation.fiscalExpenditure.cumulativeExpenditure = value;
    assert.equal(fiscalValid(fixture), null);
  }
});

test("fiscal derived rate is recomputed with a six-decimal tolerance and latest official amount cross-check", () => {
  const rounded = fiscalFixture(); rounded.input.value += 0.0000005;
  close(fiscalValid(rounded), -12.5);
  for (const change of [
    (f) => { f.input.value = f.observation.value; },
    (f) => { f.input.value += 0.00001; },
    (f) => { f.observation.fiscalExpenditure.cumulativeExpenditure += 1; },
    (f) => { f.observation.fiscalExpenditure.reportedYoyPct += 1; },
    (f) => { f.input.rawEvidence.kind = "cumulative-yoy-difference"; },
    (f) => { f.input.basis = "近3月累计同比均值"; },
    (f) => { f.input.key = "officialThreeMonthProfitGrowthMean"; },
  ]) {
    const fixture = fiscalFixture(); change(fixture);
    assert.equal(fiscalValid(fixture), null);
  }
});

test("fiscal rejects old six-month substitutes and stale input periods", () => {
  for (const change of [
    (f) => { f.input.period = "2026-06"; },
    (f) => { f.input.latestAvailablePeriod = "2026-06"; },
    (f) => { f.observation.latestAvailablePeriod = "2026-06"; },
    (f) => { f.input.rawEvidence.current.start.period = "2026-02"; },
    (f) => { f.input.rawEvidence.yearAgo.start.period = "2025-02"; },
  ]) {
    const fixture = fiscalFixture(); change(fixture);
    assert.equal(fiscalValid(fixture), null);
  }
});

test("fiscal every raw and derived record needs verified official metadata and cutoff-safe publication dates", () => {
  for (let index = 0; index < 6; index++) for (const change of [
    (part) => { part.verified = false; },
    (part) => { delete part.verifiedAt; },
    (part) => { part.originalPublisher = "媒体"; },
    (part) => { part.sourceUrl = "http://gks.mof.gov.cn/table.htm"; },
    (part) => { part.sourceUrl = "https://mof.gov.cn.evil.example/table.htm"; },
    (part) => { part.sourceUrl = "https://user:secret@gks.mof.gov.cn/table.htm"; },
    (part) => { part.releaseDate = "2025-01-01"; },
    (part) => { part.releaseDate = "2026-02-30"; },
    (part) => { part.verifiedAt = "2026-10-12"; },
  ]) {
    const fixture = fiscalFixture(); change([...fiscalParts(fixture), fixture.input, fixture.observation][index]);
    assert.equal(fiscalValid(fixture), null, `record ${index}`);
  }
  assert.equal(fiscalValid(fiscalFixture(), "2026-08-31"), null);
  assert.equal(fiscalValid(fiscalFixture(), "invalid"), null);
});

test("three official monthly profit rates form an unweighted mean rather than an amount-sum growth", () => {
  const fixture = profitFixture(), original = structuredClone(fixture);
  close(profitValid(fixture), 6);
  assert.equal(fixture.observation.value, 15);
  assert.deepEqual(fixture, original);
});

test("profit requires three consecutive complete official monthly publications, not estimated combined months", () => {
  for (const change of [
    (f) => { f.input.rawEvidence.components.pop(); },
    (f) => { f.input.rawEvidence.components.push(structuredClone(f.input.rawEvidence.components[2])); },
    (f) => { f.input.rawEvidence.components[0].period = "2026-05"; },
    (f) => { f.input.rawEvidence.components[1].period = "2026-08"; },
    (f) => { f.input.rawEvidence.components.reverse(); },
    (f) => { f.input.rawEvidence.kind = "rolling-three-month-cumulative-amounts"; },
    (f) => { delete f.input.rawEvidence; },
  ]) {
    const fixture = profitFixture(); change(fixture);
    assert.equal(profitValid(fixture), null);
  }
  for (const firstMonth of ["01", "02"]) {
    const fixture = profitFixture();
    for (let index = 0; index < 3; index++) {
      const part = fixture.input.rawEvidence.components[index];
      const period = `2026-${String(Number(firstMonth) + index).padStart(2, "0")}`;
      Object.assign(part, metadata(period, "国家统计局"));
      part.rawEvidence.aggregation = `${Number(period.slice(5))}月单月`;
    }
    const latest = fixture.input.rawEvidence.components.at(-1);
    for (const record of [fixture.input, fixture.observation]) Object.assign(record,
      metadata(latest.period, "国家统计局"), { latestAvailablePeriod: latest.period });
    fixture.observation.profitQuality.period = latest.period;
    fixture.observation.scoringInputs.officialCurrentMonthComparableProfitGrowth = {
      ...structuredClone(latest), latestAvailablePeriod: latest.period };
    assert.equal(profitValid(fixture), null);
  }
});

test("profit rates must be directly reported comparable monthly rates with identical scope", () => {
  for (let index = 0; index < 3; index++) for (const change of [
    (part) => { part.unit = "亿元"; },
    (part) => { part.scope = "全国全部工业企业"; },
    (part) => { part.basis = "年初累计可比同比"; },
    (part) => { part.rawEvidence.notDerivedFromPublishedAmounts = false; },
    (part) => { part.rawEvidence.reportedYoyPct += 0.1; },
    (part) => { part.rawEvidence.aggregation = "1—8月累计"; },
    (part) => { delete part.rawEvidence; },
  ]) {
    const fixture = profitFixture(); change(fixture.input.rawEvidence.components[index]);
    assert.equal(profitValid(fixture), null);
  }
});

test("profit metadata rejects unverified, future, pre-period, invalid-date and nonofficial evidence", () => {
  for (let index = 0; index < 5; index++) for (const change of [
    (part) => { part.verified = false; },
    (part) => { part.originalPublisher = "财经媒体"; },
    (part) => { part.sourceUrl = "https://stats.gov.cn.evil.example/table.html"; },
    (part) => { part.sourceUrl = "http://www.stats.gov.cn/table.html"; },
    (part) => { part.verifiedAt = "2026-10-12"; },
    (part) => { part.releaseDate = "2026-06-01"; },
    (part) => { part.releaseDate = "2026-09-31"; },
    (part) => { delete part.verifiedAt; },
  ]) {
    const fixture = profitFixture(); change([...fixture.input.rawEvidence.components, fixture.input, fixture.observation][index]);
    assert.equal(profitValid(fixture), null, `record ${index}`);
  }
  assert.equal(profitValid(profitFixture(), "2026-08-31"), null);
});

test("profit arithmetic, latest month and name must not imply a sum-of-amounts rate", () => {
  for (const change of [
    (f) => { f.input.value = f.observation.value; },
    (f) => { f.input.value += 0.00001; },
    (f) => { f.input.latestAvailablePeriod = "2026-07"; },
    (f) => { f.input.period = "2026-07"; },
    (f) => { f.input.basis = "近3月利润金额合计同比"; },
    (f) => { f.input.label = "近3月利润金额合计同比"; },
    (f) => { f.input.label = "近3月利润增速"; },
    (f) => { f.input.scope = "全国全部工业企业"; },
    (f) => { f.input.key = RECENT_FISCAL_KEY; },
    (f) => { f.observation.profitQuality.sameScope = false; },
    (f) => { f.observation.profitQuality.period = "2026-07"; },
    (f) => { f.observation.scoringInputs.officialCurrentMonthComparableProfitGrowth.value += 1; },
  ]) {
    const fixture = profitFixture(); change(fixture);
    assert.equal(profitValid(fixture), null);
  }
  const rounded = profitFixture(); rounded.input.value += 0.0000005;
  close(profitValid(rounded), 6);
});

test("validators are additive evidence gates: old records are neither overwritten nor retrofitted", () => {
  const historical = { version: "frozen-before-recent-flow", observations: {
    fiscal: fiscalFixture().observation, profit: profitFixture().observation } };
  const serialized = JSON.stringify(historical);
  for (const original of [historical.observations.fiscal, historical.observations.profit]) {
    assert.equal(validateRecentFiscalInput(undefined, original, cutoff, "generalBudgetExpenditure"), null);
    assert.equal(validateRecentProfitInput(undefined, original, cutoff), null);
  }
  close(fiscalValid(fiscalFixture()), -12.5);
  close(profitValid(profitFixture()), 6);
  assert.equal(JSON.stringify(historical), serialized);
  assert.equal(validateRecentFiscalInput(null, null, cutoff, "generalBudgetExpenditure"), null);
  assert.equal(validateRecentProfitInput(null, null, cutoff), null);
});
