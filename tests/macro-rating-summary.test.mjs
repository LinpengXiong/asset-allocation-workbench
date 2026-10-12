import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { summarizePillarWeights, formatTotalWeight, describePillarRole, macroRatingScopeNote, macroRatingTimelinessNote } from "../lib/macro-rating-summary.mjs";

const framework = JSON.parse(await readFile(new URL("../app/data/macro-rating-v1.json", import.meta.url), "utf8"));

test("all four pillars show accurate counts, totals and subgroup weights from the current rules", () => {
  const expected = {
    经济运行: [8, "25%", [["经济增长", 1, "7%"], ["物价水平", 4, "11%"], ["就业市场", 1, "2.5%"], ["景气指数", 2, "4.5%"]]],
    增长动力: [14, "40%", [["工业生产", 5, "14%"], ["房地产", 3, "4.5%"], ["投资", 3, "8%"], ["消费", 2, "9.5%"], ["进出口", 1, "4%"]]],
    金融信贷: [7, "20%", [["信贷结构", 2, "6%"], ["社会融资", 2, "5.5%"], ["部门杠杆率", 2, "6%"], ["货币供给", 1, "2.5%"]]],
    宏观调控: [9, "15%", [["货币政策", 3, "5%"], ["财政政策", 2, "5%"], ["产业政策", 2, "2.5%"], ["制度建设", 2, "2.5%"]]],
  };
  for (const [pillar, [count, weight, groups]] of Object.entries(expected)) {
    const summary = summarizePillarWeights(framework, pillar);
    assert.equal(summary.count, count);
    assert.equal(formatTotalWeight(summary.weight), weight);
    assert.deepEqual(summary.groups.map((item) => [item.name, item.count, formatTotalWeight(item.weight)]), groups);
    assert.equal(summary.groups.reduce((sum, item) => sum + item.count, 0), count);
    assert.ok(Math.abs(summary.groups.reduce((sum, item) => sum + item.weight, 0) - summary.weight) < 1e-9);
  }
});

test("the revised framework replaces overlapping series without inheriting their indicator IDs", () => {
  assert.match(framework.version, /^V1\.\d+$/);
  assert.equal(framework.indicators.length, 38);
  const ids = new Set(framework.indicators.map((item) => item.id));
  for (const replaced of ["G08", "G09", "F03", "P01A", "P01B", "P01D"]) assert.equal(ids.has(replaced), false, replaced);
  for (const introduced of ["G16", "G17", "G18", "P01E", "P01F"]) assert.equal(ids.has(introduced), true, introduced);
  assert.ok(Math.abs(framework.indicators.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-9);
  assert.ok(framework.ratingBands.every((band) => !/复苏|改善|下行/.test(band.label)));
});

test("the RRR ledger keeps the verified 12-month definition and budgets while its amplitude mapping becomes continuous", () => {
  assert.equal(framework.researchAssessmentPolicy.enabled, false);
  assert.deepEqual(framework.researchAssessmentPolicy.allowedIndicators, []);
  assert.match(framework.researchAssessmentPolicy.definition, /量化数据须通过原始发布/);
  assert.equal(framework.indicators.find((rule) => rule.id === "P01A"), undefined);
  assert.equal(framework.indicators.find((rule) => rule.id === "P01E").weight, .035);
  assert.equal(framework.indicators.find((rule) => rule.id === "P01F").weight, .015);
  assert.equal(framework.indicators.find((rule) => rule.id === "P02B"), undefined);
  assert.equal(framework.indicators.find((rule) => rule.id === "P02E").weight, .005);
  assert.deepEqual(framework.indicators.find((rule) => rule.id === "P02E").scoring.anchors, [[-100,5],[-50,4],[0,3],[50,2],[100,1]]);
  assert.equal(framework.indicators.find((rule) => rule.id === "P02E").aggregation, "近12完整月普遍法定准备金率动作累计");
});

test("presentation separates policy response from realized conditions and never suggests automatic allocation", () => {
  for (const pillar of ["经济运行", "增长动力", "金融信贷"]) assert.equal(describePillarRole(pillar).kind, "基本面与信用");
  assert.equal(describePillarRole("宏观调控").kind, "政策响应与制度");
  assert.match(describePillarRole("宏观调控").description, /不自动判定经济复苏/);
  assert.match(macroRatingScopeNote, /股票、债券、商品须分别分析/);
  assert.match(macroRatingScopeNote, /不由宏观总分直接生成买卖或仓位/);
  assert.match(macroRatingTimelinessNote, /月度3个月、季度6个月/);
  assert.match(macroRatingTimelinessNote, /上限，并非承诺已取到最新发布/);
  assert.match(macroRatingTimelinessNote, /空值不补分/);
});

test("half-percent weights are not rounded into different weights", () => {
  assert.equal(formatTotalWeight(.085), "8.5%");
  assert.equal(formatTotalWeight(.095), "9.5%");
  assert.equal(formatTotalWeight(.055), "5.5%");
  assert.equal(formatTotalWeight(.025), "2.5%");
  assert.equal(formatTotalWeight(.060000000000000005), "6%");
  assert.equal(formatTotalWeight(.0125), "1.25%");
  assert.equal(formatTotalWeight(.125), "12.5%");
});

test("summaries adapt to rule changes without mutating the scoring framework", () => {
  const before = JSON.stringify(framework);
  for (const pillar of Object.keys(framework.pillars)) summarizePillarWeights(framework, pillar);
  assert.equal(JSON.stringify(framework), before);
  const updated = structuredClone(framework);
  updated.indicators.find((item) => item.id === "E01").weight = .08;
  updated.indicators.find((item) => item.id === "E05").weight = .035;
  const summary = summarizePillarWeights(updated, "经济运行");
  assert.equal(formatTotalWeight(summary.groups.find((item) => item.name === "经济增长").weight), "8%");
  assert.equal(formatTotalWeight(summary.groups.find((item) => item.name === "就业市场").weight), "3.5%");
  assert.equal(formatTotalWeight(summary.weight), "25%");
});
