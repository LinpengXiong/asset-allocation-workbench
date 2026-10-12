import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scoreIndicator, evaluateMacroRating } from "../lib/macro-rating.mjs";

// Freeze legacy boundary fixtures; V1.15 current-data tests exercise the new continuous rules separately.
const framework = JSON.parse(await readFile(new URL("../deliverables/macro-rating-framework-before-v1-15-2026-10-11.json", import.meta.url), "utf8"));
const prices = JSON.parse(await readFile(new URL("../app/data/macro-secondhand-price.json", import.meta.url), "utf8"));
const creditAudit = JSON.parse(await readFile(new URL("../app/data/macro-credit-source-audit.json", import.meta.url), "utf8"));
const ruleById = (id) => framework.indicators.find((rule) => rule.id === id);
const cutoff = "2026-10-01";
const clone = (value) => structuredClone(value);
const sourceFor = (rule) => rule.id === "G10" ? "https://www.customs.gov.cn/test-synthetic-only"
  : /^[EG]/.test(rule.id) ? "https://www.stats.gov.cn/test-synthetic-only"
    : ["F09", "F10"].includes(rule.id) ? "http://www.nifd.cn/test-synthetic-only"
      : /^F|^P02/.test(rule.id) ? "https://www.pbc.gov.cn/test-synthetic-only"
        : /^P01/.test(rule.id) ? "https://gks.mof.gov.cn/test-synthetic-only" : "https://www.gov.cn/test-synthetic-only";

// Every synthetic fixture is validation-only. None is imported into current observations.
const base = (rule, value = 3, period = rule.frequency.startsWith("季度") ? "2026-Q2" : "2026-08") => ({
  value, period, unit: rule.unit, basis: rule.measurementBasis, originalPublisher: rule.originalPublisher,
  latestAvailablePeriod: period, verifiedAt: cutoff, verified: true,
  sourceUrl: sourceFor(rule), releaseDate: period.includes("-Q") ? "2026-07-30" : "2026-09-15",
});
const raw = (rule, period, value, extra = {}) => ({
  period, value, sourceUrl: sourceFor(rule), releaseDate: "2026-09-15", ...extra,
});
const evidence = (period = "2026-Q2") => ({
  metric: "测试证据", period, finding: "仅测试：记录资料不足及反向风险，不推测偿债率",
  originalPublisher: "国家统计局", sourceUrl: "https://www.stats.gov.cn/test-synthetic-only", releaseDate: "2026-07-30",
});
const policyFixture = (rule, value = 4) => {
  const observation = base(rule, value);
  const formal = { theme: rule.policyTheme, stage: "正式文件", status: "有效", title: "测试用正式政策",
    summary: "明确范围及实施条件", eventId: "synthetic-" + rule.id, mechanism: rule.policyTheme,
    sourceUrl: observation.sourceUrl, releaseDate: "2026-06-01", effectiveDate: "2026-07-01" };
  const execution = { theme: rule.policyTheme, stage: "执行进展", title: "测试执行报告",
    summary: "相同评价范围的可核验进展", eventId: formal.eventId, mechanism: formal.mechanism,
    scope: "全国评价范围", sourceUrl: "https://www.gov.cn/test-synthetic-execution-" + rule.id, releaseDate: "2026-08-15" };
  return { ...observation, sourceUrl: value === 5 ? execution.sourceUrl : formal.sourceUrl,
    releaseDate: value === 5 ? execution.releaseDate : formal.releaseDate,
    rationale: "对有效正式文件、执行条件、反证和局限的测试研判",
    policyReview: { reviewDate: "2026-08-31", scope: "全国评价范围", instruments: "测试资源和工具",
      responsibleAgency: "测试主管部门", timetable: "正式时间表", beneficiaries: "同时记录受益与受损部门",
      risks: "不确定性", counterEvidence: "检验相反证据与受损部门，未发现不代表不存在",
      noDoubleCounting: "按事件与机制去重，同一政策不因重复公告再奖励",
      direction: value >= 4 ? "改善" : value <= 2 ? "恶化" : "中性或混合",
      evidence: value === 5 ? [formal, execution] : [formal],
      ...(value === 5 ? { executionSummary: "按时间表核验实施；不冒称长期盈利兑现" } : {}) } };
};
const leverageFixture = (rule) => {
  const observation = base(rule, 3);
  const series = rule.id === "F09" ? "householdLeverage" : "corporateLeverage";
  return { ...observation, leverageRatio: 61, yearAgoLeverageRatio: 60, rationale: "分子分母及偿债证据矩阵的中性研判",
    leverageComponents: ["2025-Q2", "2026-Q2"].map((period, index) => raw(rule, period, index ? 61 : 60, {
      series, unit: "%", basis: "部门债务/过去四季名义GDP", releaseDate: index ? "2026-07-30" : "2025-07-30",
    })),
    leverageReview: { reviewDate: "2026-08-31", scoreReason: "杠杆率不能机械低优，收入及偿债约束共同核验",
      nominalGdpEffect: { debtGrowthPct: 5, nominalGdpGrowthPct: 4, revisionVersion: "synthetic-same-vintage",
        summary: "区分债务增加与名义GDP分母变动", evidence: [evidence()] },
      incomeOrProfit: { summary: "同部门收入或盈利", evidence: [evidence()] },
      debtService: { summary: "记录偿债资料和覆盖局限", evidence: [evidence()] },
      counterEvidence: { summary: "记录反向证据", evidence: [evidence()] } } };
};
const rateFixture = (rule) => {
  const lending = rule.aggregation === "企业贷款利率同比变化";
  const observation = base(rule, -50, lending ? "2026-06" : "2026-08");
  const periods = lending ? ["2025-06", "2026-06"] : ["2026-02", "2026-08"];
  return { ...observation, releaseDate: lending ? "2026-08-15" : "2026-08-01",
    components: periods.map((period, index) => raw(rule, period, index ? 3 : 3.5, {
      series: rule.componentSeries, unit: "%", releaseDate: lending ? (index ? "2026-08-15" : "2025-08-15") : period + "-01",
      ...(lending ? { basis: "当月新发放企业贷款加权平均利率" } : {
        effectiveDate: period + "-01", ...(rule.componentSeries === "reserveRequirementRatio" ? {
          institution: "相同金融机构类型", coverage: "同口径适用范围",
        } : {}),
      }),
    })) };
};
const rrrFixture = (rule, change = 0) => {
  const observation = base(rule, change);
  const periods = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  return { ...observation, rrrActionLedger: {
    windowStart: "2025-09-01", windowEnd: "2026-08-31",
    monthlyChecks: periods.map((period, index) => ({ period, tool: "调整法定存款准备金率", unit: "亿元",
      tableComplete: true, policyReviewComplete: true, injection: index === 11 && change ? 1000 : "-",
      withdrawal: "-", netInjection: index === 11 && change ? 1000 : "-", finding: "仅测试：月表完整，原符号不换算基点",
      originalPublisher: rule.originalPublisher, sourceUrl: sourceFor(rule) + "/" + period, releaseDate: "2026-09-15" })),
    adjustmentEvents: change ? [{ eventId: "synthetic-general-cut", announcementDate: "2026-08-01", releaseDate: "2026-08-01",
      effectiveDate: "2026-08-15", scopeType: "普遍", currency: "人民币", signedChangeBp: change,
      unit: "基点", rawChange: { value: change / 100, unit: "百分点" }, institutionCoverage: "普遍适用范围",
      exceptionNote: "仅测试：不含已在最低档机构，专属调整另列", executed: true,
      originalPublisher: rule.originalPublisher, sourceUrl: sourceFor(rule) + "/notice" }] : [],
    crossChecks: [{ type: "年度执行报告", coverageStart: "2025-09-01", coverageEnd: "2025-12-31",
      finding: "仅测试年度交叉资料", originalPublisher: rule.originalPublisher, sourceUrl: sourceFor(rule) + "/annual", releaseDate: "2026-02-10" },
    { type: "政策公告复核", coverageStart: "2026-01-01", coverageEnd: "2026-08-31",
      finding: "仅测试连续公告复核", originalPublisher: rule.originalPublisher, sourceUrl: sourceFor(rule) + "/review", releaseDate: "2026-09-15",
      reviewedSources: [{ sourceUrl: sourceFor(rule) + "/directory", reviewDate: cutoff, finding: "仅测试已读目录" },
        { sourceUrl: sourceFor(rule) + "/notice", releaseDate: "2026-08-01", originalPublisher: rule.originalPublisher, finding: "仅测试已读政策原文" }] }],
  } };
};
const fiscalFixture = (rule) => ({
  ...base(rule, 5), fiscalExpenditure: { series: rule.componentSeries, scope: "全国", period: "2026-08",
    basis: "年初累计可比同比", reportedYoyPct: 5, cumulativeExpenditure: 100, unit: "亿元",
    comparabilityNote: "可比范围按财政部原文；不机械相除已公布金额", sourceUrl: sourceFor(rule), releaseDate: "2026-09-15" },
});
const resourceFixture = (rule) => {
  const observation = { ...base(rule, 1, "2026"), releaseDate: "2026-03-15", reviewDate: cutoff };
  return { ...observation, components: [2025, 2026].map((year, index) => ({
    year, period: String(year), value: index ? 6 : 5, series: "fiscalFinancingResources", basis: "正式批准财政融资资源占上年GDP",
    unit: "百分点", budgetStage: "正式批准预算", noDoubleCounting: "赤字融资已含地方一般债，不另加；不含置换与再融资",
    sourceUrl: sourceFor(rule), releaseDate: year + "-03-15",
    items: [{ component: "赤字融资", purpose: "新增预算支出融资", amount: index ? 40000 : 30000,
      unit: "亿元", sourceUrl: sourceFor(rule), releaseDate: year + "-03-15", approvalDate: year + "-03-10" },
    { component: "新增地方专项债", purpose: "正式新增项目额度", amount: 20000,
      unit: "亿元", sourceUrl: sourceFor(rule), releaseDate: year + "-03-15", approvalDate: year + "-03-10" }],
    gdp: { year: year - 1, value: 1000000, unit: "亿元", revisionVersion: "synthetic-same-vintage",
      sourceUrl: "https://www.stats.gov.cn/test-synthetic-only", releaseDate: "2026-01-20" },
  })) };
};
const deflatorFixture = (rule, value = (31500 / 30000 / 1.04 - 1) * 100) => {
  const observation = base(rule, value);
  const common = { revisionVersion: "synthetic-same-vintage", sourceUrl: sourceFor(rule), releaseDate: "2026-07-30" };
  return { ...observation, gdpDeflatorEvidence: { period: observation.period, revisionVersion: common.revisionVersion,
    currentNominal: { ...common, period: "2026-Q2", value: 31500, unit: "亿元" },
    priorNominal: { ...common, period: "2025-Q2", value: 30000, unit: "亿元" },
    realGrowth: { ...common, period: "2026-Q2", value: 4, unit: "%", basis: "单季实际同比" } } };
};
const fixture = (rule) => {
  if (rule.evidenceType === "政策实施") return policyFixture(rule, 3);
  if (rule.evidenceType === "部门杠杆率") return leverageFixture(rule);
  if (rule.aggregation === "GDP平减指数单季同比") return deflatorFixture(rule);
  if (rule.aggregation === "财政融资资源比重同比差") return resourceFixture(rule);
  if (rule.aggregation === "财政支出累计同比") return fiscalFixture(rule);
  if (rule.aggregation === "近12完整月普遍法定准备金率动作累计") return rrrFixture(rule);
  if (["近6月政策利率变动", "企业贷款利率同比变化"].includes(rule.aggregation)) return rateFixture(rule);
  const observation = base(rule, 0);
  if (["G16", "G17"].includes(rule.id)) observation.series = rule.componentSeries;
  if (rule.id === "G13") observation.investmentScope = "含电力、热力、燃气及水生产和供应业";
  if (rule.profitQualityRequired) observation.profitQuality = {
    period: observation.period, sameScope: true, comparabilityNote: "同范围规模以上工业企业", limitations: "非上市公司全体盈利",
    profitMargin: raw(rule, observation.period, 6, { unit: "%", scope: "规模以上工业企业", basis: "营业收入利润率" }),
    receivables: raw(rule, observation.period, 70, { unit: "天", scope: "规模以上工业企业", basis: "应收账款平均回收期" }),
    counterEvidence: { summary: "记录回款约束，不以高利润同比掩盖回款恶化", evidence: [evidence()] },
  };
  if (rule.aggregation === "近3月均值") {
    observation.value = 50;
    observation.components = ["2026-06", "2026-07", "2026-08"].map((period) => raw(rule, period, 50, {
      series: rule.componentSeries, unit: "指数点", basis: "季调当月指数" }));
  } else if (rule.aggregation === "70城二手房价近3月均值") {
    observation.value = -.3;
    observation.components = ["2026-06", "2026-07", "2026-08"].map((period) => raw(rule, period, -.3, {
      unit: "%", basis: "70城二手住宅环比中位数",
      cities: Array.from({ length: 70 }, (_, index) => ({ city: "测试城市" + (index + 1), momIndex: 99.7 })) }));
  } else if (rule.aggregation === "季度同比差") {
    observation.value = .2;
    observation.components = ["2025-Q2", "2026-Q2"].map((period, index) => raw(rule, period, index ? 75.2 : 75, {
      unit: "%", basis: "季度工业产能利用率", series: rule.componentSeries, releaseDate: "2026-07-30" }));
  } else if (rule.aggregation === "近3月同比多增") {
    observation.components = ["2025-06", "2025-07", "2025-08", "2026-06", "2026-07", "2026-08"].map((period) =>
      raw(rule, period, 100, { series: rule.componentSeries, unit: "亿元", basis: "当月新增" }));
  } else if (rule.aggregation === "同月同比差") {
    observation.value = -3;
    observation.components = ["m1New", "m2"].map((series, index) =>
      raw(rule, observation.period, index ? 7 : 4, { series, unit: "%", basis: "月末余额同比" }));
  } else if (["剔除政府债后社融存量同比", "剔除政府债后社融同比近3月变动"].includes(rule.aggregation)) {
    const momentum = rule.aggregation.endsWith("近3月变动");
    observation.value = momentum ? -1 : 3;
    observation.components = (momentum ? ["2025-05", "2026-05", "2025-08", "2026-08"] : ["2025-08", "2026-08"])
      .map((period, index) => raw(rule, period, (momentum ? [100, 104, 100, 103] : [100, 103])[index], {
        totalStock: (momentum ? [110, 114, 110, 113] : [110, 113])[index], governmentBondStock: 10,
        unit: "万亿元", basis: "同口径月末存量",
      }));
  }
  return observation;
};
const point = (id, observation = fixture(ruleById(id)), asOf = cutoff) => scoreIndicator(ruleById(id), observation, asOf);

test("the current framework preserves user anchors, 37 unique indicators and exact pillar budgets", () => {
  assert.match(framework.version, /^V1\.\d+$/);
  assert.equal(framework.indicators.length, 37);
  assert.equal(new Set(framework.indicators.map((rule) => rule.id)).size, 37);
  assert.deepEqual(framework.pillars, { 经济运行: .3, 增长动力: .3, 金融信贷: .2, 宏观调控: .2 });
  assert.deepEqual(Object.fromEntries(framework.indicators.filter((rule) => rule.pillar === "经济运行").map((rule) => [rule.id, rule.weight])),
    { E01: .09, E02: .025, E03: .035, E04: .05, E05: .025, E07: .03, E08: .02, E09: .025 });
  assert.deepEqual(Object.fromEntries(framework.indicators.filter((rule) => rule.pillar === "金融信贷").map((rule) => [rule.id, rule.weight])),
    { F01: .025, F02: .035, F07: .035, F08: .02, F09: .03, F10: .03, F05: .025 });
  for (const [pillar, budget] of Object.entries(framework.pillars)) {
    assert.ok(Math.abs(framework.indicators.filter((rule) => rule.pillar === pillar).reduce((sum, rule) => sum + rule.weight, 0) - budget) < 1e-9);
  }
  for (const rule of framework.indicators) {
    assert.equal(rule.grades.length, 5);
    for (const key of ["measurementBasis", "originalPublisher", "scoringBasis", "thresholdStatus"]) assert.ok(rule[key], rule.id + " " + key);
    assert.match(rule.thresholdStatus, /试行/);
  }
  assert.equal(ruleById("E04").weight, .05);
  assert.equal(ruleById("E05").weight, .025);
  assert.equal(ruleById("G02").weight, .04);
  assert.equal(ruleById("P01E").weight, .04);
  assert.equal(ruleById("P01F").weight, .02);
  assert.equal(framework.indicators.filter((rule) => rule.pillar === "宏观调控").length, 9);
  assert.ok(Math.abs(framework.indicators.reduce((sum, rule) => sum + rule.weight, 0) - 1) < 1e-9);
  assert.equal(ruleById("G02").profitQualityRequired, true);
  assert.equal(framework.freshness.monthlyMaxAgeMonths, 3);
  assert.equal(framework.freshness.quarterlyMaxAgeMonths, 6);
});

test("property 4.5% and macro-policy subbudgets remain unchanged; old IDs never migrate", () => {
  assert.equal(framework.indicators.filter((rule) => rule.pillar === "增长动力").length, 13);
  assert.ok(Math.abs(framework.indicators.filter((rule) => rule.group === "房地产").reduce((sum, rule) => sum + rule.weight, 0) - .045) < 1e-9);
  for (const [group, budget] of Object.entries({ 货币政策: .06, 财政政策: .06, 产业政策: .04, 制度建设: .04 })) {
    assert.ok(Math.abs(framework.indicators.filter((rule) => rule.pillar === "宏观调控" && rule.group === group)
      .reduce((sum, rule) => sum + rule.weight, 0) - budget) < 1e-9);
  }
  const ids = ["E06", "G05", "G08", "G09", "F03", "F06", "P01A", "P01B", "P01C", "P01D", "P02B", "P02C", "P03", "P04"];
  for (const id of ids) assert.equal(ruleById(id), undefined);
  const observations = Object.fromEntries(ids.map((id) => [id, base(ruleById("G14"), 99)]));
  assert.equal(evaluateMacroRating(framework, { asOf: cutoff, observations }).coverage, 0);
});

test("all quantitative grade text and actual before/equal/after boundary scores agree", () => {
  const expected = (mode, limits, value) => {
    if (mode === "高优") return 1 + limits.filter((boundary) => value >= boundary).length;
    if (mode === "低优") return 5 - limits.filter((boundary) => value >= boundary).length;
    const ranges = [[limits[6], limits[7], 5], [limits[4], limits[5], 4], [limits[2], limits[3], 3], [limits[0], limits[1], 2]];
    return ranges.find(([low, high]) => value >= low && value <= high)?.[2] ?? 1;
  };
  for (const realRule of framework.indicators.filter((rule) => rule.mode !== "原文研判")) {
    const rule = { ...realRule, id: "E99", frequency: "月度", aggregation: undefined, profitQualityRequired: undefined };
    for (const boundary of rule.limits) {
      for (const value of [boundary - .00001, boundary, boundary + .00001]) {
        assert.equal(scoreIndicator(rule, base(rule, value), cutoff), expected(rule.mode, rule.limits, value), realRule.id + " at " + value);
      }
    }
    const l = rule.limits, u = rule.unit;
    const ascending = ["<" + l[0] + " " + u, "[" + l[0] + "," + l[1] + ") " + u,
      "[" + l[1] + "," + l[2] + ") " + u, "[" + l[2] + "," + l[3] + ") " + u, "≥" + l[3] + " " + u];
    const target = ["<" + l[0] + "或>" + l[1] + " " + u, "[" + l[0] + "," + l[2] + ")或(" + l[3] + "," + l[1] + "] " + u,
      "[" + l[2] + "," + l[4] + ")或(" + l[5] + "," + l[3] + "] " + u,
      "[" + l[4] + "," + l[6] + ")或(" + l[7] + "," + l[5] + "] " + u, "[" + l[6] + "," + l[7] + "] " + u];
    assert.deepEqual(realRule.grades, rule.mode === "目标" ? target : rule.mode === "高优" ? ascending : ascending.toReversed(), realRule.id);
  }
});

test("valid current fixtures cover all 37 rules; absence never becomes neutral or a formal total", () => {
  const observations = Object.fromEntries(framework.indicators.map((rule) => [rule.id, fixture(rule)]));
  for (const rule of framework.indicators) assert.notEqual(scoreIndicator(rule, observations[rule.id], cutoff), null, rule.id);
  const complete = evaluateMacroRating(framework, { asOf: cutoff, observations });
  assert.equal(complete.status, "正式");
  assert.ok(complete.formalScore >= 1 && complete.formalScore <= 5);
  delete observations.E01;
  const incomplete = evaluateMacroRating(framework, { asOf: cutoff, observations });
  assert.equal(incomplete.status, "暂定");
  assert.equal(incomplete.formalScore, null);
  assert.equal(incomplete.grade, null);
  const empty = evaluateMacroRating(framework, { asOf: null, observations: {} });
  assert.equal(empty.status, "资料不足");
  assert.equal(empty.coverage, 0);
  assert.equal(empty.formalScore, null);
  assert.equal(empty.grade, null);
});

test("separate research judgments never make missing quantitative observations pass strict scoring", () => {
  const observations = Object.fromEntries(framework.indicators.map((rule) => [rule.id, fixture(rule)]));
  observations.P02E = null;
  const current = { version: framework.version, asOf: cutoff, observations,
    researchAssessments: { P02E: { points: 3, status: "研究暂评" } } };
  assert.equal(ruleById("P01A"), undefined);
  assert.equal(point("P02E", current.observations.P02E), null);
  const strict = evaluateMacroRating(framework, current);
  assert.ok(Math.abs(strict.coverage - .99) < 1e-9);
  assert.equal(strict.pillars.reduce((sum, pillar) => sum + pillar.verifiedCount, 0), 36);
  assert.equal(strict.formalScore, null);
  assert.equal(strict.grade, null);
});

test("main publisher, unit, statistical basis, latest declaration and verification date are mandatory", () => {
  const observation = fixture(ruleById("E02"));
  for (const patch of [{ verified: false }, { sourceUrl: "https://example.com/claim" },
    { sourceUrl: "https://stats.gov.cn.example.com/spoof" }, { unit: "亿元" }, { basis: "累计同比" },
    { originalPublisher: "媒体报道" }, { latestAvailablePeriod: "2026-09" }, { verifiedAt: undefined },
    { verifiedAt: "2026-09-01" }, { verifiedAt: "2026-10-02" }, { releaseDate: "2026-02-30" }]) {
    assert.equal(point("E02", { ...observation, ...patch }), null, JSON.stringify(patch));
  }
});

test("the original customs HTTP publication is accepted narrowly, not arbitrary insecure or spoofed sources", () => {
  const observation = fixture(ruleById("G10"));
  assert.notEqual(point("G10", { ...observation, sourceUrl: "http://english.customs.gov.cn/Statics/test-synthetic-only.html" }), null);
  assert.equal(point("G10", { ...observation, sourceUrl: "http://customs.gov.cn.example.com/spoof" }), null);
  assert.equal(point("E02", { ...fixture(ruleById("E02")), sourceUrl: "http://www.stats.gov.cn/test-synthetic-only" }), null);
  assert.equal(point("F05", { ...fixture(ruleById("F05")), sourceUrl: "http://www.pbc.gov.cn/test-synthetic-only" }), null);
});

test("monthly and quarterly period shapes, publication timing and conservative freshness are enforced", () => {
  const monthly = fixture(ruleById("E02")), quarterly = fixture(ruleById("E01"));
  assert.notEqual(point("E02", monthly), null);
  assert.equal(point("E02", { ...monthly, period: "2026-Q2", latestAvailablePeriod: "2026-Q2" }), null);
  assert.equal(point("E01", { ...quarterly, period: "2026-08", latestAvailablePeriod: "2026-08" }), null);
  assert.equal(point("E02", { ...monthly, releaseDate: "2026-08-30" }), null);
  assert.equal(point("E01", { ...quarterly, releaseDate: "2026-06-29" }), null);
  assert.equal(point("E02", monthly, "2026-09-14"), null);
  assert.equal(point("E02", { ...monthly, verifiedAt: "2026-12-01" }, "2026-12-01"), null);
  assert.equal(point("E01", { ...quarterly, verifiedAt: "2027-01-01" }, "2027-01-01"), null);
  assert.notEqual(point("E02", { ...monthly, verifiedAt: "2026-11-30" }, "2026-11-30"), null);
  assert.equal(scoreIndicator(ruleById("E02"), { ...monthly, verifiedAt: "2026-10-01" }, cutoff, { monthlyMaxAgeMonths: 1 }), null);
});

test("traceable Wind/Caixin are accepted only with fallback order, original publisher, code and cutoff availability", () => {
  const rule = ruleById("E02");
  for (const provider of ["Wind", "财新"]) {
    const observation = { ...fixture(rule), sourceUrl: "https://vendor.example/test-synthetic-only",
      sourceAudit: { provider, originalPublisher: rule.originalPublisher, seriesCode: "SYNTHETIC",
        officialFallbackReason: "已查官方原表但所需历史不可取", crossCheckNote: "与官方重叠期核验；纯测试",
        ...(provider === "财新" ? { windFallbackReason: "官方、Wind均不满足历史序列；纯测试" } : {}),
        availableDate: "2026-09-15" } };
    assert.notEqual(point("E02", observation), null);
    for (const patch of [{ seriesCode: "" }, { originalPublisher: "不明" }, { officialFallbackReason: "" },
      { crossCheckNote: "" }, { availableDate: "2026-10-02" }, { availableDate: "2026-09-01" }]) {
      assert.equal(point("E02", { ...observation, sourceAudit: { ...observation.sourceAudit, ...patch } }), null);
    }
    if (provider === "财新") assert.equal(point("E02", { ...observation,
      sourceAudit: { ...observation.sourceAudit, windFallbackReason: "" } }), null);
  }
});

test("new private-investment/goods-retail identity and current inclusive infrastructure scope cannot be swapped", () => {
  for (const id of ["G16", "G17"]) {
    assert.ok(ruleById(id).componentSeries);
    const observation = fixture(ruleById(id));
    assert.notEqual(point(id, observation), null);
    assert.equal(point(id, { ...observation, series: id === "G16" ? "privateInvestmentTotal" : "retailSalesTotal" }), null);
    assert.equal(point(id, { ...observation, series: undefined }), null);
  }
  const infrastructure = fixture(ruleById("G13"));
  assert.notEqual(point("G13", infrastructure), null);
  assert.equal(point("G13", { ...infrastructure, investmentScope: "不含电热气水" }), null);
});

test("combined January-February releases are accepted only as combined periods, never invented January", () => {
  for (const id of ["G01", "G17", "P01E", "P01F"]) {
    const observation = { ...fixture(ruleById(id)), period: "2026-02", latestAvailablePeriod: "2026-02",
      releaseDate: "2026-03-20", verifiedAt: "2026-04-01", periodScope: "1—2月合并" };
    if (observation.fiscalExpenditure) observation.fiscalExpenditure = { ...observation.fiscalExpenditure,
      period: "2026-02", releaseDate: "2026-03-20" };
    assert.notEqual(point(id, observation, "2026-04-01"), null, id);
    assert.equal(point(id, { ...observation, periodScope: undefined }, "2026-04-01"), null, id);
    const january = { ...observation, period: "2026-01", latestAvailablePeriod: "2026-01" };
    if (january.fiscalExpenditure) january.fiscalExpenditure = { ...january.fiscalExpenditure, period: "2026-01" };
    assert.equal(point(id, january, "2026-04-01"), null, id);
  }
});

test("PMI requires three consecutive months of exactly the intended seasonally-adjusted component", () => {
  for (const id of ["E08", "E09", "G11"]) {
    const observation = fixture(ruleById(id));
    assert.notEqual(point(id, observation), null);
    for (const patch of [{ series: "compositePMI" }, { basis: "未季调指数" }, { unit: "%" }, { period: "2026-05" }]) {
      const wrong = clone(observation); Object.assign(wrong.components[1], patch);
      assert.equal(point(id, wrong), null);
    }
    assert.equal(point(id, { ...observation, components: observation.components.slice(1) }), null);
    assert.equal(point(id, { ...observation, value: 51 }), null);
  }
});

test("canonical recalculation, not one-decimal display rounding, controls both sides of a PMI cutoff", () => {
  const observation = fixture(ruleById("E08"));
  const below = clone(observation);
  below.value = 50;
  below.components.forEach((part, index) => { part.value = [49.9, 50, 50][index]; });
  assert.equal(point("E08", below), 2); // Mean 49.966667, not display 50.0.
  assert.equal(point("E08", { ...below, value: 49.9667 }), 2);
  const above = clone(observation);
  above.value = 49.99;
  above.components.forEach((part, index) => { part.value = [50, 50, 50.03][index]; });
  assert.equal(point("E08", above), 3); // Mean 50.01 despite lower typed value.
  const exact = fixture(ruleById("E08"));
  assert.equal(point("E08", exact), 3);
});

test("70-city derived housing requires complete consistent city sets and verifies the original monthly medians", () => {
  const observation = fixture(ruleById("G15"));
  assert.equal(point("G15", observation), 2);
  for (const mutate of [
    (value) => value.components.pop(),
    (value) => { value.components[1].period = "2026-05"; },
    (value) => value.components[1].cities.pop(),
    (value) => { value.components[1].cities[0] = null; },
    (value) => { value.components[1].cities[69] = value.components[1].cities[0]; },
    (value) => { value.components[1].value = -.1; },
    (value) => { value.components[1].basis = "新房价格"; },
  ]) {
    const wrong = clone(observation); mutate(wrong); assert.equal(point("G15", wrong), null);
  }
});

test("official house-price original tables reproduce the existing value without invented missing months", () => {
  const monthly = prices.monthly.filter((item) => item.period >= "2026-06" && item.period <= "2026-08");
  assert.deepEqual(monthly.map((item) => item.period), ["2026-06", "2026-07", "2026-08"]);
  const last = monthly.at(-1), rule = ruleById("G15");
  const observation = { ...base(rule, last.threeMonthMeanPct), sourceUrl: last.sourceUrl, releaseDate: last.releaseDate,
    components: monthly.map((item) => ({ value: item.medianMomPct, period: item.period, releaseDate: item.releaseDate,
      sourceUrl: item.sourceUrl, cities: item.cities, unit: "%", basis: "70城二手住宅环比中位数" })) };
  assert.equal(point("G15", observation), 2);
});

test("loan year-on-year extra flows use billions in the same department and zero extra receives three", () => {
  for (const id of ["F01", "F02"]) {
    const observation = fixture(ruleById(id));
    assert.equal(point(id, observation), 3);
    for (const patch of [{ basis: "年初累计" }, { unit: "万亿元" }, { series: "householdShort" }, { period: "2025-05" }]) {
      const wrong = clone(observation); Object.assign(wrong.components[0], patch); assert.equal(point(id, wrong), null);
    }
    assert.equal(point(id, { ...observation, components: observation.components.slice(1) }), null);
    assert.equal(point(id, { ...observation, value: 3000 }), null);
  }
});

test("ex-government TSF validates total/government original stocks, dates, units and computed growth/momentum", () => {
  const row = (period) => {
    const item = creditAudit.stockRows.find((entry) => entry.period === period);
    return { ...item, value: +(item.totalStock - item.governmentBondStock).toFixed(2), unit: "万亿元", basis: "同口径月末存量" };
  };
  for (const id of ["F07", "F08"]) {
    const rule = ruleById(id);
    const components = (id === "F07" ? ["2025-08", "2026-08"] : ["2025-05", "2026-05", "2025-08", "2026-08"]).map(row);
    const observation = { ...base(rule, id === "F07" ? creditAudit.derived[1].exGovernmentStockYoyPct : creditAudit.derived[1].threeMonthChangePp),
      releaseDate: components.at(-1).releaseDate, sourceUrl: components.at(-1).sourceUrl, components };
    assert.equal(point(id, observation), 3);
    const wrong = clone(observation); wrong.components.at(-1).governmentBondStock = 0;
    assert.equal(point(id, wrong), null);
    assert.equal(point(id, { ...observation, value: 10 }), null);
    const units = clone(observation); units.components[0].unit = "亿元";
    assert.equal(point(id, units), null);
  }
});

test("M1-minus-M2 requires the new definition, same observed month and excludes unreleased 2024 backcasts", () => {
  const observation = fixture(ruleById("F05"));
  assert.equal(point("F05", observation), 3);
  for (const patch of [{ series: "m1Old" }, { period: "2026-07" }, { basis: "旧口径同比" }, { unit: "亿元" }]) {
    const wrong = clone(observation); Object.assign(wrong.components[0], patch); assert.equal(point("F05", wrong), null);
  }
  const historical = clone(observation);
  Object.assign(historical, { period: "2024-08", latestAvailablePeriod: "2024-08", verifiedAt: "2024-10-01", releaseDate: "2024-09-15" });
  historical.components.forEach((part) => { part.period = "2024-08"; part.releaseDate = "2024-09-15"; });
  assert.equal(point("F05", historical, "2024-10-01"), null);
});

test("capacity utilization uses same-quarter original percentages, not PMI levels or cumulative utilization", () => {
  const observation = fixture(ruleById("G18"));
  assert.equal(point("G18", observation), 3);
  for (const patch of [{ unit: "百分点" }, { basis: "年初累计利用率" }, { series: "manufacturingPMI" }, { period: "2025-Q1" }, { value: 101 }]) {
    const wrong = clone(observation); Object.assign(wrong.components[0], patch); assert.equal(point("G18", wrong), null);
  }
});

test("GDP deflator needs same-quarter nominal levels plus real single-quarter growth from one revision vintage", () => {
  const observation = deflatorFixture(ruleById("E07"));
  assert.equal(point("E07", observation), 4);
  assert.equal(point("E07", { ...observation, gdpDeflatorEvidence: undefined }), null);
  for (const [key, patch] of [["priorNominal", { revisionVersion: "old-vintage" }],
    ["priorNominal", { period: "2025-Q1" }], ["currentNominal", { unit: "万亿元" }],
    ["realGrowth", { basis: "累计实际同比" }], ["realGrowth", { value: -100 }]]) {
    const wrong = clone(observation); Object.assign(wrong.gdpDeflatorEvidence[key], patch); assert.equal(point("E07", wrong), null);
  }
  assert.equal(point("E07", { ...observation, value: observation.value + .1 }), null);
});

test("fiscal comparable cumulative growth adopts reported growth, not incompatible published amount division", () => {
  for (const id of ["P01E", "P01F"]) {
    const observation = fiscalFixture(ruleById(id));
    assert.equal(point(id, observation), 4);
    assert.equal(point(id, { ...observation, fiscalExpenditure: { ...observation.fiscalExpenditure, cumulativeExpenditure: 99999 } }), 4);
    for (const patch of [{ scope: "某省" }, { basis: "预算执行进度" }, { unit: "%" },
      { comparabilityNote: "" }, { reportedYoyPct: undefined }, { series: "wrong-family" }]) {
      assert.equal(point(id, { ...observation, fiscalExpenditure: { ...observation.fiscalExpenditure, ...patch } }), null);
    }
  }
});

test("archived fiscal-resource rules retain their original validation after leaving active scoring", async () => {
  const history = JSON.parse(await readFile(new URL("../deliverables/macro-rating-history-before-v1-14-2026-10-11.json", import.meta.url), "utf8"));
  const archivedRule = history.snapshots.find((record) => record.version === "V1.11").framework.indicators.find((rule) => rule.id === "P01A");
  assert.ok(archivedRule);
  assert.equal(ruleById("P01A"), undefined);
  const archivedPoint = (observation) => scoreIndicator(archivedRule, observation, cutoff, framework.freshness);
  const observation = resourceFixture(archivedRule);
  assert.equal(archivedPoint(observation), 5);
  for (const mutate of [
    (value) => value.components[1].items.push(clone(value.components[1].items[0])),
    (value) => { value.components[1].items[0] = null; },
    (value) => { value.components[1].items[0].purpose = "债务置换"; },
    (value) => { value.components[1].items[0].approvalDate = "2026-10-02"; },
    (value) => { value.components[1].gdp.revisionVersion = "other-version"; },
    (value) => { value.components[1].gdp.year = 2024; },
    (value) => { value.components[1].budgetStage = "执行调整非批准"; },
    (value) => { value.components[1].noDoubleCounting = ""; },
  ]) {
    const wrong = clone(observation); mutate(wrong); assert.equal(archivedPoint(wrong), null);
  }
  assert.equal(archivedPoint({ ...observation, reviewDate: "2026-08-31" }), null);
  assert.equal(archivedPoint({ ...observation, value: 2 }), null);
  assert.equal(archivedPoint({ ...observation, period: "2026-08", latestAvailablePeriod: "2026-08" }), null);
});

test("policy rate snapshots permit early-month announcements and unchanged rates/zero BP get three", () => {
  for (const id of ["P02A"]) {
    const observation = rateFixture(ruleById(id));
    assert.equal(point(id, observation), id === "P02A" ? 5 : 4);
    const unchanged = clone(observation); unchanged.value = 0; unchanged.components[1].value = unchanged.components[0].value;
    assert.equal(point(id, unchanged), 3);
    const late = clone(observation); late.components[1].effectiveDate = "2026-09-01";
    assert.equal(point(id, late), null);
    const missingHistory = clone(observation); missingHistory.components[0].releaseDate = "2026-03-01";
    assert.equal(point(id, missingHistory), null);
    const badUnit = clone(observation); badUnit.components[0].unit = "基点";
    assert.equal(point(id, badUnit), null);
  }
});

test("RRR actions require 12 complete months and cross-checks; zero is a verified neutral score", () => {
  assert.equal(ruleById("P02B"), undefined);
  assert.equal(ruleById("P02E").weight, .01);
  assert.equal(point("P02E"), 3);
  for (const mutate of [
    (v) => v.rrrActionLedger.monthlyChecks.pop(),
    (v) => { v.rrrActionLedger.monthlyChecks[1].period = "2025-09"; },
    (v) => { v.rrrActionLedger.windowStart = "2025-08-01"; },
    (v) => { v.rrrActionLedger.windowEnd = "2026-08-30"; },
    (v) => { v.rrrActionLedger.monthlyChecks[0].tableComplete = false; },
    (v) => { v.rrrActionLedger.monthlyChecks[0].policyReviewComplete = false; },
    (v) => { v.rrrActionLedger.monthlyChecks[0].injection = 1000; },
    (v) => { v.rrrActionLedger.monthlyChecks[0].sourceUrl = "https://media.example/claim"; },
    (v) => { v.rrrActionLedger.monthlyChecks[0].releaseDate = "2026-10-02"; },
    (v) => { v.rrrActionLedger.monthlyChecks[1].sourceUrl = v.rrrActionLedger.monthlyChecks[0].sourceUrl; },
    (v) => { v.rrrActionLedger.crossChecks = []; },
    (v) => { v.rrrActionLedger.crossChecks[1].coverageStart = "2026-02-01"; },
    (v) => { v.rrrActionLedger.crossChecks[1].type = "媒体解读"; },
    (v) => { delete v.rrrActionLedger.crossChecks[1].reviewedSources; },
    (v) => { v.rrrActionLedger.crossChecks[1].reviewedSources[1].releaseDate = "2026-10-02"; },
    (v) => { v.value = -50; },
  ]) { const wrong = rrrFixture(ruleById("P02E")); mutate(wrong); assert.equal(point("P02E", wrong), null); }
});

test("RRR event units, effective dates and substance are verified, not mixed with targeted or FX actions", () => {
  const cut = rrrFixture(ruleById("P02E"), -50);
  assert.equal(point("P02E", cut), 4);
  for (const mutate of [
    (v) => { v.rrrActionLedger.adjustmentEvents[0].effectiveDate = "2025-08-31"; },
    (v) => { v.rrrActionLedger.adjustmentEvents[0].effectiveDate = "2026-09-01"; },
    (v) => { v.rrrActionLedger.adjustmentEvents[0].executed = false; },
    (v) => { v.rrrActionLedger.adjustmentEvents[0].unit = "%"; },
    (v) => { v.rrrActionLedger.adjustmentEvents[0].rawChange.value = -.05; },
    (v) => { v.rrrActionLedger.adjustmentEvents[0].scopeType = "未知"; },
    (v) => { v.rrrActionLedger.monthlyChecks[11].injection = "-"; v.rrrActionLedger.monthlyChecks[11].netInjection = "-"; },
    (v) => { v.rrrActionLedger.adjustmentEvents.push(clone(v.rrrActionLedger.adjustmentEvents[0])); },
    (v) => { const extra = clone(v.rrrActionLedger.adjustmentEvents[0]); extra.eventId += "-duplicate"; v.rrrActionLedger.adjustmentEvents.push(extra); v.value = -100; },
  ]) { const wrong = clone(cut); mutate(wrong); assert.equal(point("P02E", wrong), null); }
  for (const [scopeType, currency] of [["定向", "人民币"], ["行业专属", "人民币"], ["普遍", "外币"]]) {
    const excluded = clone(cut); excluded.value = 0;
    Object.assign(excluded.rrrActionLedger.adjustmentEvents[0], { scopeType, currency });
    assert.equal(point("P02E", excluded), 3);
  }
  assert.equal(point("P02E", cut, "2027-01-01"), null);
});

test("quarterly enterprise rates retain authentic quarter-end monthly originals, not rolling quarterly averages", () => {
  const observation = rateFixture(ruleById("P02D"));
  assert.equal(point("P02D", observation), 4);
  const wrong = clone(observation); wrong.period = "2026-08"; wrong.latestAvailablePeriod = wrong.period;
  wrong.components.forEach((part) => { part.period = part.period.replace("-06", "-08"); });
  assert.equal(point("P02D", wrong), null);
  const average = clone(observation); average.components[1].basis = "季度均值";
  assert.equal(point("P02D", average), null);
  const acceptedVariant = { ...ruleById("P02D"), frequency: "季度（季末月原值）" };
  assert.equal(scoreIndicator(acceptedVariant, observation, cutoff), 4);
});

test("leverage requires a current and year-prior department plus denominator, income, debt-service and counter-evidence", () => {
  for (const id of ["F09", "F10"]) {
    const observation = leverageFixture(ruleById(id));
    assert.equal(point(id, observation), 3);
    assert.equal(point(id, { ...observation, leverageReview: undefined }), null);
    assert.equal(point(id, { ...observation, leverageRatio: 59 }), null);
    assert.equal(point(id, { ...observation, rationale: "" }), null);
    for (const key of ["nominalGdpEffect", "incomeOrProfit", "debtService", "counterEvidence"]) {
      const wrong = clone(observation); wrong.leverageReview[key].evidence = [];
      assert.equal(point(id, wrong), null);
    }
    const wrong = clone(observation); wrong.leverageComponents[0].series = "governmentLeverage";
    assert.equal(point(id, wrong), null);
    const stale = clone(observation); stale.leverageReview.reviewDate = "2026-07-01";
    assert.equal(point(id, stale), null);
    const unsupported = clone(observation); unsupported.leverageReview.debtService.evidence[0].finding = "";
    assert.equal(point(id, unsupported), null);
  }
});

test("industrial-profit scoring has an evidence gate, not an invented automatic grade haircut", () => {
  const observation = fixture(ruleById("G02"));
  observation.value = 20;
  assert.equal(point("G02", observation), 5);
  assert.equal(point("G02", { ...observation, profitQuality: undefined }), null);
  for (const patch of [{ sameScope: false }, { limitations: "" }, { comparabilityNote: "" }]) {
    assert.equal(point("G02", { ...observation, profitQuality: { ...observation.profitQuality, ...patch } }), null);
  }
  const wrong = clone(observation); wrong.profitQuality.profitMargin.scope = "仅上市公司";
  assert.equal(point("G02", wrong), null);
  const missing = clone(observation); missing.profitQuality.counterEvidence.evidence = [];
  assert.equal(point("G02", missing), null);
});

test("policy high scores need active conditions, explicit counterarguments and execution evidence of matching scope", () => {
  for (const id of ["P03A", "P03B", "P04A", "P04B"]) {
    const rule = ruleById(id), four = policyFixture(rule), five = policyFixture(rule, 5);
    assert.equal(point(id, four), 4);
    assert.equal(point(id, five), 5);
    for (const patch of [{ counterEvidence: "" }, { noDoubleCounting: "" }, { direction: "恶化" }, { responsibleAgency: "" }]) {
      assert.equal(point(id, { ...four, policyReview: { ...four.policyReview, ...patch } }), null);
    }
    for (const patch of [{ status: "已失效" }, { effectiveDate: "2026-10-02" }, { eventId: "" },
      { mechanism: "" }, { expiresOn: "2026-07-01" }, { sourceUrl: "https://gov.cn.example.com/spoof" }]) {
      const wrong = clone(four); Object.assign(wrong.policyReview.evidence[0], patch); assert.equal(point(id, wrong), null);
    }
    assert.equal(point(id, { ...four, value: 5 }), null);
    const local = clone(five); local.policyReview.evidence[1].scope = "局部试点";
    assert.equal(point(id, local), null);
    const present = clone(four); present.period = "2026-10"; present.latestAvailablePeriod = present.period;
    present.policyReview.reviewDate = cutoff;
    assert.equal(point(id, present), 4); // No new document is not automatic neutrality.
  }
});
