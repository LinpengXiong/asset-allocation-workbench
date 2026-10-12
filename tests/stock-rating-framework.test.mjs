import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const framework = JSON.parse(readFileSync(new URL("../app/data/stock-rating-framework.json", import.meta.url), "utf8"));
const sourceUrl = new URL("../app/components/StockRating.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourceUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const componentModule = { exports: {} };
new Function("require", "module", "exports", compiled)(createRequire(sourceUrl), componentModule, componentModule.exports);
const { StockRatingIndicators, StockRatingStandards, stockRatingDimensions } = componentModule.exports;

test("preserves the user-confirmed six weights and complete 100-point allocation", () => {
  const expected = [["估值面",35,4],["基本面",25,5],["政策面",15,4],["利率面",10,3],["资金面",10,3],["情绪面",5,2]];
  assert.deepEqual(stockRatingDimensions.map(d => [d.name,d.weight]), expected.map(d => d.slice(0,2)));
  assert.equal(framework.indicators.length, 21);
  assert.equal(new Set(framework.indicators.map(f => f.id)).size, 21);
  for (const [name, weight, count] of expected) {
    const factors = framework.indicators.filter(f => f.dimension === name);
    assert.equal(factors.length, count, name);
    assert.equal(factors.reduce((s,f) => s+f.weight, 0), weight, name);
  }
  assert.equal(framework.indicators.reduce((s,f) => s+f.weight, 0), 100);
});

test("every factor has auditable standards, metrics and two-workbook selection evidence", () => {
  for (const f of framework.indicators) {
    assert.ok(f.weight > 0 && Number.isFinite(f.weight), f.id);
    assert.equal(f.grades.length, 5, f.id);
    for (const s of [f.question, f.definition, f.calculation, f.frequency, ...f.grades, ...f.exceptions, ...Object.values(f.provenance)]) assert.ok(typeof s === "string" && s.trim().length > 0, f.id);
    assert.ok(f.exceptions.length > 0 && f.metrics.length > 0, f.id);
    assert.ok(f.metrics.some(m => m.role === "计分"), f.id);
    for (const m of f.metrics) {
      assert.ok(["计分", "验证/观察"].includes(m.role), `${f.id}:${m.name}`);
      for (const key of ["name","definition","unit","frequency","source"]) assert.ok(m[key]?.trim(), `${f.id}:${key}`);
    }
  }
});

test("all factor citations resolve to named HTTPS evidence, without claiming a current rating", () => {
  assert.equal(new Set(framework.sources.map(s => s.id)).size, framework.sources.length);
  for (const f of framework.indicators) {
    assert.ok(f.sourceRefs.length > 0, f.id);
    for (const ref of f.sourceRefs) {
      const s = framework.sources.find(s => s.id === ref || s.url === ref);
      assert.ok(s, `${f.id}:${ref}`);
      assert.equal(new URL(s.url).protocol, "https:");
      assert.ok(s.title && s.scope);
    }
    for (const field of ["score","currentScore","observation","asOf"]) assert.equal(field in f, false, `${f.id}:${field} is not a current result`);
  }
  assert.match(framework.status, /未生成当前评分/);
  assert.match(framework.status, /未回测/);
});

test("the initial indicator page renders weights, pending-data state and working standard targets", () => {
  const html = renderToStaticMarkup(React.createElement(StockRatingIndicators, { onViewStandard() {} }));
  assert.match(html, /21个核心因子/);
  assert.match(html, /本期数据待采集/);
  for (const f of framework.indicators.filter(f => f.dimension === "估值面")) {
    assert.ok(html.includes(f.name));
    assert.ok(html.includes(`查看${f.name}评分标准`));
    assert.ok(html.includes(`${f.weight}%`));
  }
});

test("each indicator deep link opens its own rule within the correct dimension", () => {
  for (const f of framework.indicators) {
    const html = renderToStaticMarkup(React.createElement(StockRatingStandards, { selectedRuleId: f.id }));
    assert.ok(html.includes(`id="stock-rule-${f.id}" open=""`), f.id);
    assert.ok(html.includes(f.name), f.id);
    assert.match(html, /计算与判定顺序/);
    assert.match(html, /约束与缺数处理/);
    assert.ok(html.includes(f.grades[0].replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")), `${f.id} first-grade content`);
    const expectedCards = framework.indicators.filter(g => g.dimension === f.dimension).length;
    assert.equal((html.match(/class="stock-rule-card"/g) || []).length, expectedCards, f.dimension);
    assert.equal((html.match(/id="stock-rule-[^"]+" open=""/g) || []).length, 1, f.id);
  }
});
