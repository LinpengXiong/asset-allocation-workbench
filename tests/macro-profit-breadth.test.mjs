import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROFIT_BREADTH_INDUSTRIES, validateProfitBreadthInput } from "../lib/macro-profit-breadth.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [current, audit] = await Promise.all([
  readJson("../app/data/macro-rating-current.json"),
  readJson("../deliverables/macro-v1-18-profit-breadth-input.json"),
]);
const cutoff = "2026-10-11";
const input = () => structuredClone(audit.input);
const observation = () => structuredClone(current.observations.G02);
const validate = (item = input(), host = observation(), asOf = cutoff) => validateProfitBreadthInput(item, host, asOf);
const close = (actual, expected) => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${expected}; got ${actual}`);
};

// Synthetic mutations below are validation-only; never write them to current.
function syntheticDirection(item, index, yoy, profit = 100) {
  const row = item.rawEvidence.industries[index];
  row.profit = profit;
  row.sourceTableRow.profit = profit.toFixed(1);
  row.officialYoyPct = yoy;
  row.sourceTableRow.profitYoy = yoy.toFixed(1);
  row.officialSpecialChange = null;
  row.priorProfitSign = "positive";
}

function syntheticSpecial(item, index, type, profit, text, priorProfitSign = "negative") {
  const row = item.rawEvidence.industries[index];
  row.profit = profit;
  row.sourceTableRow.profit = profit.toFixed(1);
  row.officialYoyPct = null;
  row.sourceTableRow.profitYoy = "（注1）";
  row.priorProfitSign = priorProfitSign;
  row.officialSpecialChange = { type, originalText: row.name + text,
    period: row.period, sourceUrl: row.sourceUrl, releaseDate: row.releaseDate };
}

test("the frozen 2026-08 official rows cover all 41 GB/T4754-2017 groups exactly once", () => {
  assert.equal(PROFIT_BREADTH_INDUSTRIES.length, 41);
  assert.equal(new Set(PROFIT_BREADTH_INDUSTRIES).size, 41);
  assert.equal(Object.isFrozen(PROFIT_BREADTH_INDUSTRIES), true);
  assert.equal(audit.input.rawEvidence.industries.length, 41);
  assert.deepEqual(audit.input.rawEvidence.industries.map((row) => row.name), [...PROFIT_BREADTH_INDUSTRIES]);
  const rows = audit.input.rawEvidence.industries;
  assert.equal(rows.filter((row) => row.officialYoyPct !== null && row.officialYoyPct > 0).length, 21);
  assert.equal(rows.filter((row) => row.officialYoyPct !== null && row.officialYoyPct < 0).length, 19);
  assert.equal(rows.filter((row) => row.officialSpecialChange?.type === "turnaround").length, 1);
  assert.equal(rows.filter((row) => row.profit > 0).length, 41);
  close(rows.reduce((sum, row) => sum + row.profit, 0), 52719.8);
  close(validate(), 22 / 41 * 100);
  close(1 + 4 * validate() / 100, 3.1463414634146343);
});

test("same original publication mirrors and row order do not change breadth", () => {
  const item = input();
  item.rawEvidence.industries.reverse();
  const host = observation();
  host.sourceUrl = item.sourceUrl;
  close(validate(item, host), 22 / 41 * 100);
  host.sourceUrl = "https://www.stats.gov.cn/xxgk/sjfb/zxfb2020/202609/t20260928_1965425.html";
  close(validate(item, host), 22 / 41 * 100);
  host.sourceUrl = "https://www.stats.gov.cn/sj/zxfbhjd/202609/t20260928_1965426.html";
  assert.equal(validate(item, host), null);
});

test("missing, duplicate, unrecognized and selected 30-industry samples never shrink the denominator", () => {
  for (const mutate of [
    (item) => item.rawEvidence.industries.pop(),
    (item) => item.rawEvidence.industries.push(structuredClone(item.rawEvidence.industries[0])),
    (item) => { item.rawEvidence.industries[1] = structuredClone(item.rawEvidence.industries[0]); },
    (item) => { item.rawEvidence.industries[0].name = "自选上游行业"; },
    (item) => { item.rawEvidence.industries = item.rawEvidence.industries.slice(0, 30); item.rawEvidence.expectedIndustryCount = 30; },
  ]) {
    const item = input(); mutate(item);
    assert.equal(validate(item), null);
  }
});

test("official zero growth is flat rather than a decline or arbitrary healthy score", () => {
  const item = input();
  syntheticDirection(item, 0, 0);
  item.value = (21 + .5) / 41 * 100;
  close(validate(item), item.value);
  for (let i = 0; i < 41; i++) syntheticDirection(item, i, 0);
  item.value = 50;
  close(validate(item), 50);
  close(1 + 4 * validate(item) / 100, 3);
});

test("all-improving and all-declining synthetic fixtures return bounded 100 and zero", () => {
  const item = input();
  for (let i = 0; i < 41; i++) syntheticDirection(item, i, 1);
  item.value = 100;
  close(validate(item), 100);
  for (let i = 0; i < 41; i++) syntheticDirection(item, i, -1);
  item.value = 0;
  close(validate(item), 0);
});

test("classifications must follow original rates and table tokens, never an input status flag", () => {
  for (const mutate of [
    (row) => { row.status = "改善"; },
    (row) => { row.direction = 1; },
    (row) => { row.improvementStatus = "改善"; },
    (row) => { row.officialYoyPct = -51.6; },
    (row) => { row.profit = -10; },
    (row) => { row.sourceTableRow.profitYoy = "-51.6"; },
    (row) => { row.sourceTableRow.profit = "111.1"; },
    (row) => { row.sourceTableRow.name = "其他采矿业"; },
    (row) => { row.officialYoyPct = "51.6"; },
    (row) => { delete row.sourceTableRow; },
  ]) {
    const item = input(); mutate(item.rawEvidence.industries[0]);
    assert.equal(validate(item), null);
  }
});

test("negative-base percentages are rejected; explicit loss-reduction and loss-increase facts are supported", () => {
  const mechanical = input();
  const row = mechanical.rawEvidence.industries[19];
  row.officialYoyPct = -250;
  row.sourceTableRow.profitYoy = "-250.0";
  row.officialSpecialChange = null;
  assert.equal(validate(mechanical), null);
  for (const [type, text, improvement] of [
    ["lossReduction", "同比减亏。", true],
    ["lossIncrease", "同比增亏。", false],
  ]) {
    const item = input();
    syntheticSpecial(item, 0, type, -10, text);
    item.value = (improvement ? 22 : 21) / 41 * 100;
    close(validate(item), item.value);
  }
  const turn = input();
  syntheticSpecial(turn, 0, "turnToLoss", -10, "由盈转亏。", "positive");
  turn.value = 21 / 41 * 100;
  close(validate(turn), turn.value);
});

test("a positive comparable base may turn to loss, but contrary current-profit signs are rejected", () => {
  const item = input();
  syntheticDirection(item, 0, -120, -20);
  item.value = 21 / 41 * 100;
  close(validate(item), item.value);
  for (const [yoy, profit] of [[51.6, -10], [-50, -10], [-100, 1], [-120, 10]]) {
    const invalid = input();
    syntheticDirection(invalid, 0, yoy, profit);
    assert.equal(validate(invalid), null);
  }
});

test("special changes require explicit original facts matching industry, sign, period and source", () => {
  for (const mutate of [
    (row) => { row.officialSpecialChange = null; },
    (row) => { row.officialSpecialChange.originalText = "研究判断：改善"; },
    (row) => { row.officialSpecialChange.originalText = row.name + "未扭亏为盈。"; },
    (row) => { row.officialSpecialChange.originalText = row.name + "未实现扭亏为盈。"; },
    (row) => { row.officialSpecialChange.type = "lossReduction"; },
    (row) => { row.priorProfitSign = "positive"; },
    (row) => { row.profit = -562.9; row.sourceTableRow.profit = "-562.9"; },
    (row) => { row.sourceTableRow.profitYoy = "0.0"; },
    (row) => { row.officialSpecialChange.sourceUrl = "https://example.com/quote"; },
    (row) => { row.officialSpecialChange.period = "2026-07"; },
    (row) => { row.officialSpecialChange.releaseDate = "2026-10-12"; },
  ]) {
    const item = input(); mutate(item.rawEvidence.industries[19]);
    assert.equal(validate(item), null);
  }
});

test("future dates, nonexistent dates, unavailable periods, wrong scope and improper sources return null", () => {
  for (const mutate of [
    (item) => { item.verifiedAt = "2026-10-12"; },
    (item) => { item.releaseDate = "2026-10-12"; },
    (item) => { item.releaseDate = "2026-08-30"; },
    (item) => { item.verifiedAt = "2026-09-27"; },
    (item) => { item.verifiedAt = "2026-09-31"; },
    (item) => { item.latestAvailablePeriod = "2026-07"; },
    (item) => { item.period = "2026-01"; },
    (item) => { item.scope = "全部中国企业"; },
    (item) => { item.basis = "当月分行业利润改善广度"; },
    (item) => { item.unit = "指数点"; },
    (item) => { item.originalPublisher = "媒体"; },
    (item) => { item.sourceUrl = "https://www.stats.gov.cn.example.com/sj/zxfbhjd/202609/t20260928_1965425.html"; },
    (item) => { item.sourceUrl = "https://www.stats.gov.cn/sj/sjjd/202609/t20260928_1965425.html"; },
    (item) => { item.sourceUrl = "http://www.stats.gov.cn/sj/zxfbhjd/202609/t20260928_1965425.html"; },
    (item) => { item.rawEvidence.classification = "其他行业分类"; },
    (item) => { item.rawEvidence.aggregation = "8月单月"; },
    (item) => { item.rawEvidence.notDerivedFromPublishedAmounts = false; },
    (item) => { item.rawEvidence.industries[0].verified = false; },
    (item) => { item.rawEvidence.industries[0].verifiedAt = "2026-10-12"; },
    (item) => { item.rawEvidence.industries[0].period = "2026-07"; },
    (item) => { item.rawEvidence.industries[0].sourceUrl = "https://www.stats.gov.cn/sj/zxfbhjd/202607/t20260727_1964194.html"; },
  ]) {
    const item = input(); mutate(item);
    assert.equal(validate(item), null);
  }
  assert.equal(validate(input(), observation(), "2026-09-27"), null);
  const host = observation(); host.profitQuality.sameScope = false;
  assert.equal(validate(input(), host), null);
});

test("the input value is recomputed; counts, a rounded score or a profitable-industry share cannot replace it", () => {
  for (const value of [21 / 41 * 100, 100, 3.1463414634, null, "53.658537", -1, 101, NaN, Infinity]) {
    const item = input(); item.value = value;
    assert.equal(validate(item), null);
  }
  const rounded = input(); rounded.value = 53.658537;
  close(validate(rounded), 22 / 41 * 100);
});

test("62% electronics growth contribution is not represented as its profit share", () => {
  assert.equal(audit.growthContribution.value, 62);
  assert.match(audit.growthContribution.basis, /growthContribution/);
  assert.match(audit.growthContribution.basis, /不是利润总额份额/);
  assert.ok(audit.growthContribution.sourceUrl.includes("t20260928_1965426.html"));
  const electronics = audit.input.rawEvidence.industries.find((row) => row.name === "计算机、通信和其他电子设备制造业");
  close(electronics.profit, 8474.7);
  assert.notEqual(electronics.profit / 52719.8 * 100, audit.growthContribution.value);
  assert.match(audit.scopeNote, /不是全体中国企业/);
});
