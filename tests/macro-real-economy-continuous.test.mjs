import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { interpolateScore, scoreContinuous } from "../lib/macro-scoring-continuous.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [baseFramework, baseCurrent, implementation] = await Promise.all([
  readJson("../deliverables/macro-rating-framework-before-v1-16-2026-10-11.json"),
  readJson("../deliverables/macro-rating-current-before-v1-16-2026-10-11.json"),
  readJson("../deliverables/macro-v1-15-real-economy-implementation.json"),
]);
const cutoff = "2026-10-11";
const clone = (value) => structuredClone(value);
const rule = (id) => ({
  ...baseFramework.indicators.find((item) => item.id === id),
  ...implementation.rules.find((item) => item.id === id),
});
const observation = (id) => clone({
  ...baseCurrent.observations[id],
  ...implementation.observations[id],
});
const close = (actual, expected, tolerance = 1e-6) => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${expected}, received ${actual}`);
};
const score = (id, value = observation(id)) => scoreContinuous(rule(id), value, cutoff);

// Actual official values are read from the frozen implementation deliverable.
// All mutations below are synthetic validation-only fixtures, never written to current.
test("all 21 real-economy patches preserve indicator membership and approved weights", () => {
  assert.equal(implementation.rules.length, 21);
  assert.equal(new Set(implementation.rules.map((item) => item.id)).size, 21);
  for (const patch of implementation.rules) {
    const original = baseFramework.indicators.find((item) => item.id === patch.id);
    assert.ok(original);
    assert.equal(Object.hasOwn(patch, "weight"), false);
    assert.ok(patch.requirements.length > 0);
    assert.equal(patch.grades.length, 5);
    assert.match(patch.thresholdStatus, /未完成样本外验证/);
  }
  for (const pillar of ["经济运行", "增长动力"]) {
    close(implementation.rules.filter((item) => rule(item.id).pillar === pillar)
      .reduce((sum, item) => sum + rule(item.id).weight, 0), .3);
  }
});

test("piecewise interpolation distinguishes GDP 4.1 from 4.9, without rounding to hard bins", () => {
  const anchors = rule("E01").scoring.components[0].anchors;
  close(interpolateScore(4.1, anchors), 2.6);
  close(interpolateScore(4.9, anchors), 3.4);
  assert.notEqual(interpolateScore(4.1, anchors), interpolateScore(4.9, anchors));
  close(interpolateScore(-99, anchors), 1);
  close(interpolateScore(99, anchors), 5);
});

test("price functions remain two-sided and do not reward arbitrarily high CPI or PPI", () => {
  close(interpolateScore(2.25, rule("E02").scoring.anchors), 5);
  close(interpolateScore(6, rule("E02").scoring.anchors), 1);
  close(interpolateScore(2.5, rule("E04").scoring.anchors), 5);
  close(interpolateScore(12, rule("E04").scoring.anchors), 1);
  close(score("E02"), 3.3);
  close(score("E03"), 3.5);
  close(score("E04"), 4.6);
});

test("GDP keeps current real growth as raw value and derives trend from adjacent same-vintage quarters", () => {
  const item = observation("E01");
  close(item.value, 4.3);
  close(score("E01", item), 2.7);
  const raw = item.scoringInputs.quarterYoyChange.rawEvidence;
  close(raw.current.value, 4.3);
  close(raw.preceding.value, 5.0);
  assert.equal(raw.current.period, "2026-Q2");
  assert.equal(raw.preceding.period, "2026-Q1");
  assert.equal(raw.current.revisionVersion, raw.preceding.revisionVersion);
});

test("GDP complete score remains sensitive at 4.1 and 4.9 when the same prior quarter is fixed", () => {
  const fixture = (value) => {
    const item = observation("E01");
    item.value = value;
    item.scoringInputs.level.value = value;
    item.scoringInputs.quarterYoyChange.value = value - 5;
    item.scoringInputs.quarterYoyChange.rawEvidence.current.value = value;
    return item;
  };
  close(score("E01", fixture(4.1)), 2.5);
  close(score("E01", fixture(4.9)), 3.3);
});

test("GDP refuses missing trend evidence instead of assigning all weight to the level", () => {
  const item = observation("E01");
  delete item.scoringInputs.quarterYoyChange;
  assert.equal(score("E01", item), null);
});

test("GDP refuses fabricated differences, wrong prior quarters and mixed revisions", () => {
  for (const mutate of [
    (item) => { item.scoringInputs.quarterYoyChange.rawEvidence.preceding.value = 4.8; },
    (item) => { item.scoringInputs.quarterYoyChange.rawEvidence.preceding.period = "2025-Q4"; },
    (item) => { item.scoringInputs.quarterYoyChange.rawEvidence.preceding.revisionVersion = "different-vintage"; },
    (item) => { item.scoringInputs.quarterYoyChange.rawEvidence.current.sourceUrl = "https://example.com/not-official"; },
  ]) {
    const item = observation("E01");
    mutate(item);
    assert.equal(score("E01", item), null);
  }
});

test("PMI uses level 80% and two non-overlapping three-month windows 20%", () => {
  close(score("E08"), 2.74);
  close(score("E09"), 2.58);
  close(score("G11"), 2.7888888889);
  for (const id of ["E08", "E09", "G11"]) {
    const item = observation(id);
    const components = item.scoringInputs.nonOverlappingThreeMonthChange.rawEvidence.components;
    assert.equal(components.length, 6);
    assert.deepEqual(components.map((value) => value.period),
      ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    assert.deepEqual(rule(id).scoring.components.map((value) => value.weight), [.8, .2]);
    close(interpolateScore(50, rule(id).scoring.components[0].anchors), 3);
  }
});

test("PMI missing a month, duplicated months, wrong series or raw values cannot produce a full score", () => {
  for (const id of ["E08", "E09", "G11"]) {
    for (const mutate of [
      (item) => { item.scoringInputs.nonOverlappingThreeMonthChange.rawEvidence.components.pop(); },
      (item) => { item.scoringInputs.nonOverlappingThreeMonthChange.rawEvidence.components[0].period = "2026-05"; },
      (item) => { item.scoringInputs.nonOverlappingThreeMonthChange.rawEvidence.components[0].series = "wrongSeries"; },
      (item) => { item.scoringInputs.nonOverlappingThreeMonthChange.rawEvidence.components[0].value += .1; },
      (item) => { delete item.scoringInputs.nonOverlappingThreeMonthChange; },
    ]) {
      const item = observation(id);
      mutate(item);
      assert.equal(score(id, item), null);
    }
  }
});

test("PMI components must be seasonally adjusted original indices from the original publisher", () => {
  for (const mutate of [
    (item) => { item.scoringInputs.nonOverlappingThreeMonthChange.rawEvidence.components[0].basis = "未经季调当月指数"; },
    (item) => { item.scoringInputs.nonOverlappingThreeMonthChange.rawEvidence.components[0].unit = "%"; },
    (item) => { item.scoringInputs.nonOverlappingThreeMonthChange.rawEvidence.components[0].originalPublisher = "普通媒体"; },
    (item) => { item.scoringInputs.nonOverlappingThreeMonthChange.rawEvidence.components[0].sourceUrl = "https://example.com/news"; },
  ]) {
    const item = observation("E08");
    mutate(item);
    assert.equal(score("E08", item), null);
  }
});

test("industrial profit explicitly combines comparable cumulative and monthly growth with quality", () => {
  const item = observation("G02");
  close(item.value, 15.7);
  close(item.scoringInputs.officialCurrentMonthComparableProfitGrowth.value, 4.2);
  close(item.scoringInputs.reportedProfitMarginYoyChange.value, .44);
  close(item.scoringInputs.reportedReceivablesDaysYoyChange.value, .9);
  assert.deepEqual(rule("G02").scoring.components.map((value) => value.weight), [.6, .2, .1, .1]);
  close(score("G02", item), 3.655);
  assert.match(rule("G02").name, /盈利增长与质量/);
});

test("profit refuses any missing fixed component and never reweights the remaining components", () => {
  for (const key of ["officialCurrentMonthComparableProfitGrowth",
    "reportedProfitMarginYoyChange", "reportedReceivablesDaysYoyChange"]) {
    const item = observation("G02");
    delete item.scoringInputs[key];
    assert.equal(score("G02", item), null);
  }
});

test("profit rejects cumulative growth used as a monthly input and incorrect quality units or dates", () => {
  for (const mutate of [
    (item) => { item.scoringInputs.officialCurrentMonthComparableProfitGrowth.basis = "年初累计可比同比"; },
    (item) => { item.scoringInputs.reportedProfitMarginYoyChange.unit = "%"; },
    (item) => { item.scoringInputs.reportedReceivablesDaysYoyChange.unit = "百分点"; },
    (item) => { item.scoringInputs.reportedProfitMarginYoyChange.period = "2026-07"; },
    (item) => { item.scoringInputs.reportedReceivablesDaysYoyChange.verifiedAt = "2026-09-01"; },
  ]) {
    const item = observation("G02");
    mutate(item);
    assert.equal(score("G02", item), null);
  }
});

test("profit monthly and quality changes must match original reported raw evidence", () => {
  for (const mutate of [
    (item) => { item.scoringInputs.officialCurrentMonthComparableProfitGrowth.rawEvidence.reportedYoyPct = 15.7; },
    (item) => { item.scoringInputs.reportedProfitMarginYoyChange.rawEvidence.reportedYoyChange = .1; },
    (item) => { item.scoringInputs.reportedReceivablesDaysYoyChange.rawEvidence.reportedYoyChange = -.9; },
    (item) => { item.scoringInputs.reportedProfitMarginYoyChange.sourceUrl = "https://example.com/profit-news"; },
    (item) => { item.scoringInputs.reportedReceivablesDaysYoyChange.originalPublisher = "普通媒体"; },
  ]) {
    const item = observation("G02");
    mutate(item);
    assert.equal(score("G02", item), null);
  }
});

test("only surrounding-zero monotonic house-price anchors are implemented; high values merely saturate", () => {
  assert.deepEqual(rule("G15").scoring.anchors, [[-1, 1], [-.5, 2], [0, 3], [.2, 4], [.4, 5]]);
  close(interpolateScore(0, rule("G15").scoring.anchors), 3);
  close(interpolateScore(.4, rule("G15").scoring.anchors), 5);
  close(interpolateScore(2, rule("G15").scoring.anchors), 5);
  assert.match(rule("G15").scoringBasis, /不代表房价涨得越快越健康/);
  close(score("G15"), 2.3666666667, 2e-6);
});

test("capacity remains same-quarter year-on-year percentage-point change, not a PMI or absolute-level component", () => {
  assert.equal(rule("G18").scoring.method, "piecewise-linear");
  close(interpolateScore(0, rule("G18").scoring.anchors), 3);
  close(score("G18"), 2.3333333333);
  assert.equal(observation("G18").unit, "百分点");
});

test("all current real-economy candidates are finite 1–5 continuous scores", () => {
  for (const patch of implementation.rules) {
    const points = score(patch.id);
    assert.equal(typeof points, "number", patch.id);
    assert.ok(points >= 1 && points <= 5, patch.id);
  }
});

