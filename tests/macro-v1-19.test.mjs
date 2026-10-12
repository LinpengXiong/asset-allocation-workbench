import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";
import { validateStandaloneProfitBreadthObservation } from "../lib/macro-profit-breadth.mjs";
import { formatTotalWeight } from "../lib/macro-rating-summary.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
// Freeze released V1.19 expectations; V1.20 has its own current-version regression.
const framework = read("deliverables/macro-rating-framework-before-v1-20-2026-10-11.json"), current = read("deliverables/macro-rating-current-before-v1-20-2026-10-11.json"), history = read("deliverables/macro-rating-history-before-v1-20-2026-10-11.json");
const before = read("deliverables/macro-rating-framework-before-v1-19-2026-10-11.json"), oldCurrent = read("deliverables/macro-rating-current-before-v1-19-2026-10-11.json"), oldHistory = read("deliverables/macro-rating-history-before-v1-19-2026-10-11.json");
const rule = (id) => framework.indicators.find((item) => item.id === id);
const score = (id, observation = current.observations[id]) => scoreIndicator(rule(id), observation, current.asOf, framework.freshness);
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("the approved four-pillar and every indicator weight sum exactly to their budgets", () => {
  assert.equal(framework.version, "V1.19");
  assert.equal(current.version, framework.version);
  assert.deepEqual(framework.pillars, { 经济运行: .25, 增长动力: .4, 金融信贷: .2, 宏观调控: .15 });
  assert.equal(framework.indicators.length, 38);
  assert.equal(new Set(framework.indicators.map((item) => item.id)).size, 38);
  for (const [pillar, budget] of Object.entries(framework.pillars)) near(framework.indicators.filter((item) => item.pillar === pillar).reduce((sum, item) => sum + item.weight, 0), budget);
  near(framework.indicators.reduce((sum, item) => sum + item.weight, 0), 1);
  assert.deepEqual(framework.indicators.filter((item) => item.pillar === "金融信贷"), before.indicators.filter((item) => item.pillar === "金融信贷"));
  assert.equal(rule("E04").weight, .05);
  assert.equal(rule("E05").weight, .025);
  near(framework.indicators.filter((item) => item.group === "房地产").reduce((sum, item) => sum + item.weight, 0), .045);
  assert.equal(rule("F09").weight, .03); assert.equal(rule("F10").weight, .03);
  for (const id of ["P03A", "P03B", "P04A", "P04B"]) {
    assert.equal(rule(id).weight, .0125);
    assert.match(rule(id).definition, /权重1\.25%/);
    assert.equal(formatTotalWeight(rule(id).weight), "1.25%");
  }
});

test("profit growth-quality and improvement breadth score independently, each at four percent", () => {
  assert.equal(rule("G02").weight, .04); assert.equal(rule("G19").weight, .04);
  assert.equal(rule("G02").profitQualityRequired, true);
  assert.deepEqual(rule("G02").scoring.components.map((item) => item.weight), [.5, .25, .125, .125]);
  assert.equal(current.observations.G02.scoringInputs.industryProfitImprovementBreadth, undefined);
  assert.equal(rule("G19").profitQualityRequired, undefined);
  assert.equal(rule("G19").scoring.method, "piecewise-linear");
  const breadth = validateStandaloneProfitBreadthObservation(current.observations.G19, current.asOf);
  near(breadth, 22 / 41 * 100);
  assert.equal(current.observations.G19.rawEvidence.industries.length, 41);
  near(current.observations.G19.value, 22 / 41 * 100);
  near(score("G02"), 3.5570833333333334);
  near(score("G19"), 1 + 4 * 22 / 41);
  for (const mutate of [
    (item) => item.rawEvidence.industries.pop(),
    (item) => { item.rawEvidence.industries[1] = structuredClone(item.rawEvidence.industries[0]); },
    (item) => { item.value = 100; },
    (item) => { item.releaseDate = "2099-01-01"; },
  ]) { const observation = structuredClone(current.observations.G19); mutate(observation); assert.equal(score("G19", observation), null); }
  const incompleteProfit = structuredClone(current.observations.G02); delete incompleteProfit.scoringInputs.reportedProfitMarginYoyChange;
  assert.equal(score("G02", incompleteProfit), null);
  const noBreadth = structuredClone(current); delete noBreadth.observations.G19;
  const result = evaluateMacroRating(framework, noBreadth);
  near(result.coverage, .96); assert.equal(result.formalScore, null);
});

test("all existing main raw values and unchanged score methods survive the weight revision", () => {
  assert.equal(current.asOf, oldCurrent.asOf);
  assert.deepEqual(framework.freshness, before.freshness);
  assert.deepEqual(framework.ratingBands, before.ratingBands);
  for (const previous of before.indicators) {
    for (const key of ["value", "period", "unit", "basis", "sourceUrl", "releaseDate", "verifiedAt", "originalPublisher", "latestAvailablePeriod"])
      assert.deepEqual(current.observations[previous.id][key], oldCurrent.observations[previous.id][key], `${previous.id}: ${key}`);
    if (previous.id !== "G02") {
      assert.deepEqual(rule(previous.id).scoring, previous.scoring);
      assert.equal(score(previous.id), scoreIndicator(previous, oldCurrent.observations[previous.id], oldCurrent.asOf, before.freshness));
    }
  }
  const oldBreadth = structuredClone(oldCurrent.observations.G02.scoringInputs.industryProfitImprovementBreadth);
  assert.deepEqual(current.observations.G19.rawEvidence, oldBreadth.rawEvidence);
});

test("both versioned records reproduce while the prior published record stays byte-for-byte equivalent", () => {
  assert.deepEqual(history.snapshots.map((item) => item.version), ["V1.18", "V1.19"]);
  assert.deepEqual(history.snapshots[0], oldHistory.snapshots[0]);
  assert.equal(createHash("sha256").update(JSON.stringify(history.snapshots[0])).digest("hex"), "9631f166ed3db390b1435dbc607c8f39fb072db1344eef0a4f515b755438086a");
  assert.deepEqual(history.snapshots.at(-1), createMacroRatingRecord(framework, current));
  for (const snapshot of history.snapshots) {
    const input = { asOf: snapshot.asOf, observations: Object.fromEntries(snapshot.rows.map((row) => [row.id, row.observation])) };
    const result = evaluateMacroRating(snapshot.framework, input);
    near(result.formalScore, snapshot.score, 1e-6);
    for (const row of snapshot.rows) near(scoreIndicator(snapshot.framework.indicators.find((item) => item.id === row.id), row.observation, snapshot.asOf, snapshot.framework.freshness), row.points);
  }
  assert.throws(() => appendMacroRatingRecord(history, history.snapshots.at(-1)), /already archived/);
  assert.equal(history.snapshots.length, 2);
});

test("weight and method contributions explain the total change without claiming new economic data", () => {
  const prior = evaluateMacroRating(before, oldCurrent), result = evaluateMacroRating(framework, current);
  assert.equal(result.status, "正式"); near(result.coverage, 1);
  near(result.formalScore, 2.792084199658253);
  near(current.revisionComparison.rows.reduce((sum, row) => sum + row.contributionChange, 0), result.formalScore - prior.formalScore);
  for (const row of current.revisionComparison.rows) near(row.contributionChange, row.currentScore * row.weight - (row.previousScore ?? 0) * row.previousWeight);
  assert.match(current.revisionComparison.kind, /不是经济变化/);
  assert.match(current.reviewSummary, /默认全部保留/);
  assert.match(current.sourceStatus, /38项/);
  assert.doesNotMatch(current.sourceStatus, /其他权重不动|权重4%和2%不变/);
  assert.doesNotMatch(current.observations.P02D.reason, /中性3分/);
});

test("archived migrations cannot rerun and wipe records or roll back the live release", () => {
  for (const version of [15, 16, 17, 18, 19]) {
    const source = fs.readFileSync(new URL(`../scripts/apply-macro-v1-${version}.mjs`, import.meta.url), "utf8");
    assert.match(source, /appendMacroRatingRecord/);
    assert.match(source, /must not roll back/);
    assert.doesNotMatch(source, /snapshots: \[(?:record|snapshot)\]/);
  }
});

test("independent sensitivity diagnostics match selected weights but do not claim a backtest", () => {
  const report = read("deliverables/macro-v1-19-weight-sensitivity.json");
  near(report.selected.totalDiagnostic, evaluateMacroRating(framework, current).formalScore);
  assert.equal(report.selected.profitBudget, .08);
  assert.equal(report.selected.breadthShare, .5);
  assert.equal(report.sensitivity.length, 9);
  assert.match(JSON.stringify(report.limitations), /历史|单期/);
});
