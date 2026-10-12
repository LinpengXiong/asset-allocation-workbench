import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { interpolateScore } from "../lib/macro-scoring-continuous.mjs";
import { scoreIndicator, evaluateMacroRating } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord } from "../lib/macro-rating-record.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
// Preserve the completed V1.16 scale calibration independently of later focused revisions.
const framework = read("deliverables/macro-rating-framework-before-v1-17-2026-10-11.json");
const current = read("deliverables/macro-rating-current-before-v1-17-2026-10-11.json");
const old = read("deliverables/macro-rating-framework-before-v1-16-2026-10-11.json");
const oldCurrent = read("deliverables/macro-rating-current-before-v1-16-2026-10-11.json");
const history = read("deliverables/macro-rating-history-before-v1-17-2026-10-11.json");
const audits = ["real", "credit", "policy"].map((area) => read(`deliverables/macro-v1-16-${area}-calibration.json`));
const curves = (rule) => rule.scoring.anchors ? [rule.scoring.anchors] : rule.scoring.components?.map((part) => part.anchors) ?? [];

test("scale calibration preserves every approved weight, raw observation and information cutoff", () => {
  assert.equal(framework.version, "V1.16");
  assert.equal(current.version, framework.version);
  assert.equal(current.asOf, oldCurrent.asOf);
  assert.deepEqual(framework.pillars, old.pillars);
  assert.deepEqual(framework.ratingBands, old.ratingBands);
  assert.deepEqual(framework.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })), old.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })));
  for (const rule of framework.indicators) {
    const before = structuredClone(oldCurrent.observations[rule.id]); delete before.rationale;
    const after = structuredClone(current.observations[rule.id]); delete after.rationale;
    assert.deepEqual(after, before, `${rule.id}: do not invent a historical observation while tuning scores`);
    assert.ok(rule.calibration.reason && rule.calibration.sampleSummary);
    assert.ok(rule.calibration.limitations.length);
  }
  assert.equal(audits.flatMap((area) => area.rules).length, 37);
  assert.equal(framework.calibrationReview.adjustedCount + framework.calibrationReview.retainedCount, 37);
  assert.match(current.observations.E01.rationale, /同比较前季变化-0\.7百分点/);
  assert.doesNotMatch(current.observations.E01.rationale, /-0\.7000000000000002/);
});

test("GDP central responses improve without a discontinuous cliff or changing component weights", () => {
  const rule = framework.indicators.find((entry) => entry.id === "E01");
  const oldRule = old.indicators.find((entry) => entry.id === "E01");
  assert.deepEqual(rule.scoring.components.map(({ key, weight }) => ({ key, weight })), oldRule.scoring.components.map(({ key, weight }) => ({ key, weight })));
  const anchors = rule.scoring.components[0].anchors;
  assert.equal(interpolateScore(4.5, anchors), 3);
  assert.ok(interpolateScore(3.5, anchors) < interpolateScore(3.5, oldRule.scoring.components[0].anchors));
  const sensitivity = Math.abs(interpolateScore(4.6, anchors) - interpolateScore(4.4, anchors));
  assert.ok(sensitivity > Math.abs(interpolateScore(4.6, oldRule.scoring.components[0].anchors) - interpolateScore(4.4, oldRule.scoring.components[0].anchors)));
  for (const item of framework.indicators) for (const values of curves(item)) for (const [value, points] of values) {
    assert.equal(interpolateScore(value, values), points);
    for (const delta of [-1e-8, 1e-8]) assert.ok(Math.abs(interpolateScore(value + delta, values) - points) < 1e-6, item.id);
  }
});

test("no calibration bypasses evidence gates; incomplete GDP components remain unscored", () => {
  for (const rule of framework.indicators) {
    const observation = current.observations[rule.id];
    assert.notEqual(scoreIndicator(rule, observation, current.asOf, framework.freshness), null, rule.id);
    for (const mutation of [{ verified: false }, { releaseDate: "2099-01-01" }, { unit: "错误单位" }, { basis: "错误口径" }]) {
      assert.equal(scoreIndicator(rule, { ...structuredClone(observation), ...mutation }, current.asOf, framework.freshness), null, rule.id);
    }
  }
  const rule = framework.indicators.find((entry) => entry.id === "E01");
  const incomplete = structuredClone(current.observations.E01); delete incomplete.scoringInputs.quarterYoyChange;
  assert.equal(scoreIndicator(rule, incomplete, current.asOf, framework.freshness), null);
});

test("same-cutoff recalculation is archived as rule revision, not claimed economic improvement", () => {
  const result = evaluateMacroRating(framework, current), prior = evaluateMacroRating(old, oldCurrent);
  assert.equal(result.status, "正式");
  assert.ok(Math.abs(result.coverage - 1) < 1e-9);
  assert.match(current.revisionComparison.kind, /不是经济变化/);
  assert.ok(Math.abs(current.revisionComparison.rows.reduce((sum, row) => sum + row.contributionChange, 0) - (result.formalScore - prior.formalScore)) < 1e-9);
  assert.deepEqual(history.snapshots, [createMacroRatingRecord(framework, current)]);
  assert.equal(read("deliverables/macro-rating-history-before-v1-16-2026-10-11.json").snapshots[0].version, "V1.15");
});

test("all credit candidates use the same complete monthly sample and preserve original current values", () => {
  const credit = audits[1];
  const monthly = credit.rules.filter((entry) => entry.scoring.method === "piecewise-linear");
  for (const rule of monthly) {
    assert.equal(rule.sampleSummary.n, 29);
    assert.deepEqual(rule.sampleSummary.missingMonths, []);
    assert.equal(rule.candidates.length, 3);
    assert.ok(rule.candidates.every((candidate) => candidate.diagnostics.n === 29));
    for (const candidate of rule.candidates) for (const pair of candidate.diagnostics.pairs) {
      assert.ok(Math.abs(interpolateScore(pair.value, candidate.scoring.anchors) - pair.score) < 1e-6, rule.id);
    }
  }
  for (const id of ["F09", "F10"]) {
    const rule = framework.indicators.find((entry) => entry.id === id);
    assert.equal(rule.calibration.decision, "保留");
    assert.equal(scoreIndicator(rule, current.observations[id], current.asOf, framework.freshness), 2.5);
  }
});

test("public calibration notes preserve real sample diagnostics and policy candidate labels", () => {
  const gdp = framework.indicators.find((entry) => entry.id === "E01").calibration;
  assert.equal(gdp.comparisons.length, 3);
  assert.ok(gdp.comparisons.every((entry) => /45期/.test(entry.summary) && /2024年以来10期/.test(entry.summary)));
  assert.deepEqual(gdp.comparisons.map((entry) => entry.label), ["现版", "适度收窄", "明显收窄"]);
  const policy = framework.indicators.find((entry) => entry.id === "P01E").calibration;
  assert.match(policy.sampleSummary, /18个可核验观察/);
  assert.ok(policy.comparisons.every((entry) => /同年连续期对3组/.test(entry.summary)));
  assert.deepEqual(policy.comparisons.map((entry) => entry.label), ["现版", "适度收窄", "明显收窄"]);
  for (const id of ["P03A", "P03B", "P04A", "P04B"]) {
    const item = framework.indicators.find((entry) => entry.id === id);
    assert.deepEqual(item.scoring, old.indicators.find((entry) => entry.id === id).scoring);
    assert.match(item.calibration.sampleSummary, /不进行数值插值/);
  }
});

test("fiscal candidates reproduce each original success without inventing a continuous six-year history", () => {
  const policy = audits[2];
  for (const id of ["P01E", "P01F"]) {
    const item = policy.rules.find((entry) => entry.id === id);
    assert.equal(item.sampleSummary.observedChangeCount, 18);
    assert.equal(item.candidates.length, 3);
    for (const candidate of item.candidates) {
      assert.equal(candidate.diagnostics.adjacentWithinYearCount, 3);
      assert.equal(candidate.diagnostics.scores.length, item.sampleSummary.observedChangeCount);
      for (const row of candidate.diagnostics.scores) {
        assert.ok(item.sampleEvidence.some((source) => source.period === row.period && source.value === row.value));
        assert.ok(Math.abs(interpolateScore(row.value, candidate.anchors) - row.score) < 1e-9);
      }
    }
    assert.deepEqual(item.scoring, old.indicators.find((entry) => entry.id === id).scoring);
  }
});
