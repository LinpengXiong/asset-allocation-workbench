import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { continuousScoreDetails, interpolateScore } from "../lib/macro-scoring-continuous.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const framework = read("app/data/macro-rating-v1.json"), current = read("app/data/macro-rating-current.json"), history = read("app/data/macro-rating-history.json");
const before = read("deliverables/macro-rating-framework-before-v1-21-2026-10-11.json"), oldCurrent = read("deliverables/macro-rating-current-before-v1-21-2026-10-11.json"), oldHistory = read("deliverables/macro-rating-history-before-v1-21-2026-10-11.json");
const ids = ["F01", "F02"];
const rule = (id) => framework.indicators.find((item) => item.id === id);
const details = (id, observation = current.observations[id]) => continuousScoreDetails(rule(id), observation, current.asOf);
const score = (id, observation = current.observations[id]) => scoreIndicator(rule(id), observation, current.asOf, framework.freshness);
const near = (a, b, tolerance = 1e-9) => assert.ok(Number.isFinite(a) && Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("V1.21 adds only two loan methods, preserving all parent weights and primary observations", () => {
  assert.equal(framework.version, "V1.21"); assert.equal(current.version, framework.version);
  assert.equal(framework.indicators.length, 38);
  assert.deepEqual(framework.pillars, before.pillars); assert.deepEqual(framework.ratingBands, before.ratingBands);
  assert.deepEqual(framework.freshness, before.freshness);
  for (const previous of before.indicators) {
    assert.equal(rule(previous.id).weight, previous.weight);
    for (const key of ["value", "period", "unit", "basis", "sourceUrl", "releaseDate", "verifiedAt", "originalPublisher", "latestAvailablePeriod", "components"])
      assert.deepEqual(current.observations[previous.id][key], oldCurrent.observations[previous.id][key], `${previous.id}: ${key}`);
    if (!ids.includes(previous.id)) {
      assert.deepEqual(rule(previous.id), previous); assert.deepEqual(current.observations[previous.id], oldCurrent.observations[previous.id]);
    }
  }
  for (const [pillar, weight] of Object.entries(framework.pillars)) near(framework.indicators.filter((item) => item.pillar === pillar).reduce((sum, item) => sum + item.weight, 0), weight);
});

test("loan cumulative and latest-month amount changes are separate visible, non-duplicated components", () => {
  const expected = { F01: [-10612, -1022, .025], F02: [-17400, -1500, .035] };
  for (const [id, [cum, monthly, parentWeight]] of Object.entries(expected)) {
    const item = rule(id), parts = details(id).components;
    assert.equal(item.displayComponents, true); assert.equal(item.scoring.dualBasis, "loan-year-to-date-and-latest-month");
    assert.equal(item.aggregation, undefined); assert.doesNotMatch(item.name, /近3月/);
    assert.deepEqual(parts.map((part) => part.key), ["yearToDateMoreIncrease", "latestMonthMoreIncrease"]);
    assert.deepEqual(parts.map((part) => part.weight), [.4, .6]); assert.deepEqual(parts.map((part) => part.unit), ["亿元", "亿元"]);
    near(parts[0].value, cum); near(parts[1].value, monthly);
    near(parts[0].scoreValue, cum / 8); assert.equal(parts[0].scoreUnit, "亿元/月");
    assert.equal(parts[0].scoreTransform, "calendar-month-average");
    near(parts[0].points, interpolateScore(cum / 8, item.scoring.components[0].anchors));
    near(parts[1].points, interpolateScore(monthly, item.scoring.components[1].anchors));
    near(score(id), .4 * parts[0].points + .6 * parts[1].points);
    near(parts.reduce((sum, part) => sum + part.weight * item.weight, 0), parentWeight);
    assert.ok(item.scoring.components.every((part) => part.input === `observation.scoringInputs.${part.key}`));
    assert.ok(parts.every((part) => part.sourceUrl.includes("pbc.gov.cn") && part.period === "2026-08"));
  }
  assert.notDeepEqual(rule("F01").scoring.components[1].anchors, rule("F02").scoring.components[1].anchors);
  assert.notDeepEqual(rule("F01").scoring.components[0].anchors, rule("F01").scoring.components[1].anchors);
});

test("the same official endpoints reproduce cumulative and monthly changes without growth-rate subtraction", () => {
  for (const id of ids) {
    const inputs = current.observations[id].scoringInputs;
    const cum = inputs.yearToDateMoreIncrease, month = inputs.latestMonthMoreIncrease;
    near(cum.value, cum.rawEvidence.current.value - cum.rawEvidence.previous.value);
    const e = month.rawEvidence;
    near(month.value, e.currentYear.current.value - e.currentYear.preceding.value - e.previousYear.current.value + e.previousYear.preceding.value);
    assert.deepEqual(cum.rawEvidence.current, e.currentYear.current);
    assert.deepEqual(cum.rawEvidence.previous, e.previousYear.current);
    near(cum.roundingErrorBound, (cum.rawEvidence.current.roundingUnit + cum.rawEvidence.previous.roundingUnit) / 2);
    near(month.roundingErrorBound, Object.values(e.currentYear).concat(Object.values(e.previousYear)).reduce((sum, endpoint) => sum + endpoint.roundingUnit / 2, 0));
    assert.match(month.rawEvidence.comparability.revisionNote, /初步/);
  }
});

test("supplemental loan inputs fail closed for omissions, incompatible scopes, forged amounts and dates", () => {
  for (const id of ids) {
    for (const key of ["yearToDateMoreIncrease", "latestMonthMoreIncrease"]) {
      const missing = structuredClone(current.observations[id]); delete missing.scoringInputs[key]; assert.equal(score(id, missing), null);
      const wrong = structuredClone(current.observations[id]); wrong.scoringInputs[key].value += 10; assert.equal(score(id, wrong), null);
      const stale = structuredClone(current.observations[id]); stale.scoringInputs[key].latestAvailablePeriod = "2026-07"; assert.equal(score(id, stale), null);
      const future = structuredClone(current.observations[id]); future.scoringInputs[key].releaseDate = "2099-01-01"; assert.equal(score(id, future), null);
      const scope = structuredClone(current.observations[id]); scope.scoringInputs[key].scope = "上市公司"; assert.equal(score(id, scope), null);
    }
    const crossYear = structuredClone(current.observations[id]); crossYear.scoringInputs.latestMonthMoreIncrease.rawEvidence.currentYear.preceding.period = "2025-12";
    assert.equal(score(id, crossYear), null);
    const incompatible = structuredClone(current.observations[id]); incompatible.scoringInputs.latestMonthMoreIncrease.rawEvidence.previousYear.current.value += 100;
    assert.equal(score(id, incompatible), null);
  }
});

test("five pending property and investment plans preserve their actual cumulative scores and explain the gap", () => {
  assert.deepEqual(framework.dualBasisReview.pending.map((item) => item.id), ["G03", "G14", "G07", "G13", "G16"]);
  assert.deepEqual(framework.dualBasisReview.enabledIds, [...before.dualBasisReview.enabledIds, ...ids]);
  for (const item of framework.dualBasisReview.pending) {
    assert.ok(item.reason && item.evidenceFile); assert.notEqual(rule(item.id).displayComponents, true);
    assert.deepEqual(rule(item.id), before.indicators.find((entry) => entry.id === item.id));
    near(score(item.id), scoreIndicator(rule(item.id), oldCurrent.observations[item.id], current.asOf, before.freshness));
  }
  const evidence = read("deliverables/macro-property-dual-v1-21-evidence.json");
  assert.equal(evidence.sourceChecks.officialDatabase.status, "access_failed_not_data_absence");
  for (const item of evidence.propertyRules) assert.equal(item.latestMonthScorable, false);
  assert.equal(framework.dualBasisReview.noNewRollingWindow, true);
});

test("new history is append-only and all four frozen versions reproduce", () => {
  assert.deepEqual(history.snapshots.map((item) => item.version), ["V1.18", "V1.19", "V1.20", "V1.21"]);
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

test("current total differences are explained only by the two loan method revisions", () => {
  const result = evaluateMacroRating(framework, current), previous = evaluateMacroRating(before, oldCurrent);
  assert.equal(result.status, "正式"); near(result.coverage, 1);
  near(current.revisionComparison.currentScore, result.formalScore); near(current.revisionComparison.previousScore, previous.formalScore);
  near(current.revisionComparison.rows.reduce((sum, row) => sum + row.contributionChange, 0), result.formalScore - previous.formalScore);
  assert.deepEqual(current.revisionComparison.rows.filter((row) => Math.abs(row.contributionChange) > 1e-9).map((row) => row.id).sort(), ids);
  assert.match(current.revisionComparison.kind, /不是经济变化/);
  const source = fs.readFileSync(new URL("../scripts/apply-macro-v1-21.mjs", import.meta.url), "utf8");
  assert.match(source, /appendMacroRatingRecord/); assert.match(source, /must not roll back/);
});
