import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord } from "../lib/macro-rating-record.mjs";
import { evaluateMacroResearchRating, resolveMacroAssessment } from "../lib/macro-rating-research.mjs";

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const expectedFormalScore = (framework, current) => Number(framework.indicators.reduce((sum, rule) => {
  const points = scoreIndicator(rule, current.observations[rule.id], current.asOf, framework.freshness);
  assert.notEqual(points, null, `${rule.id}: the weighted total needs complete original evidence, not a research fallback`);
  return sum + rule.weight * points;
}, 0).toFixed(6));

test("current infrastructure metadata uses the published 2026 scope rather than the former scope", async () => {
  const [advisory, chartData] = await Promise.all([
    load("../app/data/advisory.json"), load("../app/data/macro-intrayear.json"),
  ]);
  const indicator = advisory.macroIndicators.find((item) => item.id === "M35");
  assert.ok(indicator);
  assert.match(indicator.expectedSource, /2026年现行口径含电力、热力、燃气及水/);
  assert.match(indicator.expectedSource, /不拼接旧/);
  const chart = chartData.series.find((item) => item.metric === "基础设施投资");
  assert.match(chart.basis, /含电力、热力、燃气及水/);
  assert.match(chart.source, /不与旧版/);
});

test("de-duplicating the rating does not delete the source library or original charts", async () => {
  const [framework, advisory, chartData] = await Promise.all([
    load("../app/data/macro-rating-v1.json"), load("../app/data/advisory.json"),
    load("../app/data/macro-intrayear.json"),
  ]);
  for (const id of ["G08", "G09", "F03", "P01A", "P01B", "P01D", "P02B"]) {
    assert.ok(!framework.indicators.some((item) => item.id === id), `${id} must not remain a scored legacy series`);
  }
  for (const id of ["G16", "G17", "G18", "P01E", "P01F", "P02E"]) {
    assert.ok(framework.indicators.some((item) => item.id === id), `${id} needs its own new definition`);
  }
  assert.ok(advisory.macroIndicators.some((item) => item.id === "M38"));
  assert.ok(advisory.macroIndicators.some((item) => item.id === "M49"));
  assert.ok(chartData.series.some((item) => item.metric === "民间固定资产投资"));
});

test("the archived workbook exporter cannot silently roll back the live framework", async () => {
  const source = await readFile(new URL("../scripts/export-macro-rating-v1.py", import.meta.url), "utf8");
  assert.match(source, /current_version != "V1\.0"/);
  assert.match(source, /Refusing to overwrite the live/);
  assert.ok(source.indexOf("Refusing to overwrite the live") < source.indexOf("book = load_workbook"));
});

test("V1.21 verifies all 38 observations with explicit continuous and evidence-based methods", async () => {
  const [framework, current] = await Promise.all([load("../app/data/macro-rating-v1.json"), load("../app/data/macro-rating-current.json")]);
  assert.equal(current.asOf, "2026-10-11");
  assert.equal(current.version, framework.version);
  assert.equal(current.version, "V1.21");
  assert.deepEqual(Object.keys(current.observations).sort(), framework.indicators.map((rule) => rule.id).sort());
  const missing = [];
  for (const rule of framework.indicators) {
    const observation = current.observations[rule.id];
    const points = scoreIndicator(rule, observation, current.asOf, framework.freshness);
    if (observation === null) missing.push(rule.id);
    else {
      assert.notEqual(points, null, rule.id);
      assert.ok(observation.rationale.trim(), `${rule.id}: show the actual reason`);
      assert.ok(observation.releaseDate <= current.asOf);
      assert.ok(!observation.sourceAudit || observation.sourceAudit.provider === "官方", `${rule.id}: no vendor substitution`);
      assert.doesNotMatch(JSON.stringify(observation), /test-synthetic|SYNTHETIC|vendor\.example/);
    }
  }
  assert.deepEqual(missing, []);
  assert.equal(current.observations.P01A, undefined);
  assert.equal(current.observations.P02B, undefined);
  assert.deepEqual(current.gaps.map((gap) => gap.id).sort(), missing);
  assert.ok(current.gaps.every((gap) => gap.reason && gap.verified === false));
  const result = evaluateMacroRating(framework, current);
  assert.equal(result.status, "正式");
  assert.ok(Math.abs(result.coverage - 1) < 1e-9);
  assert.ok(Math.abs(result.formalScore - expectedFormalScore(framework, current)) < 1e-6);
  assert.equal(result.grade, "III档 条件中性");
  assert.deepEqual(result.pillars.map((pillar) => pillar.verifiedCount), [8, 14, 7, 9]);
  assert.ok(framework.indicators.every((rule) => /试行/.test(rule.thresholdStatus)));
});

test("complete RRR action-ledger evidence receives a strict score and never duplicates a research total", async () => {
  const [framework, current] = await Promise.all([load("../app/data/macro-rating-v1.json"), load("../app/data/macro-rating-current.json")]);
  assert.deepEqual(current.researchAssessments, {});
  const rule = framework.indicators.find((item) => item.id === "P02E");
  const observation = current.observations.P02E;
  assert.equal(rule.weight, .005);
  assert.equal(observation.value, 0);
  assert.equal(observation.rrrActionLedger.windowStart, "2025-10-01");
  assert.equal(observation.rrrActionLedger.windowEnd, "2026-09-30");
  assert.equal(observation.rrrActionLedger.monthlyChecks.length, 12);
  assert.ok(Array.isArray(observation.rrrActionLedger.adjustmentEvents));
  assert.ok(observation.rrrActionLedger.crossChecks.length > 0);
  assert.equal(scoreIndicator(rule, observation, current.asOf, framework.freshness), 3);
  assert.deepEqual(resolveMacroAssessment(framework, current, rule), { points: 3, type: "核验评分", assessment: null });
  const result = evaluateMacroResearchRating(framework, current);
  assert.ok(Math.abs(result.formalScore - expectedFormalScore(framework, current)) < 1e-6);
  assert.equal(result.grade, "III档 条件中性");
  assert.ok(Math.abs(result.coverage - 1) < 1e-9);
  assert.equal(result.research.count, 0);
  assert.equal(result.research.countTotal, 38);
  assert.equal(result.research.coverage, 1);
  assert.equal(result.research.score, null);
  assert.equal(result.research.grade, null);
  assert.deepEqual(result.research.pillars.map((pillar) => [pillar.name, pillar.count, pillar.researchCount]),
    [["经济运行", 8, 0], ["增长动力", 14, 0], ["金融信贷", 7, 0], ["宏观调控", 9, 0]]);
});

test("removed fiscal observations or research judgments never re-enter the active version", async () => {
  const [framework, current] = await Promise.all([load("../app/data/macro-rating-v1.json"), load("../app/data/macro-rating-current.json")]);
  assert.equal(framework.indicators.length, 38);
  assert.equal(framework.indicators.some((rule) => ["P01A", "P02B"].includes(rule.id)), false);
  const withLegacyEvidence = structuredClone(current);
  withLegacyEvidence.observations.P01A = { value: 999, verified: true };
  withLegacyEvidence.researchAssessments.P01A = { points: 5, status: "研究暂评" };
  withLegacyEvidence.observations.P02B = { value: -999, verified: true };
  withLegacyEvidence.researchAssessments.P02B = { points: 5, status: "研究暂评" };
  assert.deepEqual(evaluateMacroRating(framework, withLegacyEvidence), evaluateMacroRating(framework, current));
  assert.deepEqual(evaluateMacroResearchRating(framework, withLegacyEvidence), evaluateMacroResearchRating(framework, current));
});

test("the published evidence record exactly freezes the current observation and scoring rules", async () => {
  const [framework, current, history] = await Promise.all([load("../app/data/macro-rating-v1.json"), load("../app/data/macro-rating-current.json"), load("../app/data/macro-rating-history.json")]);
  const snapshot = history.snapshots.find((item) => item.asOf === current.asOf && item.version === current.version);
  assert.ok(snapshot);
  assert.deepEqual(snapshot, createMacroRatingRecord(framework, current));
  assert.equal(history.snapshots.length, 4);
  assert.equal(snapshot.version, "V1.21");
  assert.equal(snapshot.type, "正式评级");
  assert.equal(snapshot.score, expectedFormalScore(framework, current));
  assert.equal(snapshot.grade, "III档 条件中性");
  assert.equal(snapshot.rows.length, 38);
  assert.equal(snapshot.rows.filter((row) => row.points === null).length, 0);
  assert.equal(snapshot.rows.some((row) => ["P01A", "P02B"].includes(row.id)), false);
  assert.deepEqual(snapshot.rows.find((row) => row.id === "P02E").observation.rrrActionLedger, current.observations.P02E.rrrActionLedger);
  assert.equal(snapshot.rows.find((row) => row.id === "P01E").weight, .035);
  assert.equal(snapshot.rows.find((row) => row.id === "P01F").weight, .015);
  assert.deepEqual(snapshot.researchEvidence, current.researchAssessments);
  assert.equal(snapshot.research.count, 0);
  assert.equal(snapshot.research.coverage, 1);
  assert.equal(snapshot.research.score, null);
  assert.ok(snapshot.collectionAudit.evidenceLimitations.some((item) => item.items?.includes("F09") && item.reason));
  assert.ok(snapshot.collectionAudit.evidenceLimitations.every((item) => item.reason));
});

test("all views use the same freshness rules and archive display rejects partial formal scores", async () => {
  const source = await readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /scoreIndicator\(item, (?:observation|observations\[item\.id\]), current\.asOf\)/);
  assert.match(source, /item\.type === "正式评级" && Math\.abs\(item\.coverage - 1\) < 1e-9/);
  assert.match(source, /formatScore\(isFormalSnapshot\(item\) \? item\.score : null\)/);
  assert.match(source, /isFormalSnapshot\(item\) \? item\.grade : "未发布正式档位"/);
  assert.match(source, /formatTotalWeight/);
});

test("all workbook views explicitly separate provisional research evidence from raw values and formal scores", async () => {
  const source = await readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8");
  assert.match(source, /evaluateMacroResearchRating\(framework, current\)/);
  assert.match(source, /resolveMacroAssessment\(framework, current, item\)/);
  assert.match(source, /研究暂评/);
  assert.match(source, /原值待核验/);
  assert.match(source, /不计入核验覆盖率/);
  assert.match(source, /置信度/);
  assert.match(source, /反证与限制/);
  assert.match(source, /assessment\.unknowns\.join/);
  assert.match(source, /assessment\.evidence\.map/);
  assert.match(source, /research\.score/);
  assert.match(source, /snapshots\.toReversed\(\)\.map/);
  assert.match(source, /<strong>\{formatScore\(item\.research\.score\)\} \/ 5<\/strong>/);
  assert.match(source, /综合分／评分类型/);
  assert.match(source, /Math\.round\(\(value \+ Number\.EPSILON\) \* 100\)/);
  assert.equal((Math.round((2.905 + Number.EPSILON) * 100) / 100).toFixed(2), "2.91");
  assert.equal((Math.round((2.525 + Number.EPSILON) * 100) / 100).toFixed(2), "2.53");
  assert.match(source, /item\.research/);
  assert.match(source, /row\.researchAssessment/);
  assert.match(source, /未发布正式档位/);
});
