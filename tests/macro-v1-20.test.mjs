import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { continuousScoreDetails, interpolateScore } from "../lib/macro-scoring-continuous.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const framework = read("deliverables/macro-rating-framework-before-v1-21-2026-10-11.json"), current = read("deliverables/macro-rating-current-before-v1-21-2026-10-11.json"), history = read("deliverables/macro-rating-history-before-v1-21-2026-10-11.json");
const before = read("deliverables/macro-rating-framework-before-v1-20-2026-10-11.json"), oldCurrent = read("deliverables/macro-rating-current-before-v1-20-2026-10-11.json"), oldHistory = read("deliverables/macro-rating-history-before-v1-20-2026-10-11.json");
const ids = ["G01", "G17", "G10", "P01E", "P01F", "G02"];
const rule = (id) => framework.indicators.find((item) => item.id === id);
const details = (id, observation = current.observations[id]) => continuousScoreDetails(rule(id), observation, current.asOf);
const score = (id, observation = current.observations[id]) => scoreIndicator(rule(id), observation, current.asOf, framework.freshness);
const near = (a, b, tolerance = 1e-9) => assert.ok(Number.isFinite(a) && Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("V1.20 keeps all 38 parent indicators, approved weights and original primary evidence", () => {
  assert.equal(framework.version, "V1.20"); assert.equal(current.version, framework.version);
  assert.equal(framework.indicators.length, 38); assert.deepEqual(framework.pillars, before.pillars);
  assert.deepEqual(framework.ratingBands, before.ratingBands); assert.deepEqual(framework.freshness, before.freshness);
  for (const previous of before.indicators) {
    assert.equal(rule(previous.id).weight, previous.weight);
    for (const key of ["value", "period", "unit", "basis", "sourceUrl", "releaseDate", "verifiedAt", "originalPublisher", "latestAvailablePeriod"])
      assert.deepEqual(current.observations[previous.id][key], oldCurrent.observations[previous.id][key], `${previous.id}: ${key}`);
    if (!ids.includes(previous.id)) {
      assert.deepEqual(rule(previous.id), previous);
      assert.deepEqual(current.observations[previous.id], oldCurrent.observations[previous.id]);
    }
  }
  for (const [pillar, weight] of Object.entries(framework.pillars)) near(framework.indicators.filter((item) => item.pillar === pillar).reduce((sum, item) => sum + item.weight, 0), weight);
});

test("five double-basis indicators score two separate raw values at their published fixed allocations", () => {
  const expected = { G01: [.4, .6, 5.3, 5.2], G17: [.4, .6, 1, .3], G10: [.5, .5, 19.3, 25],
    P01E: [.4, .6, 1.2, (18562 / 18587 - 1) * 100], P01F: [.6, .4, -17, (6538 / 8315 - 1) * 100] };
  for (const [id, [cumWeight, monthWeight, cumValue, monthValue]] of Object.entries(expected)) {
    const item = rule(id), parts = details(id).components;
    assert.equal(item.displayComponents, true);
    assert.equal(item.scoring.dualBasis, "year-to-date-and-latest-month");
    assert.deepEqual(parts.map((part) => part.key), ["yearToDateGrowth", "latestMonthGrowth"]);
    near(parts[0].weight, cumWeight); near(parts[1].weight, monthWeight);
    near(parts[0].value, cumValue, 1e-6); near(parts[1].value, monthValue, 1e-6);
    near(parts.reduce((sum, part) => sum + part.weight * item.weight, 0), item.weight);
    const originalCurve = before.indicators.find((entry) => entry.id === id).scoring.anchors;
    for (const part of item.scoring.components) assert.deepEqual(part.anchors, originalCurve);
    near(score(id), parts.reduce((sum, part) => sum + part.weight * part.points, 0));
  }
  // Differentiate averaging the observations from averaging their scores, including saturation.
  assert.notEqual(score("G10"), interpolateScore(19.3 * .5 + 25 * .5, rule("G10").scoring.components[0].anchors));
});

test("profit monthly sensitivity changes within its original four-percent budget without repeating breadth", () => {
  assert.deepEqual(rule("G02").scoring.components.map((part) => part.weight), [.3, .45, .125, .125]);
  assert.equal(rule("G02").weight, .04); assert.equal(rule("G19").weight, .04);
  assert.equal(rule("G02").displayComponents, true);
  assert.deepEqual(current.observations.G02.scoringInputs, oldCurrent.observations.G02.scoringInputs);
  assert.deepEqual(rule("G02").scoring.components.map((part) => part.anchors), before.indicators.find((item) => item.id === "G02").scoring.components.map((part) => part.anchors));
  assert.equal(details("G02").components.length, 4);
  assert.ok(!details("G02").components.some((part) => part.key === "industryProfitImprovementBreadth"));
  near(score("G02") - scoreIndicator(before.indicators.find((item) => item.id === "G02"), oldCurrent.observations.G02, current.asOf, before.freshness),
    .2 * (details("G02").components[1].points - details("G02").components[0].points));
});

test("missing supplemental inputs, fake cumulative differences and scope substitutions never get a full score", () => {
  for (const id of ["G01", "G17", "G10", "P01E", "P01F"]) {
    const extraKey = id.startsWith("P") ? "latestMonthGrowth" : "yearToDateGrowth";
    const missing = structuredClone(current.observations[id]); delete missing.scoringInputs[extraKey];
    assert.equal(score(id, missing), null);
    const wrong = structuredClone(current.observations[id]); wrong.scoringInputs[extraKey].value += .5;
    assert.equal(score(id, wrong), null);
    const future = structuredClone(current.observations[id]); future.scoringInputs[extraKey].releaseDate = "2099-01-01";
    assert.equal(score(id, future), null);
  }
  const goods = structuredClone(current.observations.G17); goods.scoringInputs.yearToDateGrowth.series = "totalRetailSales";
  assert.equal(score("G17", goods), null);
  const usd = structuredClone(current.observations.G10); usd.scoringInputs.yearToDateGrowth.basis = "年初累计人民币金额同比";
  assert.equal(score("G10", usd), null);
  const fiscal = structuredClone(current.observations.P01E); fiscal.scoringInputs.latestMonthGrowth.rawEvidence.currentYear.preceding.period = "2025-12";
  assert.equal(score("P01E", fiscal), null);
});

test("pending double-basis plans do not pretend to be enabled components or remove existing valid scores", () => {
  assert.deepEqual(framework.dualBasisReview.enabledIds, ["G01", "G17", "G10", "P01E", "P01F", "G02"]);
  const pending = framework.dualBasisReview.pending;
  assert.deepEqual(pending.map((item) => item.id), ["G03", "G14", "G07", "G13", "G16", "F01", "F02"]);
  for (const item of pending) {
    assert.ok(item.reason); assert.ok(item.proposedAllocation);
    assert.notEqual(rule(item.id).displayComponents, true);
    assert.deepEqual(rule(item.id), before.indicators.find((entry) => entry.id === item.id));
    assert.notEqual(score(item.id), null);
  }
  assert.equal(framework.dualBasisReview.noNewRollingWindow, true);
  for (const id of ids) assert.doesNotMatch(JSON.stringify(rule(id).scoring.components), /recentThreeMonth|officialThreeMonth/);
});

test("the appended new record preserves every previous snapshot and all versions still reproduce", () => {
  assert.deepEqual(history.snapshots.map((item) => item.version), ["V1.18", "V1.19", "V1.20"]);
  assert.deepEqual(history.snapshots.slice(0, -1), oldHistory.snapshots);
  assert.deepEqual(history.snapshots.at(-1), createMacroRatingRecord(framework, current));
  assert.throws(() => appendMacroRatingRecord(history, history.snapshots.at(-1)), /already archived/);
  for (const snapshot of history.snapshots) {
    const input = { asOf: snapshot.asOf, observations: Object.fromEntries(snapshot.rows.map((row) => [row.id, row.observation])) };
    near(evaluateMacroRating(snapshot.framework, input).formalScore, snapshot.score, 1e-6);
    for (const row of snapshot.rows) near(scoreIndicator(snapshot.framework.indicators.find((item) => item.id === row.id), row.observation, snapshot.asOf, snapshot.framework.freshness), row.points);
  }
  for (const id of ids) assert.deepEqual(history.snapshots.at(-1).rows.find((row) => row.id === id).scoringDetails, details(id));
});

test("the total change is fully explained by only the six approved method revisions", () => {
  const result = evaluateMacroRating(framework, current), previous = evaluateMacroRating(before, oldCurrent);
  assert.equal(result.status, "正式"); near(result.coverage, 1);
  near(current.revisionComparison.currentScore, result.formalScore);
  near(current.revisionComparison.previousScore, previous.formalScore);
  near(current.revisionComparison.rows.reduce((sum, row) => sum + row.contributionChange, 0), result.formalScore - previous.formalScore);
  assert.deepEqual(current.revisionComparison.rows.filter((row) => Math.abs(row.contributionChange) > 1e-9).map((row) => row.id).sort(), ids.toSorted());
  assert.match(current.revisionComparison.kind, /不是经济变化/);
  assert.ok(current.evidenceLimitations.some((item) => /金额差分/.test(item.reason) && /重修订/.test(item.reason)));
  const migration = fs.readFileSync(new URL("../scripts/apply-macro-v1-20.mjs", import.meta.url), "utf8");
  assert.match(migration, /must not roll back/); assert.match(migration, /appendMacroRatingRecord/);
  assert.doesNotMatch(migration, /snapshots: \[(?:record|snapshot)\]/);
});
