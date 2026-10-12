import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { interpolateScore } from "../lib/macro-scoring-continuous.mjs";
import { scoreIndicator, evaluateMacroRating } from "../lib/macro-rating.mjs";
const load = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
// Freeze V1.15 regression semantics; V1.16 is independently covered by the
// calibration and current integration tests rather than rewriting old results.
const framework = await load("deliverables/macro-rating-framework-before-v1-16-2026-10-11.json");
const current = await load("deliverables/macro-rating-current-before-v1-16-2026-10-11.json");
const oldFramework = await load("deliverables/macro-rating-framework-before-v1-15-2026-10-11.json");
const oldCurrent = await load("deliverables/macro-rating-current-before-v1-15-2026-10-11.json");
const rule = (id) => framework.indicators.find((item) => item.id === id);
const points = (id, observation = current.observations[id]) => scoreIndicator(rule(id), observation, current.asOf, framework.freshness);
const clone = structuredClone;

test("all 37 IDs and their confirmed weights survive; all numeric rules use continuous methods", () => {
  assert.equal(framework.version, "V1.15");
  assert.deepEqual(framework.indicators.map(({id,weight,pillar})=>({id,weight,pillar})), oldFramework.indicators.map(({id,weight,pillar})=>({id,weight,pillar})));
  assert.deepEqual(framework.ratingBands, oldFramework.ratingBands);
  assert.equal(framework.indicators.filter((item) => item.scoring.method === "piecewise-linear").length, 26);
  assert.equal(framework.indicators.filter((item) => item.scoring.method === "weighted-components").length, 5);
  assert.equal(framework.indicators.filter((item) => item.scoring.method === "evidence-matrix").length, 2);
  assert.equal(framework.indicators.filter((item) => item.scoring.method === "evidence-rubric").length, 4);
});
test("versioned score curves interpolate continuously at every anchor without rounding the input", () => {
  for (const item of framework.indicators) {
    const curves = item.scoring.anchors ? [item.scoring.anchors] : item.scoring.components?.map((part) => part.anchors) ?? [];
    for (const anchors of curves) for (const [value, score] of anchors) {
      assert.equal(interpolateScore(value, anchors), score, item.id);
      for (const delta of [-1e-8, 1e-8]) assert.ok(Math.abs(interpolateScore(value + delta, anchors) - score) < 1e-6, item.id);
    }
  }
  for (const anchors of [[], [[0,3]], [[0,3],[0,4]], [[1,3],[0,4]], [[0,0],[1,5]], [[0,1],[1,6]]]) assert.equal(interpolateScore(0, anchors), null);
  assert.equal(interpolateScore(NaN, [[0,1],[1,5]]), null);
});
test("no source, date or verification gate is bypassed by a new scoring method", () => {
  for (const item of framework.indicators) {
    assert.notEqual(points(item.id), null, item.id);
    for (const mutation of [{ verified: false }, { sourceUrl: "https://example.com/not-official" },
      { releaseDate: "2026-10-12" }, { verifiedAt: "2026-10-12" }, { unit: "错误单位" }, { basis: "错误口径" }, { latestAvailablePeriod: "2099-01" }]) {
      assert.equal(points(item.id, { ...clone(current.observations[item.id]), ...mutation }), null, item.id);
    }
  }
});
test("monetary direction is symmetric at zero; opposite loan-rate changes are not one neutral band", () => {
  const anchors = rule("P02D").scoring.anchors;
  assert.ok(Math.abs(interpolateScore(-18, anchors) - 3.72) < 1e-9);
  assert.ok(Math.abs(interpolateScore(18, anchors) - 2.28) < 1e-9);
  for (const id of ["P02A", "P02E"]) {
    assert.equal(points(id), 3);
    for (const value of [5, 25, 50]) assert.ok(Math.abs(interpolateScore(value, rule(id).scoring.anchors)
      + interpolateScore(-value, rule(id).scoring.anchors) - 6) < 1e-9);
  }
  assert.deepEqual(current.observations.P02E.rrrActionLedger, oldCurrent.observations.P02E.rrrActionLedger);
});
test("policy upper grades require bounded coverage and formal evidence links, not arbitrary nonempty prose", () => {
  for (const id of ["P03A", "P03B", "P04A", "P04B"]) {
    assert.equal(points(id), 4);
    let item = clone(current.observations[id]); delete item.policyReview.implementationChecks;
    assert.equal(points(id, item), null);
    item = clone(current.observations[id]); item.policyReview.implementationChecks[0].evidenceRefs = ["not-an-evidence-id"];
    assert.equal(points(id, item), null);
    item = clone(current.observations[id]); item.policyReview.coverageAssessment.wholeEconomyClaim = true;
    assert.equal(points(id, item), null);
    item = clone(current.observations[id]); item.value = 5; item.policyReview.executionSummary = "仅有局部证据";
    assert.equal(points(id, item), null);
  }
});
test("recalculation keeps old results reproducible and identifies rule revision rather than economic movement", () => {
  const oldResult = evaluateMacroRating(oldFramework, oldCurrent);
  assert.ok(Math.abs(oldResult.formalScore - 2.91) < 1e-9);
  const updated = evaluateMacroRating(framework, current);
  assert.equal(current.asOf, oldCurrent.asOf);
  assert.equal(updated.status, "正式");
  assert.equal(current.revisionComparison.rows.length, 37);
  assert.match(current.revisionComparison.kind, /不是经济/);
  assert.ok(Math.abs(current.revisionComparison.rows.reduce((sum,item)=>sum+item.contributionChange,0)
    - (updated.formalScore - oldResult.formalScore)) < 1e-9);
});
