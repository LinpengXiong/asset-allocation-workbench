import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { resolveMacroAssessment, evaluateMacroResearchRating } from "../lib/macro-rating-research.mjs";

const live = JSON.parse(fs.readFileSync(new URL("../app/data/macro-rating-v1.json", import.meta.url), "utf8"));
// Keep the old research channel auditable without reactivating a retired rule.
const original = JSON.parse(fs.readFileSync(new URL("../deliverables/macro-rating-history-before-v1-14-2026-10-11.json", import.meta.url), "utf8"))
  .snapshots.find((snapshot) => snapshot.version === "V1.12").framework;
const makeFixture = () => {
  const framework = structuredClone(original);
  framework.version = "synthetic-research-test";
  framework.pillars = { "经济运行": .5, "宏观调控": .5 };
  framework.indicators = ["E01", "P01A", "P02B"].map((id, index) => ({
    ...structuredClone(original.indicators.find((item) => item.id === id)), weight: [.5, .3, .2][index],
  }));
  framework.researchAssessmentPolicy = { enabled: true, allowedIndicators: ["P01A", "P02B"] };
  const current = {
    asOf: "2026-10-11", version: framework.version,
    observations: {
      E01: { value: 4.3, period: "2026-Q2", releaseDate: "2026-09-15", verifiedAt: "2026-10-11", verified: true,
        unit: "%", basis: "单季实际同比", originalPublisher: "国家统计局", latestAvailablePeriod: "2026-Q2",
        sourceUrl: "https://www.stats.gov.cn/english/Statisticaldata/nsdp/201508/t20150831_1238096.html" },
      P01A: null, P02B: null,
    },
    researchAssessments: Object.fromEntries(["P01A", "P02B"].map((id) => [id, {
      points: id === "P01A" ? 4 : 3, status: "研究暂评", period: id === "P01A" ? "2026" : "2026-09",
      reviewDate: "2026-10-11", rationale: "测试研究判断：不代替官方量化原值，保留待核验口径。", confidence: "低",
      evidence: [{ finding: "测试用原文证据，未声称已经量化核验。", releaseDate: "2026-03-16",
        originalPublisher: id === "P01A" ? "财政部" : "中国人民银行",
        sourceUrl: id === "P01A" ? "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/202603/t20260316_3985331.htm"
          : "https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/index.html" }],
      unknowns: ["固定覆盖范围及两端完整原值仍未知。"], counterEvidence: ["研究归类可能因补齐原值而改变。"],
      thresholdComparison: "这是暂定方向归类，不是已验证落档，不宣称实际值已落入本版量化区间。",
    }])),
  };
  return { framework, current, rule: (id) => framework.indicators.find((item) => item.id === id) };
};

test("retired fiscal and RRR rules cannot regain scores through archived observations or research evidence", () => {
  const { current, rule } = makeFixture();
  current.version = live.version;
  for (const id of ["P01A", "P02B"]) {
    assert.ok(!live.indicators.some((item) => item.id === id));
    assert.deepEqual(resolveMacroAssessment(live, current, rule(id)), { points: null, type: "待核验", assessment: null });
  }
  const result = evaluateMacroResearchRating(live, current);
  assert.equal(result.research.indicatorCount, 38);
  assert.equal(result.research.count, 0);
  assert.equal(result.research.score, null);
});

test("the new RRR action ledger cannot inherit the retired RRR research points when its evidence is missing", () => {
  const current = JSON.parse(fs.readFileSync(new URL("../app/data/macro-rating-current.json", import.meta.url), "utf8"));
  const rule = live.indicators.find((item) => item.id === "P02E");
  assert.ok(rule);
  assert.deepEqual(current.researchAssessments, {});
  const input = structuredClone(current);
  input.researchAssessments.P02E = structuredClone(makeFixture().current.researchAssessments.P02B);
  input.researchAssessments.P02E.points = 5;
  assert.deepEqual(resolveMacroAssessment(live, input, rule), { points: 3, type: "核验评分", assessment: null });
  input.observations.P02E = null;
  assert.deepEqual(resolveMacroAssessment(live, input, rule), { points: null, type: "待核验", assessment: null });
  const result = evaluateMacroResearchRating(live, input);
  assert.equal(result.formalScore, null);
  assert.equal(result.research.count, 0);
  assert.equal(result.research.countTotal, 37);
  assert.equal(result.research.score, null);
  assert.ok(Math.abs(result.coverage - .995) < 1e-9);
});

test("research fills the scoring view but never turns complete research coverage into a formal rating", () => {
  const { framework, current } = makeFixture();
  const strict = evaluateMacroRating(framework, current), result = evaluateMacroResearchRating(framework, current);
  assert.deepEqual(Object.fromEntries(Object.keys(strict).map((key) => [key, result[key]])), strict);
  assert.equal(result.coverage, .5);
  assert.equal(result.verifiedWeight, .5);
  assert.equal(result.formalScore, null);
  assert.equal(result.grade, null);
  assert.equal(result.research.count, 2);
  assert.equal(result.research.countTotal, 3);
  assert.equal(result.research.indicatorCount, 3);
  assert.equal(result.research.coverage, 1);
  assert.equal(result.research.score, 3.3);
  assert.equal(result.research.grade, null);
  assert.deepEqual(result.research.pillars.map(({ name, score, coverage, researchCount }) => ({ name, score, coverage, researchCount })),
    [{ name: "经济运行", score: 3, coverage: 1, researchCount: 0 }, { name: "宏观调控", score: 3.6, coverage: 1, researchCount: 2 }]);
  assert.equal(current.observations.P01A, null);
  assert.equal(current.observations.P02B, null);
});

test("framework declaration and the fixed two-indicator whitelist are both mandatory", () => {
  for (const change of [
    (f) => { delete f.researchAssessmentPolicy; },
    (f) => { f.researchAssessmentPolicy.enabled = false; },
    (f) => { f.researchAssessmentPolicy.allowedIndicators = []; },
  ]) {
    const { framework, current, rule } = makeFixture(); change(framework);
    assert.equal(resolveMacroAssessment(framework, current, rule("P01A")).points, null);
  }
  const { framework, current, rule } = makeFixture();
  framework.researchAssessmentPolicy.allowedIndicators.push("E01");
  current.observations.E01 = null;
  current.researchAssessments.E01 = structuredClone(current.researchAssessments.P01A);
  assert.equal(resolveMacroAssessment(framework, current, rule("E01")).type, "待核验");
});

test("missing reasoning, unknowns, counter-evidence, threshold disclaimer or confidence cannot supply a neutral score", () => {
  for (const field of ["rationale", "unknowns", "counterEvidence", "thresholdComparison", "confidence", "evidence"]) {
    const { framework, current, rule } = makeFixture(); delete current.researchAssessments.P01A[field];
    assert.deepEqual(resolveMacroAssessment(framework, current, rule("P01A")), { points: null, type: "待核验", assessment: null });
  }
  for (const points of [0, 6, 3.5, "3", null]) {
    const { framework, current, rule } = makeFixture(); current.researchAssessments.P01A.points = points;
    assert.equal(resolveMacroAssessment(framework, current, rule("P01A")).points, null);
  }
  const { framework, current, rule } = makeFixture();
  current.researchAssessments.P01A.thresholdComparison = "实际值已经验证进入四分区间。";
  assert.equal(resolveMacroAssessment(framework, current, rule("P01A")).points, null);
});

test("a research review needs a current valid review date and an eligible, non-future assessment period", () => {
  for (const [id, field, value] of [
    ["P01A", "reviewDate", "2026-09-30"], ["P01A", "reviewDate", "2026-10-12"],
    ["P01A", "reviewDate", "2026-02-31"], ["P01A", "period", "2025"],
    ["P02B", "period", "2026-01"], ["P02B", "period", "2026-10"], ["P02B", "period", "2026-13"],
  ]) {
    const { framework, current, rule } = makeFixture(); current.researchAssessments[id][field] = value;
    assert.equal(resolveMacroAssessment(framework, current, rule(id)).points, null);
  }
  const { framework, current, rule } = makeFixture(); current.version = "a-different-rule-version";
  assert.equal(resolveMacroAssessment(framework, current, rule("P01A")).points, null);
});

test("every research evidence record requires the original agency, real date, source and stated finding", () => {
  for (const [id, field, value] of [
    ["P01A", "sourceUrl", "https://www.mof.gov.cn.fake.example/a"],
    ["P01A", "sourceUrl", "http://www.mof.gov.cn/a"],
    ["P01A", "sourceUrl", "https://economy.caixin.com/a"],
    ["P01A", "sourceUrl", "https://finance.sina.com.cn/a"],
    ["P01A", "originalPublisher", "媒体"], ["P01A", "finding", " "],
    ["P01A", "releaseDate", "2026-10-12"], ["P01A", "releaseDate", "2026-02-31"],
    ["P02B", "sourceUrl", "https://www.mof.gov.cn/a"],
  ]) {
    const { framework, current, rule } = makeFixture(); current.researchAssessments[id].evidence[0][field] = value;
    assert.equal(resolveMacroAssessment(framework, current, rule(id)).points, null);
  }
  const { framework, current, rule } = makeFixture();
  current.researchAssessments.P01A.evidence[0].sourceUrl = "https://www.npc.gov.cn/a";
  current.researchAssessments.P01A.evidence[0].originalPublisher = "全国人大";
  assert.equal(resolveMacroAssessment(framework, current, rule("P01A")).type, "研究暂评");
});

test("fiscal research can cite original statistical GDP evidence without permitting other publishers or RRR substitution", () => {
  const { framework, current, rule } = makeFixture();
  const evidence = { finding: "财政融资比重的GDP分母原始统计证据，不是暂评分的官方背书。", releaseDate: "2026-09-15",
    originalPublisher: "国家统计局", sourceUrl: "https://www.stats.gov.cn/english/Statisticaldata/nsdp/201508/t20150831_1238096.html" };
  current.researchAssessments.P01A.evidence.push(evidence);
  assert.equal(resolveMacroAssessment(framework, current, rule("P01A")).type, "研究暂评");
  current.researchAssessments.P01A.evidence.at(-1).originalPublisher = "媒体";
  assert.equal(resolveMacroAssessment(framework, current, rule("P01A")).points, null);
  current.researchAssessments.P02B.evidence.push(evidence);
  assert.equal(resolveMacroAssessment(framework, current, rule("P02B")).points, null);
});

test("a verified quantitative observation wins even if a conflicting research score is present", () => {
  const { framework, current, rule } = makeFixture();
  current.observations.P02B = {
    value: 0, period: "2026-09", releaseDate: "2026-03-01", verifiedAt: "2026-10-11", verified: true,
    unit: "基点", basis: "同口径月末有效利率近6月变动", originalPublisher: "中国人民银行", latestAvailablePeriod: "2026-09",
    sourceUrl: "https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/index.html",
    components: ["2026-03", "2026-09"].map((period) => ({ period, value: 7.5, unit: "%", basis: "月末有效政策利率",
      series: "reserveRequirementRatio", institution: "测试固定机构", coverage: "测试相同范围", effectiveDate: "2026-03-01",
      sourceUrl: "https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/index.html", releaseDate: "2026-03-01", originalPublisher: "中国人民银行" })),
  };
  current.researchAssessments.P02B.points = 5;
  assert.equal(scoreIndicator(rule("P02B"), current.observations.P02B, current.asOf, framework.freshness), 3);
  assert.deepEqual(resolveMacroAssessment(framework, current, rule("P02B")), { points: 3, type: "核验评分", assessment: null });
  const result = evaluateMacroResearchRating(framework, current);
  assert.equal(result.verifiedWeight, .7);
  assert.equal(result.research.count, 1);
});

test("partial research coverage never publishes a complete research score and returned evidence is independent", () => {
  const { framework, current, rule } = makeFixture();
  const resolved = resolveMacroAssessment(framework, current, rule("P01A"));
  resolved.assessment.unknowns[0] = "mutation";
  assert.notEqual(current.researchAssessments.P01A.unknowns[0], "mutation");
  delete current.researchAssessments.P02B;
  const result = evaluateMacroResearchRating(framework, current);
  assert.equal(result.research.coverage, .8);
  assert.equal(result.research.score, null);
  assert.equal(result.research.pillars.find((item) => item.name === "宏观调控").score, null);
  assert.equal(result.formalScore, null);
  assert.equal(result.research.grade, null);
});

test("a fully verified rating without research assessments never produces a duplicate research total", () => {
  const { framework, current } = makeFixture();
  framework.pillars = { "经济运行": 1 };
  framework.indicators = [{ ...framework.indicators[0], weight: 1 }];
  current.researchAssessments = {};
  const result = evaluateMacroResearchRating(framework, current);
  assert.equal(result.formalScore, 3);
  assert.equal(result.coverage, 1);
  assert.equal(result.research.count, 0);
  assert.equal(result.research.countTotal, 1);
  assert.equal(result.research.coverage, 1);
  assert.equal(result.research.score, null);
  assert.equal(result.research.grade, null);
});
