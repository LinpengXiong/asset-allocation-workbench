import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateDeflatorPersistenceInput } from "../lib/macro-deflator-persistence.mjs";
import { interpolateScore } from "../lib/macro-scoring-continuous.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [input, history] = await Promise.all([
  readJson("../deliverables/macro-v1-18-deflator-input.json"),
  readJson("../app/data/macro-gdp-deflator-history.json"),
]);
const cutoff = input.asOf;
const fresh = () => structuredClone(input.currentObservation);
const anchors = input.expectedScores.anchors;
const selected = (observation, lag) => lag === 0 ? observation
  : observation.scoringInputs?.[lag === 1 ? "previousQuarterPriceLevel" : "twoQuartersAgoPriceLevel"];
const validated = (observation, lag, asOf = cutoff) =>
  validateDeflatorPersistenceInput(selected(observation, lag), observation, asOf, lag);
const close = (actual, expected, tolerance = 1e-9) => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${expected}, got ${actual}`);
};
// Local composition tests the complete-input contract without changing shared scoring.
const completePoints = (observation, weights = [0.7, 0.15, 0.15]) => {
  const values = weights.map((_, lag) => validated(observation, lag));
  if (values.some((value) => value === null)) return null;
  return values.reduce((sum, value, lag) => sum + weights[lag] * interpolateScore(value, anchors), 0);
};

test("current and two consecutive prior quarters preserve their original values and complete evidence", () => {
  const observation = fresh();
  const untouched = structuredClone(observation);
  close(validated(observation, 0), 1.526649);
  close(validated(observation, 1), -0.05870403149861314);
  close(validated(observation, 2), -0.6171960835011148);
  assert.deepEqual([0, 1, 2].map((lag) => selected(observation, lag).period),
    ["2026-Q2", "2026-Q1", "2025-Q4"]);
  close(completePoints(observation), input.expectedScores.weightedPoints);
  assert.equal(Number(completePoints(observation).toFixed(2)), 4.03);
  assert.deepEqual(observation, untouched);
  assert.equal(observation.value, input.expectedScores.savedCurrentValue);
});

test("saved six-decimal current value may differ from raw recomputation only by rounding", () => {
  const observation = fresh();
  const raw = observation.gdpDeflatorEvidence;
  const derived = (raw.currentNominal.value / raw.priorNominal.value / (raw.realYoyIndex.value / 100) - 1) * 100;
  close(derived, input.expectedScores.recomputedCurrentValue);
  assert.ok(Math.abs(observation.value - derived) < 1e-6);
  const wrong = fresh();
  wrong.value += 0.00001;
  assert.equal(validated(wrong, 0), null);
});

test("missing either lag refuses a complete score instead of redistributing its weight", () => {
  for (const key of ["previousQuarterPriceLevel", "twoQuartersAgoPriceLevel"]) {
    const observation = fresh();
    delete observation.scoringInputs[key];
    assert.equal(completePoints(observation), null);
  }
  const observation = fresh();
  delete observation.scoringInputs;
  assert.equal(completePoints(observation), null);
});

test("every quarter needs all four raw fields; a valid latest value cannot rescue missing lag evidence", () => {
  for (const lag of [0, 1, 2]) {
    for (const key of ["currentNominal", "priorNominal", "realGrowth", "realYoyIndex"]) {
      const observation = fresh();
      delete selected(observation, lag).gdpDeflatorEvidence[key];
      assert.equal(validated(observation, lag), null, `lag ${lag}, missing ${key}`);
      assert.equal(completePoints(observation), null);
    }
  }
});

test("a corrupted current-quarter raw triple blocks all lag validation too", () => {
  const observation = fresh();
  observation.gdpDeflatorEvidence.priorNominal.value += 1000;
  for (const lag of [0, 1, 2]) assert.equal(validated(observation, lag), null);
});

test("all item and raw GDP evidence must use the same SDDS revision", () => {
  for (const lag of [0, 1, 2]) {
    for (const mutate of [
      (item) => { delete item.revisionVersion; },
      (item) => { item.revisionVersion = "2026-08-15-SDDS"; },
      (item) => { item.gdpDeflatorEvidence.revisionVersion = "different-vintage"; },
      ...["currentNominal", "priorNominal", "realGrowth", "realYoyIndex"].map((key) =>
        (item) => { item.gdpDeflatorEvidence[key].revisionVersion = "older-vintage"; }),
    ]) {
      const observation = fresh();
      mutate(selected(observation, lag));
      assert.equal(validated(observation, lag), null);
      assert.equal(completePoints(observation), null);
    }
  }
});

test("lags cannot skip, duplicate, use future quarters or relabel quarters as months", () => {
  for (const lag of [0, 1, 2]) {
    for (const wrongPeriod of ["2025-Q3", "2026-Q3", "2026-03", "2026-Q5"]) {
      const observation = fresh();
      selected(observation, lag).period = wrongPeriod;
      assert.equal(validated(observation, lag), null);
    }
  }
  const observation = fresh();
  observation.scoringInputs.twoQuartersAgoPriceLevel =
    structuredClone(observation.scoringInputs.previousQuarterPriceLevel);
  assert.equal(completePoints(observation), null);
  for (const lag of [-1, 3, 1.5, "1", NaN, Infinity, undefined]) {
    assert.equal(validateDeflatorPersistenceInput(observation, observation, cutoff, lag), null);
  }
});

test("same-quarter last-year denominator and same-quarter actual growth/index are compulsory", () => {
  for (const lag of [0, 1, 2]) {
    for (const mutate of [
      (raw) => { raw.currentNominal.period = "2024-Q1"; },
      (raw) => { raw.priorNominal.period = raw.currentNominal.period; },
      (raw) => { raw.priorNominal.period = "2024-Q3"; },
      (raw) => { raw.realGrowth.period = "2024-Q1"; },
      (raw) => { raw.realYoyIndex.period = "2024-Q1"; },
    ]) {
      const observation = fresh();
      mutate(selected(observation, lag).gdpDeflatorEvidence);
      assert.equal(validated(observation, lag), null);
    }
  }
});

test("tampered GDP amounts, growth, index or saved price value fail arithmetic consistency", () => {
  for (const lag of [0, 1, 2]) {
    for (const mutate of [
      (item) => { item.value = null; },
      (item) => { item.value += 0.1; },
      (item) => { item.gdpDeflatorEvidence.currentNominal.value += 1000; },
      (item) => { item.gdpDeflatorEvidence.priorNominal.value += 1000; },
      (item) => { item.gdpDeflatorEvidence.priorNominal.value = 0; },
      (item) => { item.gdpDeflatorEvidence.currentNominal.value = -1; },
      (item) => { item.gdpDeflatorEvidence.realGrowth.value += 0.1; },
      (item) => { item.gdpDeflatorEvidence.realGrowth.value = -100; },
      (item) => { item.gdpDeflatorEvidence.realYoyIndex.value += 0.1; },
      (item) => { item.gdpDeflatorEvidence.realYoyIndex.value = 4.3; },
      (item) => { item.gdpDeflatorEvidence.realYoyIndex.value = 0; },
      (item) => { item.gdpDeflatorEvidence.realGrowth.value = NaN; },
      (item) => { item.gdpDeflatorEvidence.priorNominal.value = "341395"; },
    ]) {
      const observation = fresh();
      mutate(selected(observation, lag));
      assert.equal(validated(observation, lag), null);
    }
  }
});

test("derived values and raw triples cannot change units or mix single-quarter and cumulative definitions", () => {
  for (const lag of [0, 1, 2]) {
    for (const mutate of [
      (item) => { item.unit = "百分点"; },
      (item) => { item.basis = "年初累计同比"; },
      (item) => { item.latestAvailablePeriod = "2026-Q2" === item.period ? "2026-Q1" : "2026-Q2"; },
      (item) => { item.gdpDeflatorEvidence.currentNominal.unit = "万亿元"; },
      (item) => { item.gdpDeflatorEvidence.priorNominal.basis = "年初累计现价GDP"; },
      (item) => { item.gdpDeflatorEvidence.realGrowth.basis = "年初累计实际同比"; },
      (item) => { item.gdpDeflatorEvidence.realYoyIndex.unit = "%"; },
      (item) => { item.gdpDeflatorEvidence.realYoyIndex.basis = "季调环比指数"; },
    ]) {
      const observation = fresh();
      mutate(selected(observation, lag));
      assert.equal(validated(observation, lag), null);
    }
  }
});

test("release, verification, revision and cutoff dates reject future or impossible evidence", () => {
  for (const lag of [0, 1, 2]) {
    for (const mutate of [
      (item) => { item.releaseDate = "2026-05-01"; },
      (item) => { item.releaseDate = "2026-10-12"; },
      (item) => { item.releaseDate = "2026-02-30"; },
      (item) => { item.verifiedAt = "2026-10-12"; },
      (item) => { item.verifiedAt = "2026-09-14"; },
      (item) => { item.gdpDeflatorEvidence.priorNominal.releaseDate = "2024-01-01"; },
      (item) => { item.gdpDeflatorEvidence.currentNominal.releaseDate = "2026-05-01"; },
      (item) => { item.gdpDeflatorEvidence.realYoyIndex.verifiedAt = "2026-10-12"; },
      (item) => { item.gdpDeflatorEvidence.realYoyIndex.verifiedAt = "2026-09-14"; },
      (item) => { item.gdpDeflatorEvidence.realGrowth.verifiedAt = "2026-10-12"; },
    ]) {
      const observation = fresh();
      mutate(selected(observation, lag));
      assert.equal(validated(observation, lag), null);
    }
  }
  for (const asOf of ["2026-09-14", "2026-02-30", "2026-10", null, undefined]) {
    const observation = fresh();
    assert.equal(validateDeflatorPersistenceInput(observation, observation, asOf, 0), null);
  }
});

test("a self-consistent future quarter still cannot be published before its quarter ends", () => {
  const observation = fresh();
  observation.period = observation.latestAvailablePeriod = "2026-Q3";
  const raw = observation.gdpDeflatorEvidence;
  raw.period = raw.currentNominal.period = raw.realGrowth.period = raw.realYoyIndex.period = "2026-Q3";
  raw.priorNominal.period = "2025-Q3";
  assert.equal(validated(observation, 0), null);
});

test("publisher, exact same raw source, HTTPS and verification status are checked for all inputs", () => {
  for (const lag of [0, 1, 2]) {
    for (const mutate of [
      (item) => { item.verified = false; },
      (item) => { item.originalPublisher = "普通媒体"; },
      (item) => { item.sourceUrl = "https://stats.gov.cn.example.com/fake"; },
      (item) => { item.sourceUrl = "http://www.stats.gov.cn/"; },
      (item) => { item.sourceUrl = "https://user:password@www.stats.gov.cn/"; },
      (item) => { item.gdpDeflatorEvidence.currentNominal.sourceUrl = "https://example.com/news"; },
      (item) => { item.gdpDeflatorEvidence.priorNominal.sourceUrl = "https://www.stats.gov.cn/another-page.html"; },
      (item) => { item.gdpDeflatorEvidence.realGrowth.originalPublisher = "媒体转述"; },
      (item) => { item.gdpDeflatorEvidence.realYoyIndex.verified = false; },
    ]) {
      const observation = fresh();
      mutate(selected(observation, lag));
      assert.equal(validated(observation, lag), null);
    }
  }
});

test("an arbitrary statistics-bureau page is not silently accepted as the SDDS raw table", () => {
  const observation = fresh();
  for (const lag of [0, 1, 2]) {
    const item = selected(observation, lag);
    item.sourceUrl = "https://www.stats.gov.cn/not-the-sdds-table.html";
    for (const key of ["currentNominal", "priorNominal", "realGrowth", "realYoyIndex"]) {
      item.gdpDeflatorEvidence[key].sourceUrl = item.sourceUrl;
    }
  }
  assert.equal(completePoints(observation), null);
});

test("historical comparison uses the same 44 quarters and reproduces fixed 60/70/80 sensitivity", () => {
  const rawRows = history.rows.filter((row) => row.period >= "2015-Q1"
    && row.vintage === input.historicalDiagnostics.revisionVersion)
    .sort((a, b) => a.period.localeCompare(b.period));
  assert.equal(rawRows.length, 46);
  const values = rawRows.map((row) => (row.nominalGdp / row.priorYearNominalGdp / (row.realGdpIndex / 100) - 1) * 100);
  const levels = values.map((value) => interpolateScore(value, anchors));
  const common = rawRows.slice(2);
  assert.equal(common.length, 44);
  assert.equal(common[0].period, "2015-Q3");
  assert.equal(common.at(-1).period, "2026-Q2");
  const mean = (rows) => rows.reduce((sum, value) => sum + value, 0) / rows.length;
  const metrics = (scores) => ({
    mean: mean(scores),
    absChange: mean(scores.slice(1).map((value, index) => Math.abs(value - scores[index]))),
    changes: scores.slice(1).filter((value, index) => Math.abs(value - scores[index]) > 0.5).length,
    high: scores.filter((value) => value >= 4.5).length,
  });
  const baseline = metrics(levels.slice(2));
  close(baseline.mean, input.historicalDiagnostics.baseline44.meanScore);
  close(baseline.absChange, input.historicalDiagnostics.baseline44.averageAbsoluteScoreChange);
  assert.equal(baseline.changes, input.historicalDiagnostics.baseline44.changesAboveHalfPoint);
  assert.equal(baseline.high, input.historicalDiagnostics.baseline44.scoresAtLeast4Point5);
  for (const candidate of input.historicalDiagnostics.sensitivity) {
    const scores = levels.slice(2).map((latest, index) => candidate.currentWeight * latest
      + (1 - candidate.currentWeight) * (levels[index] + levels[index + 1]) / 2);
    const actual = metrics(scores);
    close(scores.at(-1), candidate.currentPointsFromUnroundedRaw);
    close(actual.mean, candidate.meanScore);
    close(actual.absChange, candidate.averageAbsoluteScoreChange);
    assert.equal(actual.changes, candidate.changesAboveHalfPoint);
    assert.equal(actual.high, candidate.scoresAtLeast4Point5);
    const recent = scores.filter((_, index) => common[index].period >= "2024-Q1");
    assert.equal(recent.length, candidate.recent2024On.n);
    close(metrics(recent).absChange, candidate.recent2024On.averageAbsoluteScoreChange);
    assert.equal(metrics(recent).changes, candidate.recent2024On.changesAboveHalfPoint);
  }
  assert.match(input.historicalDiagnostics.limitations.join(" "), /不是经济误报率/);
  assert.match(input.historicalDiagnostics.limitations.join(" "), /非回测最优/);
});
