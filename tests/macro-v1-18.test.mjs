import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord } from "../lib/macro-rating-record.mjs";
import { continuousScoreDetails, interpolateScore } from "../lib/macro-scoring-continuous.mjs";
import * as researchEngine from "../lib/macro-rating-research.mjs";
import * as summaryEngine from "../lib/macro-rating-summary.mjs";
import * as breadthEngine from "../lib/macro-profit-breadth.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
// Keep this released version immutable; the current V1.19 is tested separately.
const framework = read("deliverables/macro-rating-framework-before-v1-19-2026-10-11.json"), current = read("deliverables/macro-rating-current-before-v1-19-2026-10-11.json");
const history = read("deliverables/macro-rating-history-before-v1-19-2026-10-11.json");
const before = read("deliverables/macro-rating-framework-before-v1-18-2026-10-11.json");
const oldCurrent = read("deliverables/macro-rating-current-before-v1-18-2026-10-11.json");
const oldHistory = read("deliverables/macro-rating-history-before-v1-18-2026-10-11.json");
const rule = (id) => framework.indicators.find((item) => item.id === id);
const score = (id, observation = current.observations[id]) => scoreIndicator(rule(id), observation, current.asOf, framework.freshness);
const near = (actual, expected, tolerance = 1e-6) => assert.ok(typeof actual === "number" && Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("V1.18 changes exactly three scoring rules and preserves 37 IDs and all approved weights", () => {
  assert.equal(framework.version, "V1.18");
  assert.equal(current.version, framework.version);
  assert.equal(before.version, "V1.17");
  assert.equal(current.asOf, oldCurrent.asOf);
  assert.deepEqual(framework.pillars, before.pillars);
  assert.deepEqual(framework.ratingBands, before.ratingBands);
  assert.deepEqual(framework.freshness, before.freshness);
  assert.equal(framework.indicators.length, 37);
  assert.deepEqual(framework.indicators.map(({id, weight, pillar}) => ({id, weight, pillar})), before.indicators.map(({id, weight, pillar}) => ({id, weight, pillar})));
  for (const item of framework.indicators) {
    const previous = before.indicators.find((row) => row.id === item.id);
    for (const key of ["value", "period", "unit", "basis", "sourceUrl", "releaseDate", "verifiedAt", "originalPublisher", "latestAvailablePeriod"])
      assert.deepEqual(current.observations[item.id][key], oldCurrent.observations[item.id][key], `${item.id}: ${key}`);
    if (!["E04", "E07", "G02"].includes(item.id)) {
      assert.deepEqual(item, previous);
      assert.deepEqual(current.observations[item.id], oldCurrent.observations[item.id]);
    }
  }
  for (const key of ["currentNominal", "priorNominal", "realGrowth"])
    assert.deepEqual(current.observations.E07.gdpDeflatorEvidence[key], oldCurrent.observations.E07.gdpDeflatorEvidence[key]);
  for (const key of Object.keys(oldCurrent.observations.G02.scoringInputs))
    assert.deepEqual(current.observations.G02.scoringInputs[key], oldCurrent.observations.G02.scoringInputs[key]);
});

test("PPI keeps the negative branch and applies only the fixed moderate high-end curve", () => {
  const previous = before.indicators.find((item) => item.id === "E04");
  assert.deepEqual(rule("E04").scoring.anchors.filter(([x]) => x <= 2), previous.scoring.anchors.filter(([x]) => x <= 2));
  for (const [x, expected] of [[1,5],[2,5],[3,3.5],[5,2.5],[8,1.5],[12,1]]) near(interpolateScore(x, rule("E04").scoring.anchors), expected);
  near(score("E04"), 3.1);
  for (const [x, expected] of rule("E04").scoring.anchors) {
    near(interpolateScore(x-1e-9, rule("E04").scoring.anchors), expected);
    near(interpolateScore(x+1e-9, rule("E04").scoring.anchors), expected);
  }
});

test("deflator uses separate quarter scores at 70/15/15, never an averaged or altered raw value", () => {
  const details = continuousScoreDetails(rule("E07"), current.observations.E07, current.asOf);
  assert.deepEqual(details.components.map((part) => part.weight), [.7,.15,.15]);
  assert.equal(current.observations.E07.value, 1.526649);
  near(score("E07"), 4.0335383916);
  near(details.points, details.components.reduce((sum, part) => sum + part.weight*part.points, 0));
  const previous = before.indicators.find((item) => item.id === "E07");
  for (const component of rule("E07").scoring.components) assert.deepEqual(component.anchors, previous.scoring.anchors);
  for (const key of ["previousQuarterPriceLevel", "twoQuartersAgoPriceLevel"]) {
    const observation = structuredClone(current.observations.E07);
    delete observation.scoringInputs[key];
    assert.equal(score("E07", observation), null);
  }
  const mixed = structuredClone(current.observations.E07);
  mixed.scoringInputs.previousQuarterPriceLevel.revisionVersion = "different-version";
  assert.equal(score("E07", mixed), null);
});

test("profit breadth is genuinely weighted inside the existing 4 percent and requires 41 official rows", () => {
  assert.match(current.observations.G02.rationale, /原V1\.17为3\.66分/);
  assert.equal(rule("G02").weight, .04);
  assert.deepEqual(rule("G02").scoring.components.map((part) => part.weight), [.4,.2,.2,.1,.1]);
  const details = continuousScoreDetails(rule("G02"), current.observations.G02, current.asOf);
  const breadth = details.components.find((part) => part.key === "industryProfitImprovementBreadth");
  near(breadth.value, 22/41*100);
  near(breadth.points, 1+4*22/41);
  assert.equal(details.components.length, 5);
  assert.ok(score("G02") < scoreIndicator(before.indicators.find((item) => item.id === "G02"), oldCurrent.observations.G02, oldCurrent.asOf, before.freshness));
  for (const mutate of [
    (observation) => { delete observation.scoringInputs.industryProfitImprovementBreadth; },
    (observation) => { observation.scoringInputs.industryProfitImprovementBreadth.rawEvidence.industries.pop(); },
    (observation) => { observation.scoringInputs.industryProfitImprovementBreadth.value = 100; },
    (observation) => { observation.scoringInputs.industryProfitImprovementBreadth.basis = "当月行业盈利占比"; },
  ]) {
    const observation = structuredClone(current.observations.G02); mutate(observation);
    assert.equal(score("G02", observation), null);
  }
});

test("current total, record and recoverable prior record all reproduce their own version", () => {
  const result = evaluateMacroRating(framework, current), previous = evaluateMacroRating(before, oldCurrent);
  assert.equal(result.status, "正式"); near(result.coverage, 1);
  const changed = current.revisionComparison.rows.filter((item) => Math.abs(item.currentScore-item.previousScore)>1e-9);
  assert.deepEqual(changed.map((item) => item.id).sort(), ["E04","E07","G02"]);
  near(result.formalScore-previous.formalScore, changed.reduce((sum, item) => sum+item.contributionChange, 0));
  assert.deepEqual(history.snapshots, [createMacroRatingRecord(framework, current)]);
  assert.deepEqual(oldHistory.snapshots, [createMacroRatingRecord(before, oldCurrent)]);
  assert.equal(history.snapshots.length, 1);
  assert.match(current.revisionComparison.kind, /不是经济变化/);
});

test("rendered standards show the real breadth rows, three-quarter evidence and new score together", () => {
  const source = fs.readFileSync(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { fileName: "MacroRatingV1.tsx", reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  assert.equal(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
  const externalRequire = createRequire(import.meta.url), module = { exports: {} };
  runInNewContext(compiled.outputText, { module, exports: module.exports, console, require(specifier) {
    if (specifier === "../data/macro-rating-v1.json") return framework;
    if (specifier === "../data/macro-rating-current.json") return current;
    if (specifier === "../data/macro-rating-history.json") return history;
    if (specifier === "../../lib/macro-rating.mjs") return { evaluateMacroRating, scoreIndicator };
    if (specifier === "../../lib/macro-rating-research.mjs") return researchEngine;
    if (specifier === "../../lib/macro-rating-summary.mjs") return summaryEngine;
    if (specifier === "../../lib/macro-profit-breadth.mjs") return breadthEngine;
    if (specifier === "../../lib/macro-scoring-continuous.mjs") return { continuousScoreDetails };
    return externalRequire(specifier);
  } });
  const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
  const ppi = render(module.exports.MacroRuleScoring, { item: rule("E04"), observation: current.observations.E04 });
  assert.match(ppi, /3\.5分|3\.50 分/); assert.match(ppi, /5%=2\.5分/);
  const deflator = render(module.exports.MacroRuleScoring, { item: rule("E07"), observation: current.observations.E07 });
  for (const text of ["70%", "15%", "2025-Q4", "2026-Q1", "2026-Q2", "该季现价GDP", "实际GDP同比指数"]) assert.ok(deflator.includes(text), text);
  const profit = render(module.exports.MacroRuleScoring, { item: rule("G02"), observation: current.observations.G02 });
  for (const text of ["41/41行业", "行业利润改善广度", "53.66", "煤炭开采和洗选业", "水的生产和供应业", "由亏转盈"]) assert.ok(profit.includes(text), text);
  const record = render(module.exports.MacroRatingHistory);
  assert.match(record, /V1\.18/); assert.match(record, /4\.03/); assert.match(record, /3\.10/);
});
