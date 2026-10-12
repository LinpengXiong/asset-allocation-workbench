import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as summary from "../lib/macro-rating-summary.mjs";
import * as profitBreadth from "../lib/macro-profit-breadth.mjs";
import { continuousScoreDetails } from "../lib/macro-scoring-continuous.mjs";
import { scoreIndicator as actualScoreIndicator } from "../lib/macro-rating.mjs";

// Render the real TSX. Deterministic engine fixtures isolate presentation from
// concurrent framework/data revisions and never write synthetic production data.
const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/components/MacroRatingV1.tsx", import.meta.url), "utf8");
const actualFramework = JSON.parse(await readFile(new URL("../app/data/macro-rating-v1.json", import.meta.url), "utf8"));
const actualCurrent = JSON.parse(await readFile(new URL("../app/data/macro-rating-current.json", import.meta.url), "utf8"));
const breadthInput = JSON.parse(await readFile(new URL("../deliverables/macro-v1-18-profit-breadth-input.json", import.meta.url), "utf8")).input;
const compiled = ts.transpileModule(source, {
  fileName: "MacroRatingV1.tsx",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.filter((entry) => entry.category === ts.DiagnosticCategory.Error).length ?? 0, 0);

function loadUi({ empty = false, points = 2.625, pointsById = {}, componentDetailsById = {}, frameworkUpdate, currentUpdate, historyUpdate, resultUpdate, researchUpdate, assessments = {} } = {}) {
  const framework = structuredClone(actualFramework);
  const current = structuredClone(actualCurrent);
  for (const rule of framework.indicators) {
    current.observations[rule.id] = empty ? null : {
      ...current.observations[rule.id], value: 1.25, period: "2026-09", releaseDate: "2026-09-30", verifiedAt: "2026-10-11", verified: true,
      sourceUrl: "https://www.stats.gov.cn/", unit: rule.unit,
    };
  }
  frameworkUpdate?.(framework);
  currentUpdate?.(current);
  const pillarScores = { 经济运行: 2.5, 增长动力: 3, 金融信贷: 4, 宏观调控: 4 };
  const formalScore = Object.entries(framework.pillars).reduce((sum, [name, weight]) => sum + weight * pillarScores[name], 0);
  const result = {
    status: empty ? "资料不足" : "正式", coverage: empty ? 0 : 1, formalScore: empty ? null : formalScore, grade: "III档 条件中性",
    pillars: Object.entries(framework.pillars).map(([name, weight]) => {
      const count = framework.indicators.filter((entry) => entry.pillar === name).length;
      return { name, weight, count, verifiedCount: empty ? 0 : count, verifiedWeight: empty ? 0 : weight, coverage: empty ? 0 : 1, observedScore: empty ? null : pillarScores[name], contribution: empty ? 0 : weight * pillarScores[name] };
    }),
  };
  resultUpdate?.(result, framework, current);
  const research = { count: 0, countTotal: empty ? 0 : framework.indicators.length, coverage: result.coverage, score: result.formalScore, pillars: result.pillars.map((entry) => ({ name: entry.name, score: entry.observedScore, researchCount: 0 })) };
  researchUpdate?.(research, result, framework, current);
  const history = { snapshots: [{ type: "正式评级", period: "本期测试", asOf: current.asOf, version: framework.version, economic: 2.5, growth: 3, credit: 4, policy: 4, score: formalScore, grade: result.grade, coverage: 1, evidence: "原始证据", validation: "独立估值", research, rows: [{ id: framework.indicators[0].id, name: "证据快照测试", weight: .09, points, gap: null, observation: current.observations[framework.indicators[0].id] }] }] };
  historyUpdate?.(history, framework, current);
  const module = { exports: {} };
  runInNewContext(compiled.outputText, {
    module, exports: module.exports, console,
    require(specifier) {
      if (specifier === "../data/macro-rating-v1.json") return framework;
      if (specifier === "../data/macro-rating-current.json") return current;
      if (specifier === "../data/macro-rating-history.json") return history;
      if (specifier === "../../lib/macro-rating.mjs") return { evaluateMacroRating: () => result, scoreIndicator: (rule, observation) => observation ? Object.hasOwn(pointsById, rule.id) ? pointsById[rule.id] : points : null };
      if (specifier === "../../lib/macro-rating-research.mjs") return { evaluateMacroResearchRating: () => ({ research }), resolveMacroAssessment: (_framework, _current, rule) => ({ assessment: assessments[rule.id] ?? null }) };
      if (specifier === "../../lib/macro-rating-summary.mjs") return summary;
      if (specifier === "../../lib/macro-profit-breadth.mjs") return profitBreadth;
      if (specifier === "../../lib/macro-scoring-continuous.mjs") return { continuousScoreDetails: (rule, observation, asOf) => Object.hasOwn(componentDetailsById, rule.id) ? componentDetailsById[rule.id] : continuousScoreDetails(rule, observation, asOf) };
      return require(specifier);
    },
  });
  return { ...module.exports, framework, current, history, result, research };
}
const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));
const grades = ["OLD DISCRETE ONE", "OLD DISCRETE TWO", "OLD DISCRETE THREE", "OLD DISCRETE FOUR", "OLD DISCRETE FIVE"];
const baseRule = { id: "TEST", name: "测试评分指标", unit: "%", mode: "高优", grades };
const record = (metric, value, unit = "%") => ({ metric, value, unit, period: "2026-Q2", basis: "同源同口径原值", sourceUrl: "https://www.bis.org/statistics/", releaseDate: "2026-09-21", verifiedAt: "2026-10-11", originalPublisher: "原始发布机构" });
const displayWeight = (weight) => `${Number((weight * 100).toFixed(2))}%`;
const standaloneBreadth = () => {
  const observation = { ...structuredClone(breadthInput), indicatorId: "G19" };
  delete observation.key;
  return observation;
};
function splitProfitFramework(framework) {
  framework.version = "TEST-SPLIT";
  framework.pillars = { 经济运行: .25, 增长动力: .4, 金融信贷: .2, 宏观调控: .15 };
  const profit = framework.indicators.find((item) => item.id === "G02");
  delete profit.displayComponents; // This fixture represents the already released V1.19 layout.
  profit.name = "规模以上工业企业盈利增长与质量";
  profit.weight = .04;
  profit.scoring.components = profit.scoring.components.filter((part) => part.key !== "industryProfitImprovementBreadth");
  profit.scoring.components.forEach((part, index) => { part.weight = [.5, .25, .125, .125][index]; });
  profit.scoring.description = "累计利润50%、当月利润25%、利润率变化12.5%、回款变化12.5%；不含行业广度。";
  framework.indicators = framework.indicators.filter((item) => item.id !== "G19");
  framework.indicators.push({ ...structuredClone(profit), id: "G19", name: "规模以上工业企业行业利润改善广度", weight: .04,
    measurementBasis: profitBreadth.PROFIT_BREADTH_BASIS, definition: "固定41行业改善广度，独立计分，不重复计入盈利增长与质量。",
    scoring: { method: "piecewise-linear", anchors: [[0, 1], [25, 2], [50, 3], [75, 4], [100, 5]], description: "广度=(改善+0.5×持平)/41×100%，下降不等于亏损。" },
    calibration: null });
  for (const [name, weight] of Object.entries(framework.pillars)) {
    const adjustable = framework.indicators.filter((item) => item.pillar === name && !["G02", "G19"].includes(item.id));
    const prior = adjustable.reduce((sum, item) => sum + item.weight, 0);
    const target = name === "增长动力" ? weight - .08 : weight;
    adjustable.forEach((item) => { item.weight *= target / prior; });
  }
}
function splitProfitCurrent(current) {
  current.version = "TEST-SPLIT";
  current.observations.G02 = structuredClone(actualCurrent.observations.G02);
  delete current.observations.G02.scoringInputs.industryProfitImprovementBreadth;
  current.observations.G19 = standaloneBreadth();
}

test("computed scores use two decimals with null and nonfinite values kept empty", () => {
  const ui = loadUi();
  assert.equal(ui.formatScore(4), "4.00");
  assert.equal(ui.formatScore(2.625), "2.63");
  assert.equal(ui.formatScore(2.675), "2.68");
  for (const value of [null, NaN, Infinity, undefined]) assert.equal(ui.formatScore(value), "—");
});

test("continuous standards render actual anchors and interpolation, never legacy grade text", () => {
  const ui = loadUi();
  const html = render(ui.MacroRuleScoring, { item: { ...baseRule, scoring: { method: "piecewise-linear", anchors: [[-25, 1], [-10, 2], [0, 3], [10, 4], [25, 5]], description: "独立试行锚点，不是回测最优" } }, observation: { value: -17 } });
  assert.match(html, /连续评分标准/);
  assert.match(html, /逐段线性插值/);
  assert.match(html, /对应分量得分/);
  assert.match(html, /1\.00 分/);
  assert.match(html, /5\.00 分/);
  assert.match(html, /<td>-25<\/td>/);
  assert.match(html, /<td>25<\/td>/);
  assert.match(html, /<svg[^>]+role="img"/);
  assert.match(html, /超出首尾锚点沿用相邻端点得分/);
  assert.doesNotMatch(html, /OLD DISCRETE|五档评分标准：/);
});

test("calibration explanations distinguish diagnostics from economic false alarms and show short-sample limits", () => {
  const ui = loadUi({ frameworkUpdate(framework) {
    framework.calibrationReview = { reviewedCount: 37, adjustedCount: 6, retainedCount: 31, method: "当前修订历史诊断，不是当时可得数据回测" };
    framework.indicators[0].calibration = { decision: "保留", reason: "可比历史不足，不为降低当前总分收窄", sampleSummary: "四期原始数据",
      comparisons: [{ label: "适度收窄", summary: "没有足够样本，不给出验证结论。" }], limitations: ["无法据此判断真实经济预警误报率"] };
  } });
  const html = render(ui.MacroRatingIndicators, { selectedRuleId: ui.framework.indicators[0].id });
  assert.match(html, /尺度复核 37 项 · 调整 6 项 · 保留 31 项/);
  assert.match(html, /可比历史不足，不为降低当前总分收窄/);
  assert.match(html, /四期原始数据/);
  assert.match(html, /同样本下的评分尺度对比（不是投资收益或经济误报率）/);
  assert.match(html, /信息截止日和原值不因校准改变/);
});

test("composite rules render fixed component weights, units, raw evidence and formulas", () => {
  const ui = loadUi();
  const item = { ...baseRule, scoring: { method: "weighted-components", description: "固定分量，不缺项重分权", components: [
    { key: "level", label: "景气水平", weight: .7, unit: "指数点", basis: "最近三个月均值", anchors: [[48, 1], [50, 3], [52, 5]] },
    { key: "momentum", label: "景气变化", weight: .3, unit: "指数点", basis: "前后不重叠三个月之差", anchors: [[-2, 1], [0, 3], [2, 5]] },
  ] } };
  const html = render(ui.MacroRuleScoring, { item, observation: { value: 999, scoringInputs: {
    level: { ...record("景气水平原值", 49.7, "指数点"), rawEvidence: { formula: "三个月原值算术平均", components: [record("七月原值", 49.2, "指数点")] } },
    momentum: record("景气变化原值", -.5, "指数点"),
  } } });
  assert.match(html, /景气水平 · 固定项内权重 70%/);
  assert.match(html, /景气变化 · 固定项内权重 30%/);
  assert.match(html, /49\.7指数点/);
  assert.match(html, /-0\.5指数点/);
  assert.match(html, /最近三个月均值/);
  assert.match(html, /三个月原值算术平均/);
  assert.match(html, /七月原值/);
  assert.match(html, /原始来源/);
  assert.match(html, /不自动重分权或补分/);
  assert.doesNotMatch(html, /999|OLD DISCRETE|scoringInputs|momentum|rawEvidence/);
  assert.match(html, /下方参照点对应各分量得分，不是综合单项分/);
  const missing = render(ui.MacroRuleScoring, { item, observation: { value: 999, scoringInputs: { level: record("水平", 49.7, "指数点") } } });
  assert.match(missing, /尚无可展示的原始证据；不据此补分/);
  assert.doesNotMatch(missing, /999/);
});

test("composite primary inputs use their specified observation, without inventing missing derived inputs", () => {
  const ui = loadUi();
  const item = { ...baseRule, scoring: { method: "weighted-components", components: [
    { key: "level", label: "实际增长水平", weight: .7, unit: "%", basis: "单季实际同比", input: "observation.value", anchors: [[3, 1], [5, 3], [7, 5]] },
    { key: "change", label: "增长变化", weight: .3, unit: "百分点", basis: "前后季度之差", input: "observation.scoringInputs.change", anchors: [[-1, 1], [0, 3], [1, 5]] },
  ] } };
  const observation = { ...record("本期增长原值", 4.3), scoringInputs: { change: { ...record("季度同比增速变动", -.7, "百分点"), rawEvidence: { formula: "current.value - preceding.value", current: record("本季原始实际同比", 4.3), preceding: record("前季原始实际同比", 5) } } } };
  const html = render(ui.MacroRuleScoring, { item, observation });
  assert.match(html, /本期增长原值：<\/strong>4\.3%/);
  assert.match(html, /本季原始实际同比：<\/strong>4\.3%/);
  assert.match(html, /前季原始实际同比：<\/strong>5%/);
  assert.match(html, /本季单季实际同比 − 前季单季实际同比/);
  assert.doesNotMatch(html, /尚无可展示|current\.value|preceding\.value|scoringInputs/);
  const missing = render(ui.MacroRuleScoring, { item, observation: record("本期增长原值", 4.3) });
  assert.match(missing, /本期增长原值：<\/strong>4\.3%/);
  assert.match(missing, /增长变化本期原值：<\/strong>尚无可展示的原始证据/);
  assert.doesNotMatch(missing, /增长变化本期原值：<\/strong>4\.3%/);
  const unsupported = structuredClone(item);
  unsupported.scoring.components[0].input = "unrecognized.path";
  const unsupportedHtml = render(ui.MacroRuleScoring, { item: unsupported, observation });
  assert.match(unsupportedHtml, /实际增长水平本期原值：<\/strong>尚无可展示的原始证据/);
});

test("profit details show reported growth, original margin and collection days without schema keys", () => {
  const ui = loadUi();
  const keys = ["cumulative", "single", "margin", "collection"];
  const item = { ...baseRule, scoring: { method: "weighted-components", components: keys.map((key, index) => ({ key, label: ["累计利润", "单月利润", "利润率变化", "回款变化"][index], input: index === 0 ? "observation.value" : `observation.scoringInputs.${key}`, weight: .25, anchors: [[-1, 1], [1, 5]] })) } };
  const observation = { ...record("累计利润原值", 15.7), scoringInputs: {
    cumulative: { ...record("累计利润", 15.7), rawEvidence: { reportedYoyPct: 15.7, aggregation: "1—8月累计", notDerivedFromPublishedAmounts: true } },
    single: { ...record("当月利润", 4.2), rawEvidence: { reportedYoyPct: 4.2, aggregation: "8月单月", notDerivedFromPublishedAmounts: true } },
    margin: { ...record("利润率变动", .44, "百分点"), rawEvidence: { currentProfitMargin: 5.66, unit: "%", reportedYoyChange: .44, reportedChangeUnit: "百分点", comparability: "不使用不同报告范围作差" } },
    collection: { ...record("回款变动", .9, "天"), rawEvidence: { currentReceivablesDays: 72.2, unit: "天", reportedYoyChange: .9, reportedChangeUnit: "天", comparability: "原文直接公布变动" } },
  } };
  const html = render(ui.MacroRuleScoring, { item, observation });
  for (const expected of [/可比同比：15\.7%/, /可比同比：4\.2%/, /当期营业收入利润率：5\.66%/, /当期应收账款平均回收期：72\.2天/, /同比变动：0\.44百分点/, /同比变动：0\.9天/, /1—8月累计/, /8月单月/, /不使用不同报告范围作差/, /原文直接公布变动/]) assert.match(html, expected);
  assert.doesNotMatch(html, /reportedYoyPct|currentProfitMargin|currentReceivablesDays|scoringInputs|rawEvidence/);
});

test("unknown methods and malformed curves do not silently fall back to integer grades", () => {
  const ui = loadUi();
  for (const scoring of [
    { method: "unrecognized" },
    { method: "piecewise-linear", anchors: [[0, 3], [0, 5]] },
    { method: "piecewise-linear", anchors: [[0, 3], [1, 6]] },
    { method: "weighted-components", components: [{ key: "x", label: "分量", weight: .6, anchors: [[0, 1], [1, 5]] }] },
  ]) {
    const html = render(ui.MacroRuleScoring, { item: { ...baseRule, scoring }, observation: null });
    assert.match(html, /待核验/);
    assert.doesNotMatch(html, /OLD DISCRETE|五档评分标准：/);
  }
});

test("legacy numeric and policy judgment standards keep their five evidence grades", () => {
  const ui = loadUi();
  const numeric = render(ui.MacroRuleScoring, { item: baseRule, observation: null });
  assert.match(numeric, /五档评分标准/);
  assert.match(numeric, /沿用五档离散规则/);
  assert.match(numeric, /OLD DISCRETE ONE/);
  assert.match(numeric, /1\.00 分/);
  const qualitative = render(ui.MacroRuleScoring, { item: { ...baseRule, mode: "原文研判" }, observation: { value: 4 } });
  assert.match(qualitative, /选择整数档位/);
  assert.match(qualitative, /不由文件数量/);
  assert.doesNotMatch(qualitative, /连续评分曲线/);
  const rubric = render(ui.MacroRuleScoring, { item: { ...baseRule, mode: "原文研判", scoring: { method: "evidence-rubric", step: 1, description: "实施条件与范围匹配执行证据" } }, observation: { value: 4 } });
  assert.match(rubric, /五档评分标准/);
  assert.match(rubric, /选择整数档位/);
  assert.match(rubric, /实施条件与范围匹配执行证据/);
  assert.match(rubric, /OLD DISCRETE FIVE/);
  assert.doesNotMatch(rubric, /评分方法待核验|连续评分曲线/);
});

test("leverage evidence matrices show domestic values, EM context, source links and proxy limitations", () => {
  const ui = loadUi();
  const matrix = {
    reviewDate: "2026-10-11", primaryReference: "BIS-emerging-ex-China", objective: "评价中长期融资约束", scoreReason: "收入提供缓冲，但资产需求承压",
    domestic: { current: record("本季居民杠杆率", 57.7), yearAgo: record("上年居民杠杆率", 61.1), quarterAgo: record("上季居民杠杆率", 59), debtGrowth: record("居民债务同比", -1.3), yearOnYearChangePp: -3.4, nominalGdpEffect: { summary: "分母扩大也促降比率", evidence: [record("同版名义GDP增长", 4.60418)] } },
    international: { china: record("BIS中国居民杠杆率", 57.5), benchmark: { n: 15, median: 25.715, percentile: 86.6666666667 }, limitations: ["不同收入组参照会改变相对位置，不是安全阈值"], peers: [record("巴西居民杠杆率", 35)], classification: record("同季新兴经济体分类", "正式分组", "") },
    incomeOrProfit: { evidence: [record("居民实际收入增长", 4.2)], limitations: ["不是债务人加权收入"] },
    servicing: { evidence: [record("新发放房贷利率", 3.05)], limitations: ["新贷利率不是存量还本付息"], sectorDsr: null, proxyOnly: true, directSectorData: false },
    pressure: { evidence: [record("住房贷款同比", -3.8)], limitations: ["减债不等于需求修复"] },
    counterEvidence: { positive: [record("收入增长缓冲", 5.2)], negative: [record("消费信贷缩减", -1.7)], limitations: ["不据此断言普遍违约"] },
  };
  const html = render(ui.MacroRuleScoring, { item: { ...baseRule, mode: "原文研判", scoring: { method: "evidence-matrix", step: .5, description: "预设证据条件可匹配半档" } }, observation: { value: 2.5, scoringMatrix: matrix } });
  for (const expected of [/本期杠杆约束证据矩阵/, /半档只能由固定证据状态触发/, /57\.7%/, /61\.1%/, /-3\.4个百分点/, /BIS同源同季新兴经济体（剔除中国）/, /中位数 25\.715%/, /收入或盈利承接/, /正反证据/, /没有同口径部门直接偿债率/, /原始来源/, /新贷利率不是存量还本付息/, /不据此断言普遍违约/]) assert.match(html, expected);
  assert.doesNotMatch(html, /scoringMatrix|primaryReference|proxyOnly|\[object Object\]/);
  const missing = render(ui.MacroRuleScoring, { item: { ...baseRule, mode: "原文研判", scoring: { method: "evidence-matrix", step: .5 } }, observation: null });
  assert.match(missing, /尚无完整矩阵/);
  const states = [{ score: 2.5, code: "partly-mitigated", label: "约束被部分缓冲", description: "联合约束与正收入反证同时满足" }];
  const withState = render(ui.MacroRuleScoring, { item: { ...baseRule, mode: "原文研判", scoring: { method: "evidence-matrix", step: .5, states, evidenceRequirements: ["同部门直接偿债证据才能支持高档"] } }, observation: { value: 2.5, scoringMatrix: { ...matrix, matchedState: "partly-mitigated", computedScore: 2.5 } } });
  for (const expected of [/预设证据状态与半档触发条件/, /2\.50 分 · 约束被部分缓冲/, /联合约束与正收入反证同时满足/, /匹配证据状态：约束被部分缓冲 · 2\.50 分/, /同部门直接偿债证据才能支持高档/]) assert.match(withState, expected);
  assert.doesNotMatch(withState, /partly-mitigated|matchedState/);
});

test("all real framework methods render and GDP/profit originals remain inspectable", () => {
  const ui = loadUi();
  assert.equal(new Set(actualFramework.indicators.map((rule) => rule.id)).size, actualFramework.indicators.length);
  assert.equal(actualFramework.indicators.length, actualFramework.calibrationReview.indicatorCount);
  const methods = actualFramework.indicators.reduce((counts, rule) => ({ ...counts, [rule.scoring.method]: (counts[rule.scoring.method] ?? 0) + 1 }), {});
  assert.deepEqual(Object.keys(methods).sort(), ["weighted-components", "piecewise-linear", "evidence-matrix", "evidence-rubric"].sort());
  assert.equal(methods["evidence-matrix"], 2);
  assert.equal(methods["evidence-rubric"], 4);
  assert.equal(Object.values(methods).reduce((sum, count) => sum + count, 0), actualFramework.indicators.length);
  for (const item of actualFramework.indicators) {
    const html = render(ui.MacroRuleScoring, { item, observation: actualCurrent.observations[item.id] });
    assert.doesNotMatch(html, /评分方法待核验|复合评分方法待核验|连续评分方法待核验/, item.id);
    if (item.scoring.method === "weighted-components") assert.doesNotMatch(html, /尚无可展示的原始证据/, item.id);
  }
  const gdp = render(ui.MacroRuleScoring, { item: actualFramework.indicators.find((rule) => rule.id === "E01"), observation: actualCurrent.observations.E01 });
  const raw = (value) => String(Number(value.toPrecision(10)));
  const gdpRaw = actualCurrent.observations.E01.scoringInputs.quarterYoyChange.rawEvidence;
  assert.ok(gdp.includes(`本季单季实际同比原值：</strong>${raw(gdpRaw.current.value)}%`));
  assert.ok(gdp.includes(`前季单季实际同比原值：</strong>${raw(gdpRaw.preceding.value)}%`));
  const profit = render(ui.MacroRuleScoring, { item: actualFramework.indicators.find((rule) => rule.id === "G02"), observation: actualCurrent.observations.G02 });
  const profitRaw = actualCurrent.observations.G02.scoringInputs;
  assert.ok(profit.includes(`当期营业收入利润率：${raw(profitRaw.reportedProfitMarginYoyChange.rawEvidence.currentProfitMargin)}%`));
  assert.ok(profit.includes(`当期应收账款平均回收期：${raw(profitRaw.reportedReceivablesDaysYoyChange.rawEvidence.currentReceivablesDays)}天`));
  const breadthRule = actualFramework.indicators.find((rule) => rule.id === "G19");
  if (breadthRule) {
    const breadth = render(ui.MacroRuleScoring, { item: breadthRule, observation: actualCurrent.observations.G19 });
    assert.match(breadth, /53\.66%/);
    assert.match(breadth, /改善 22\/41 行业/);
    assert.match(breadth, /下降 19\/41 行业/);
    assert.match(breadth, /分行业原值 · 41\/41行业/);
    assert.doesNotMatch(breadth, /53\.658536|行业明细待完整核验/);
    assert.equal(actualFramework.indicators.find((rule) => rule.id === "G02").scoring.components.some((part) => part.key === "industryProfitImprovementBreadth"), false);
  }
});

test("indicator and standard views share exact rules, basis, requirements and two-decimal current scores", () => {
  const ui = loadUi({ frameworkUpdate(framework) {
    const rule = framework.indicators.find((entry) => entry.id === "E01");
    rule.scoringBasis = "唯一评分依据标记";
    rule.requirements = ["唯一录入要求标记"];
    rule.scoring = { method: "piecewise-linear", anchors: [[3, 1], [5, 3], [7, 5]], description: "本项连续曲线" };
    rule.grades = grades;
  } });
  const inputs = render(ui.MacroRatingInputs, { onViewStandard() {} });
  assert.match(inputs, /查看评分标准/);
  assert.match(inputs, /2\.63 分/);
  assert.doesNotMatch(inputs, /2\.625 分/);
  const standards = render(ui.MacroRatingIndicators, { selectedRuleId: "E01" });
  assert.match(standards, /id="macro-rule-E01"/);
  assert.match(standards, /唯一评分依据标记/);
  assert.match(standards, /唯一录入要求标记/);
  assert.match(standards, /本项连续曲线/);
  assert.match(standards, /已核验 2\.63 分/);
  assert.doesNotMatch(standards, /OLD DISCRETE/);
  assert.match(source, /setSelectedRuleId\(ruleId\)/);
  assert.match(source, /setSheet\("评分标准"\)/);
  assert.match(source, /selected\.open = true/);
});

test("indicator, standard and archive pages share compact two-level guides without dropping their full methods", () => {
  const ui = loadUi();
  const cases = [
    { html: render(ui.MacroRatingInputs, { onViewStandard() {} }), title: "评分指标", lead: "核对当期数据与评分，点击指标查看对应标准", detail: "按维度核对统计期、原值与来源；未核验项不补分", method: "网页暂不提供直接写入" },
    { html: render(ui.MacroRatingIndicators, { selectedRuleId: "E01" }), title: "评分标准", lead: "按维度查看评分口径与依据", detail: "双口径子项直接分列；其余指标展开查看标准", method: "权重、连续锚点、固定复合分量及五档证据边界均为研究试行配置" },
    { html: render(ui.MacroRatingHistory), title: "评分记录", lead: "按时间回看各期评分与依据", detail: "新评分只追加，旧记录默认保留", method: "只有用户明确指定要删除哪些记录时才删除" },
  ];
  for (const { html, title, lead, detail, method } of cases) {
    const header = html.match(/<header class="research-header macro-rating-page-header">[\s\S]*?<\/header>/)?.[0];
    assert.ok(header, title);
    assert.ok(header.includes(`<h2>${title}</h2>`), title);
    assert.ok(header.includes(`<div class="macro-rating-guide"><p class="macro-rating-guide-lead">${lead}</p><p class="macro-rating-guide-detail">${detail}</p></div>`), title);
    assert.equal([...header.matchAll(/<p class="macro-rating-guide-/g)].length, 2, title);
    assert.doesNotMatch(header, /只有用户明确指定|网页暂不提供直接写入|五档证据边界均为研究试行配置/);
    assert.match(html, /<details class="macro-rating-help"><summary>口径与核验说明<\/summary>/);
    const help = html.slice(html.lastIndexOf('<details class="macro-rating-help"><summary>口径与核验说明</summary>'));
    assert.ok(help.includes(method), title);
    assert.doesNotMatch(html, /<details class="macro-rating-help" open/);
    assert.doesNotMatch(html, /<p class="research-footnote">/);
  }
  assert.match(cases[0].html, /研究暂评分只进入单列研究观察分，不冒充原值核验评分/);
  assert.match(cases[0].html, /新旧指标采用独立编号，不能沿用被替换指标的观测值/);
  assert.ok(cases[0].html.includes(summary.macroRatingTimelinessNote));
  assert.match(cases[1].html, /本期观测与标准逐项联动，不沿用旧版分数/);
  assert.match(cases[1].html, /<details class="macro-rating-help"><summary>本版尺度校准说明<\/summary>/);
  assert.match(cases[1].html, /官方原始发布 → Wind → 财新数据 API/);
  assert.ok(cases[1].html.includes(summary.macroRatingTimelinessNote));
  assert.match(cases[2].html, /各期保留截止日、规则版本、四维得分、覆盖率和原始证据/);
  assert.match(cases[2].html, /此前已获准删除的记录不自动恢复/);
  assert.match(cases[2].html, /完整核验不等于权重已完成回测/);
});

test("compact metadata leaves exact group weights visible while detailed policy conditions remain expandable", () => {
  const policyRule = actualFramework.indicators.find((item) => item.pillar === "宏观调控");
  const ui = loadUi({ frameworkUpdate(framework) { framework.pillars = { 宏观调控: .15, 经济运行: .25, 增长动力: .4, 金融信贷: .2 }; } });
  for (const html of [render(ui.MacroRatingInputs, { onViewStandard() {} }), render(ui.MacroRatingIndicators, { selectedRuleId: policyRule.id })]) {
    const metadata = html.match(/<div class="macro-v1-summary">[\s\S]*?<\/div>/)?.[0];
    assert.ok(metadata.includes(`截止 ${ui.current.asOf}`));
    assert.ok(metadata.includes(`已核验 ${ui.framework.indicators.length} / ${ui.framework.indicators.length} 项 · 覆盖 100%`));
    assert.match(metadata, /宏观调控15% \/ 经济运行25% \/ 增长动力40% \/ 金融信贷20%/);
    assert.doesNotMatch(metadata, /不沿用旧版分数|原文研判不是自动量化结果/);
    for (const group of summary.summarizePillarWeights(ui.framework, "宏观调控").groups) assert.ok(html.includes(`${group.count}项 · 总分权重 ${displayWeight(group.weight)}`));
    assert.match(html, /<details class="macro-rating-help"><summary>权重口径与政策研判说明<\/summary>/);
    assert.match(html, /原文研判不是自动量化结果/);
    assert.ok(html.includes(ui.framework.policyMethod.highScore));
    assert.ok(html.includes(ui.framework.policyMethod.continuity));
    assert.match(html, /公开证据不足保持待核验，不补中性分/);
  }
});

test("compact indicator and standard guides keep unverified and research-assessed items visible before collapsible methods", () => {
  const missing = actualFramework.indicators[0];
  const assessment = { points: 3, status: "研究暂评", period: "2026-09", reviewDate: "2026-10-11", rationale: "暂评原始依据保留", confidence: "低", thresholdComparison: "并非已核验落档", unknowns: ["缺失原值"], counterEvidence: ["反证"], evidence: [{ finding: "官方事实", sourceUrl: "https://www.pbc.gov.cn/", releaseDate: "2026-09-30", originalPublisher: "中国人民银行" }] };
  const ui = loadUi({ currentUpdate(current) { current.observations[missing.id] = null; },
    assessments: { [missing.id]: assessment }, researchUpdate(research) { research.count = 1; } });
  const inputs = render(ui.MacroRatingInputs, { onViewStandard() {} });
  const standards = render(ui.MacroRatingIndicators, { selectedRuleId: missing.id });
  for (const html of [inputs, standards]) {
    const main = html.slice(0, html.indexOf('<details class="macro-rating-help">'));
    assert.match(main, /class="macro-rating-notice" role="status"/);
    assert.match(main, /原值待核验 1 项 · 研究暂评 1 项，不计入核验覆盖率；缺项不补中性分/);
    assert.match(html, /3\.00 分 · (?:研究暂评|暂评)/);
    assert.match(html, /暂评原始依据保留/);
    assert.match(html, /https:\/\/www\.pbc\.gov\.cn\//);
  }
  const empty = loadUi({ empty: true });
  for (const html of [render(empty.MacroRatingInputs, { onViewStandard() {} }), render(empty.MacroRatingIndicators, { selectedRuleId: "E01" })]) {
    const main = html.slice(0, html.indexOf('<details class="macro-rating-help">'));
    assert.ok(main.includes(`原值待核验 ${actualFramework.indicators.length} 项`));
    assert.match(main, /已核验 0 \/ \d+ 项 · 覆盖 0%/);
    assert.doesNotMatch(html, /NaN|Infinity/);
  }
});

test("indicator rows keep original links and dates visible with full rationale folded rather than deleted", () => {
  const rule = actualFramework.indicators[0];
  const ui = loadUi({ currentUpdate(current) {
    current.observations[rule.id].rationale = "完整原始评分理由保留标记";
  } });
  const html = render(ui.MacroRatingInputs, { onViewStandard() {} });
  const row = [...html.matchAll(/<tr(?:\s[^>]*)?>[\s\S]*?<\/tr>/g)].map((match) => match[0]).find((entry) => entry.includes(`<strong>${rule.name}</strong>`));
  assert.ok(row);
  const beforeDetail = row.slice(0, row.indexOf('<details class="macro-rating-row-evidence">'));
  assert.match(beforeDetail, /href="https:\/\/www\.stats\.gov\.cn\/"/);
  assert.match(beforeDetail, /原文 ↗/);
  assert.match(beforeDetail, /发布 2026-09-30 · 核验 2026-10-11/);
  assert.match(beforeDetail, /2\.63 分/);
  assert.doesNotMatch(beforeDetail, /完整原始评分理由保留标记/);
  assert.match(row, /<details class="macro-rating-row-evidence"><summary>评分理由与核验详情<\/summary><p>完整原始评分理由保留标记<\/p><\/details>/);
  assert.doesNotMatch(row, /<details[^>]*\bopen(?:=|\s|>)/);
  const assessment = { points: 3, status: "研究暂评", period: "2026-09", reviewDate: "2026-10-11", rationale: "暂评理由保留标记", confidence: "低", thresholdComparison: "暂评边界与限制保留标记", unknowns: [], counterEvidence: [], evidence: [{ finding: "官方事实", sourceUrl: "https://www.pbc.gov.cn/", releaseDate: "2026-09-30", originalPublisher: "中国人民银行" }] };
  const researchUi = loadUi({ currentUpdate(current) { current.observations[rule.id] = null; }, assessments: { [rule.id]: assessment } });
  const researchHtml = render(researchUi.MacroRatingInputs, { onViewStandard() {} });
  const researchRow = [...researchHtml.matchAll(/<tr(?:\s[^>]*)?>[\s\S]*?<\/tr>/g)].map((match) => match[0]).find((entry) => entry.includes(`<strong>${rule.name}</strong>`));
  const visible = researchRow.slice(0, researchRow.indexOf('<details class="macro-rating-row-evidence">'));
  assert.match(visible, /暂评原始依据 ↗/);
  assert.match(visible, /href="https:\/\/www\.pbc\.gov\.cn\/"/);
  assert.match(visible, /原值待核验/);
  assert.match(visible, /3\.00 分 · 研究暂评/);
  assert.match(visible, /置信度低 · 不计入核验覆盖率/);
  assert.doesNotMatch(visible, /暂评理由保留标记|暂评边界与限制保留标记/);
  assert.match(researchRow, /<details class="macro-rating-row-evidence"><summary>评分理由与核验详情<\/summary><p>暂评理由保留标记<\/p><p>暂评边界与限制保留标记<\/p><\/details>/);
  const emptyUi = loadUi({ empty: true });
  const emptyHtml = render(emptyUi.MacroRatingInputs, { onViewStandard() {} });
  assert.match(emptyHtml, /待核验，不计分/);
  assert.match(emptyHtml, /待补原文/);
  assert.doesNotMatch(emptyHtml, /class="macro-rating-row-evidence"/);
});

test("summary highlights normalized fundamentals separately from support without changing rating bands", () => {
  const ui = loadUi();
  const html = render(ui.MacroRatingSummary);
  const text = html.replace(/<[^>]*>/g, "");
  const fundamentals = ui.result.pillars.filter((item) => item.name !== "宏观调控");
  const weight = fundamentals.reduce((sum, item) => sum + item.weight, 0);
  const normalized = fundamentals.reduce((sum, item) => sum + item.contribution, 0) / weight;
  assert.match(html, /基本面与信用/);
  assert.ok(text.includes(`${ui.formatScore(normalized)} / 5`));
  assert.match(html, /政策支持/);
  assert.match(text, /4\.00 \/ 5/);
  assert.match(html, /class="macro-summary-grade">III档 条件中性/);
  assert.ok(text.includes(`${ui.formatScore(ui.result.formalScore)} / 5`));
  assert.ok(html.includes(`占综合权重 ${displayWeight(weight)}`));
  assert.ok(html.includes(`占综合权重 ${displayWeight(ui.framework.pillars.宏观调控)}`));
  assert.match(render(ui.MacroRatingHistory), /同一信息截止日，不同规则版本的分数变化不等于经济变化/);
  const standards = render(ui.MacroRatingIndicators, { selectedRuleId: "E01" });
  assert.match(standards, /支持加码并不等于实体经济已经改善/);
  assert.match(standards, /股票、债券、商品须分别分析/);
  assert.match(standards, /不由宏观总分直接生成买卖或仓位/);
  assert.match(html, /class="macro-summary-score-grid"/);
  const empty = render(loadUi({ empty: true }).MacroRatingSummary);
  assert.match(empty, /—<small> \/ 5<\/small>/);
  assert.match(empty, /资料不足/);
  assert.doesNotMatch(empty, /III档 条件中性/);
  assert.doesNotMatch(empty, /4\.00<small> \/ 5<\/small>/);
});

test("summary keeps compact scores while relocating full observations and methods to their authoritative pages", () => {
  const ui = loadUi({ frameworkUpdate(framework) { framework.purpose = "专属方法目的长说明标记"; },
    currentUpdate(current) { current.reviewSummary = "本期观察依据保留标记"; current.sourceStatus = "原始来源状况保留标记"; current.evidenceLimitations = [{ reason: "核验局限保留标记" }]; } });
  const before = JSON.stringify([ui.framework, ui.current, ui.history, ui.result, ui.research]);
  const html = render(ui.MacroRatingSummary);
  const main = html;
  assert.match(html, /^<section class="macro-summary">/);
  assert.match(main, /<header class="research-header macro-summary-header">/);
  assert.match(main, /<h2>评分总览<\/h2>/);
  assert.match(main, /class="macro-summary-meta"/);
  assert.ok(main.includes(`信息截止 ${ui.current.asOf}`));
  assert.ok(main.includes(`${ui.framework.indicators.length} / ${ui.framework.indicators.length} 项核验`));
  assert.ok(main.includes(`${ui.framework.version} · 试行`));
  const scoreGrid = main.slice(main.indexOf('class="macro-summary-score-grid"'), main.indexOf('class="macro-summary-pillars"'));
  assert.equal([...scoreGrid.matchAll(/<article class="macro-summary-score-card/g)].length, 3);
  for (const label of ["综合评级", "基本面与信用", "政策支持"]) assert.ok(scoreGrid.includes(`<h3>${label}</h3>`));
  assert.equal([...scoreGrid.matchAll(/class="macro-summary-score-value"/g)].length, 3);
  assert.equal([...main.matchAll(/class="macro-summary-pillar-heading"/g)].length, 4);
  assert.equal([...main.matchAll(/class="macro-summary-pillar-score"/g)].length, 4);
  assert.equal([...main.matchAll(/<small> \/ 5<\/small>/g)].length, 7);
  for (const item of ui.result.pillars) {
    assert.ok(main.includes(`<h3>${item.name}</h3><span>${displayWeight(item.weight)}</span>`));
    assert.ok(main.includes(`${item.count} 项指标 · 已核验 ${item.count} 项 · 核验覆盖 100%`));
  }
  assert.match(main, /<p class="macro-summary-observation">观察重点：结合四维差异理解综合分，政策支持不等于经济复苏。<\/p>/);
  assert.doesNotMatch(main, /专属方法目的长说明标记|本期观察依据保留标记|原始来源状况保留标记|核验局限保留标记|同一信息截止日，不同规则版本/);
  assert.doesNotMatch(main, /macro-summary-details|<details|本期观察、来源与局限|宏观调控分项 · 财政、货币、产业、制度|同截止日的版本比较|评级方法、发布门槛与适用范围/);
  const archive = render(ui.MacroRatingHistory);
  const standards = render(ui.MacroRatingIndicators, { selectedRuleId: "E01" });
  assert.match(archive, /<details class="macro-rating-help"><summary>本期观察、来源与局限<\/summary>/);
  assert.ok(archive.includes(`<strong>本期宏观观察 · ${ui.current.asOf} · ${ui.framework.version}</strong>`));
  assert.match(archive, /<details class="macro-rating-help"><summary>同截止日的版本比较<\/summary>/);
  assert.match(standards, /<details class="macro-rating-help"><summary>评级方法、发布门槛与适用范围<\/summary>/);
  for (const label of ["本期观察依据保留标记", "原始来源状况保留标记", "核验局限保留标记", "同一信息截止日，不同规则版本的分数变化不等于经济变化"]) assert.ok(archive.includes(label));
  for (const label of ["专属方法目的长说明标记", summary.macroRatingScopeNote, summary.macroRatingTimelinessNote, "100% 权重核验后才发布正式总分和档位", "总覆盖至少 85%、每支柱至少 70%"]) assert.ok(standards.includes(label));
  assert.doesNotMatch(archive, /专属方法目的长说明标记|评级方法、发布门槛与适用范围/);
  assert.doesNotMatch(standards, /本期观察依据保留标记|原始来源状况保留标记|核验局限保留标记|同截止日的版本比较/);
  const policyRule = ui.framework.indicators.find((item) => item.pillar === "宏观调控");
  const policyStandards = render(ui.MacroRatingIndicators, { selectedRuleId: policyRule.id });
  for (const group of summary.summarizePillarWeights(ui.framework, "宏观调控").groups) assert.ok(policyStandards.includes(`${group.count}项 · 总分权重 ${displayWeight(group.weight)}`));
  assert.doesNotMatch(archive, /macro-summary-details/);
  assert.doesNotMatch(main, /class="macro-summary-alert"/);
  assert.doesNotMatch(archive, /<details[^>]*\bopen(?:=|\s|>)/);
  assert.doesNotMatch(standards, /<details[^>]*\bopen(?:=|\s|>)/);
  assert.ok(html.endsWith(`<p class="research-footnote">已保留评分记录 ${ui.history.snapshots.length} 期，其中正式评级 1 期。</p></section>`));
  assert.equal(JSON.stringify([ui.framework, ui.current, ui.history, ui.result, ui.research]), before);
});

const incompletePolicyRule = actualFramework.indicators.find((item) => item.pillar === "宏观调控");
function oneMissingPolicy(result) {
  result.formalScore = null;
  result.status = "暂定";
  result.coverage = 1 - incompletePolicyRule.weight;
  const policy = result.pillars.find((item) => item.name === "宏观调控");
  policy.verifiedCount -= 1;
  policy.verifiedWeight -= incompletePolicyRule.weight;
  policy.coverage = policy.verifiedWeight / policy.weight;
  policy.contribution -= incompletePolicyRule.weight * policy.observedScore;
}

test("partial and empty summaries keep missing evidence and non-formal status prominent rather than hiding gaps in details", () => {
  const ui = loadUi({ currentUpdate(current) {
    current.observations[incompletePolicyRule.id] = null;
    current.gaps = [{ id: incompletePolicyRule.id, reason: "官方原值待核对标记" }];
  }, resultUpdate: oneMissingPolicy });
  const html = render(ui.MacroRatingSummary);
  const main = html;
  assert.match(main, /class="macro-summary-alert" role="status"/);
  assert.match(main, /尚未满足正式总分发布门槛/);
  assert.match(main, /原值待补证据 1 项/);
  assert.match(main, /缺项不按中性分补齐/);
  assert.match(main, /暂定观察 · 未发布正式总分/);
  assert.match(main, /class="macro-summary-score-value">—<small> \/ 5<\/small>/);
  assert.ok(main.includes(`核验覆盖 ${displayWeight(ui.result.coverage)}`));
  assert.match(main, /仅为原值核验部分，暂评另列/);
  assert.match(main, /原值核验观察分，非完整维度评级/);
  const archive = render(ui.MacroRatingHistory);
  assert.match(archive, /原值待补证据 · 1 项（不默认补分）/);
  assert.match(archive, /官方原值待核对标记/);
  assert.doesNotMatch(main, /<details|原值待补证据 · 1 项（不默认补分）|官方原值待核对标记/);
  assert.doesNotMatch(main, /III档 条件中性|研究观察 · 含暂评/);
  const empty = render(loadUi({ empty: true }).MacroRatingSummary);
  assert.match(empty, /资料不足 · 未发布正式总分/);
  assert.ok(empty.includes(`原值待补证据 ${actualFramework.indicators.length} 项`));
  assert.match(empty, /仅为已覆盖观察分，不补空值/);
  assert.doesNotMatch(empty, /NaN|Infinity/);
});

test("research-inclusive summary keeps its score but never promotes coverage or hides the official evidence deficit", () => {
  const assessment = { points: 3, status: "研究暂评", period: "2026-09", reviewDate: "2026-10-11", rationale: "独立暂评依据保留标记", confidence: "低", thresholdComparison: "并非已核验落档", unknowns: ["缺失原值标记"], counterEvidence: ["反证保留标记"], evidence: [{ finding: "原始发现标记", sourceUrl: "https://www.pbc.gov.cn/", releaseDate: "2026-09-30", originalPublisher: "中国人民银行" }] };
  const ui = loadUi({ currentUpdate(current) { current.observations[incompletePolicyRule.id] = null; }, resultUpdate: oneMissingPolicy,
    assessments: { [incompletePolicyRule.id]: assessment }, researchUpdate(research) {
      research.count = 1; research.countTotal = actualFramework.indicators.length; research.coverage = 1; research.score = 3.12345;
      const policy = research.pillars.find((item) => item.name === "宏观调控"); policy.researchCount = 1; policy.score = 4.125;
    } });
  const html = render(ui.MacroRatingSummary);
  const main = html;
  assert.match(main, /class="macro-summary-score-value">3\.12<small> \/ 5<\/small>/);
  assert.match(main, /研究观察 · 含暂评，非正式评级/);
  assert.match(main, /评分覆盖 100% · 含研究暂评 1 项/);
  assert.ok(main.includes(`已核验权重 ${displayWeight(ui.result.coverage)}`));
  assert.match(main, /原值待补证据 1 项/);
  assert.match(main, /暂评已单列计分，但不增加核验覆盖率、不代表全部原值已核验/);
  assert.match(main, /含暂评 1 项的维度分 4\.13 \/ 5 · 非正式评级/);
  assert.match(main, /<h3>政策支持<\/h3><strong class="macro-summary-score-value">4\.00<small> \/ 5<\/small>/);
  const archive = render(ui.MacroRatingHistory);
  assert.match(archive, /独立暂评依据保留标记/);
  assert.match(archive, /缺失原值标记/);
  assert.match(archive, /反证保留标记/);
  assert.match(archive, /https:\/\/www\.pbc\.gov\.cn\//);
  assert.match(render(ui.MacroRatingIndicators, { selectedRuleId: incompletePolicyRule.id }), /研究观察分仅按原权重合计，不增加核验覆盖率，不发布正式档位/);
  assert.doesNotMatch(main, /<details|独立暂评依据保留标记|缺失原值标记|反证保留标记/);
  assert.doesNotMatch(main, /III档 条件中性/);
});

test("archive formats fractional scores without hardcoded old versions or score comparisons", () => {
  const ui = loadUi();
  const html = render(ui.MacroRatingHistory);
  assert.match(html, /2\.63 分/);
  assert.match(html, /评分记录默认全部保留/);
  assert.match(html, /只有用户明确指定要删除哪些记录时才删除/);
  assert.match(html, /此前已获准删除的记录不自动恢复/);
  assert.doesNotMatch(html, /仅保留本期新版/);
  assert.match(html, /同截止日的规则版本变化不等于经济变化/);
  assert.doesNotMatch(source, /过往三次评分|2\.91变|V1\.14|V1\.15/);
});

test("archive rows show one short disclosure while preserving each record's full basis and validation", () => {
  const ui = loadUi({ historyUpdate(history) {
    history.snapshots[0].evidence = "最新一期完整评分依据保留标记";
    history.snapshots[0].validation = "最新一期完整政策验证点保留标记";
    const older = structuredClone(history.snapshots[0]);
    older.version = "TEST-ARCHIVE-OLDER";
    older.evidence = "旧期完整评分依据保留标记";
    older.validation = "旧期完整政策验证点保留标记";
    history.snapshots.unshift(older);
  } });
  const before = JSON.stringify(ui.history);
  const html = render(ui.MacroRatingHistory);
  const table = html.match(/<table class="dense-table">[\s\S]*?<\/table>/)?.[0];
  const rows = [...table.matchAll(/<tbody>[\s\S]*?<\/tbody>/g)][0][0].match(/<tr>[\s\S]*?<\/tr>/g);
  assert.equal(rows.length, 2);
  for (const [index, snapshot] of ui.history.snapshots.toReversed().entries()) {
    const cells = [...rows[index].matchAll(/<td>[\s\S]*?<\/td>/g)].map((match) => match[0]);
    assert.equal(cells.length, 9);
    const evidenceCell = cells.at(-1);
    assert.ok(evidenceCell.includes(`<details class="macro-rating-row-evidence"><summary>本期依据与验证点</summary><p><strong>评分依据：</strong>${snapshot.evidence}</p><p><strong>验证点：</strong>${snapshot.validation}</p></details>`));
    assert.doesNotMatch(evidenceCell, /<details[^>]*\bopen(?:=|\s|>)/);
    const visible = evidenceCell.replace(/<details[\s\S]*?<\/details>/, "本期依据与验证点");
    assert.doesNotMatch(visible, /完整评分依据保留标记|完整政策验证点保留标记/);
    assert.ok(cells[1].includes(snapshot.version));
    assert.ok(cells[6].includes(ui.formatScore(snapshot.score)));
    assert.match(cells[7], /核验 100%/);
  }
  assert.equal(JSON.stringify(ui.history), before);
});

test("approved pillar weights, indicator weights and fractional policy weights render from the framework exactly", () => {
  const ui = loadUi({ frameworkUpdate(framework) {
    splitProfitFramework(framework);
    framework.indicators.find((item) => item.pillar === "宏观调控").weight = .0125;
  }, currentUpdate: splitProfitCurrent });
  const standards = render(ui.MacroRatingIndicators, { selectedRuleId: "G19" });
  assert.match(standards, /经济运行25% \/ 增长动力40% \/ 金融信贷20% \/ 宏观调控15%/);
  assert.match(standards, /增长动力 · 14项 · 总分权重40%/);
  assert.match(standards, /两项合计占宏观总分 8%/);
  assert.doesNotMatch(standards, /30 \/ 30 \/ 20 \/ 20/);
  const policyRule = ui.framework.indicators.find((item) => item.pillar === "宏观调控");
  const policy = render(ui.MacroRatingIndicators, { selectedRuleId: policyRule.id });
  assert.match(policy, /class="macro-v1-weight">1\.25%/);
  const inputUi = loadUi({ frameworkUpdate(framework) {
    splitProfitFramework(framework);
    framework.pillars = { 宏观调控: .15, 经济运行: .25, 增长动力: .4, 金融信贷: .2 };
    framework.indicators.find((item) => item.pillar === "宏观调控").weight = .0125;
  }, currentUpdate: splitProfitCurrent });
  assert.match(render(inputUi.MacroRatingInputs, { onViewStandard() {} }), /<td>1\.25%<\/td>/);
  assert.match(render(ui.MacroRatingSummary), /占综合权重 85%/);
  assert.match(render(ui.MacroRatingSummary), /占综合权重 15%/);
});

test("profit quality and industry breadth are independently visible with raw values, scores and no repeated breadth component", () => {
  const ui = loadUi({ frameworkUpdate: splitProfitFramework, currentUpdate: splitProfitCurrent,
    pointsById: { G02: 3.52625, G19: 3.1463414634146343 } });
  const standards = render(ui.MacroRatingIndicators, { selectedRuleId: "G19" });
  assert.match(standards, /id="macro-rule-G02"/);
  assert.match(standards, /id="macro-rule-G19"/);
  assert.match(standards, /本期原值 15\.7% · 2026-08/);
  assert.match(standards, /本期原值 53\.66% · 2026-08/);
  assert.match(standards, /3\.53 分/);
  assert.match(standards, /3\.15 分/);
  assert.match(standards, /改善 22\/41 行业/);
  assert.match(standards, /下降 19\/41 行业/);
  assert.match(standards, /持平 0\/41 行业/);
  assert.match(standards, /利润下降不等于亏损/);
  assert.match(standards, /分行业原值 · 41\/41行业/);
  assert.doesNotMatch(standards, /53\.658536/);
  const profit = render(ui.MacroRuleScoring, { item: ui.framework.indicators.find((item) => item.id === "G02"), observation: ui.current.observations.G02 });
  const sectionLabels = [...profit.matchAll(/aria-label="([^"]+)评分分量"/g)].map((match) => match[1]);
  assert.equal(sectionLabels.length, 4);
  assert.match(profit, /固定项内权重 50%/);
  assert.match(profit, /固定项内权重 25%/);
  assert.equal([...profit.matchAll(/固定项内权重 12\.5%/g)].length, 2);
  assert.match(profit, /行业改善广度见独立指标 G19，不在本项重复计分/);
  assert.doesNotMatch(profit, /行业利润改善广度评分分量|分行业原值|固定项内权重 20%/);
  const inputUi = loadUi({ frameworkUpdate(framework) {
    splitProfitFramework(framework);
    framework.pillars = { 增长动力: .4, 经济运行: .25, 金融信贷: .2, 宏观调控: .15 };
  }, currentUpdate: splitProfitCurrent, pointsById: { G02: 3.52625, G19: 3.1463414634146343 } });
  const inputs = render(inputUi.MacroRatingInputs, { onViewStandard() {} });
  assert.match(inputs, /53\.66%/);
  assert.match(inputs, /改善 22\/41 行业/);
  assert.match(inputs, /下降 19\/41 行业/);
  assert.match(inputs, /<td>4%<\/td>/);
  assert.match(inputs, /3\.53 分/);
  assert.match(inputs, /3\.15 分/);
  assert.doesNotMatch(inputs, /53\.658536/);
});

test("breadth summaries reject incomplete or corrupted evidence rather than treating missing industries as declines", () => {
  const ui = loadUi();
  const original = standaloneBreadth();
  assert.match(render(ui.MacroProfitBreadthSummary, { observation: original }), /改善 22\/41 行业/);
  const cases = [null, { ...original, value: 99 }, { ...original, verified: false }];
  const missing = structuredClone(original); missing.rawEvidence.industries.pop(); cases.push(missing);
  const duplicate = structuredClone(original); duplicate.rawEvidence.industries[1] = structuredClone(duplicate.rawEvidence.industries[0]); cases.push(duplicate);
  for (const observation of cases) {
    const html = render(ui.MacroProfitBreadthSummary, { observation });
    assert.match(html, /行业明细待完整核验/);
    assert.match(html, /缺失行业不算下降/);
    assert.doesNotMatch(html, /改善 \d+\/41 行业|下降 \d+\/41 行业/);
  }
});

test("archive preserves and displays every supplied snapshot, including independent breadth with historical cutoff", () => {
  const ui = loadUi({ frameworkUpdate: splitProfitFramework, currentUpdate: splitProfitCurrent,
    historyUpdate(history, framework, current) {
      const latest = history.snapshots[0];
      latest.evidence = "新版保留标记";
      latest.rows = ["G02", "G19"].map((id) => ({ id, name: framework.indicators.find((item) => item.id === id).name,
        weight: .04, points: id === "G19" ? 3.1463414634146343 : 3.52625, gap: null, observation: current.observations[id] }));
      const older = structuredClone(latest); older.version = "TEST-OLDER"; older.period = "旧期保留标记"; older.evidence = "旧版保留标记";
      const policy = structuredClone(older); policy.version = "TEST-OLDEST"; policy.period = "最旧期保留标记";
      policy.rows = [{ id: "POLICY", name: "精确历史权重", weight: .0125, points: 4, gap: null, observation: null }];
      history.snapshots.unshift(policy, older);
    } });
  const before = JSON.stringify(ui.history);
  const html = render(ui.MacroRatingHistory);
  assert.match(html, /新版保留标记/);
  assert.match(html, /旧期保留标记/);
  assert.match(html, /最旧期保留标记/);
  assert.ok(html.indexOf("新版保留标记") < html.indexOf("旧期保留标记"));
  assert.match(html, /总分权重 1\.25%/);
  assert.match(html, /53\.66%/);
  assert.match(html, /改善 22\/41 行业/);
  assert.match(html, /下降 19\/41 行业/);
  assert.match(html, /评分记录默认全部保留/);
  assert.doesNotMatch(html, /仅保留本期新版|53\.658536/);
  assert.equal(ui.history.snapshots.length, 3);
  assert.equal(JSON.stringify(ui.history), before);
});

// Dual-basis rows are opt-in: unrelated composites and frozen older versions
// keep their existing compact layout, while the requested subitems are visible.
const dualComponents = [
  { key: "yearToDateGrowth", label: "年初累计同比", weight: .4, unit: "%", basis: "年初累计同比", input: "observation.scoringInputs.yearToDateGrowth", anchors: [[0, 1], [5, 3], [10, 5]] },
  { key: "latestMonthGrowth", label: "最新单月同比", weight: .6, unit: "%", basis: "当月可比同比", input: "observation.value", anchors: [[0, 1], [5, 3], [10, 5]] },
];
const dualObservation = () => ({ ...record("工业增加值当月原值", 5.2), period: "2026-08", verified: true,
  scoringInputs: { yearToDateGrowth: { ...record("工业增加值年初累计同比", 5.3), period: "2026-08", basis: "年初累计同比", verified: true } } });
const dualDetails = () => ({ points: 3.096, components: [
  { key: "yearToDateGrowth", value: 5.3, points: 3.12, weight: .4 },
  { key: "latestMonthGrowth", value: 5.2, points: 3.08, weight: .6 },
] });
function dualFramework(framework) {
  framework.pillars = { 增长动力: .4, 经济运行: .25, 金融信贷: .2, 宏观调控: .15 };
  framework.indicators.forEach((item) => { delete item.displayComponents; });
  const rule = framework.indicators.find((item) => item.id === "G01");
  rule.displayComponents = true;
  rule.weight = .025;
  rule.scoring = { method: "weighted-components", description: "累计与最新单期分别计分，不增加总权重", components: structuredClone(dualComponents) };
}
function dualCurrent(current) { current.observations.G01 = dualObservation(); }
const withoutClosedDetails = (html) => {
  let depth = 0, visible = "";
  for (const token of html.split(/(<\/?details\b[^>]*>)/g)) {
    if (/^<details\b/.test(token)) depth += 1;
    else if (/^<\/details/.test(token)) depth -= 1;
    else if (!depth) visible += token;
  }
  return visible;
};
const componentRows = (html, parent) => [...html.matchAll(/<tr[^>]*data-macro-component=[\s\S]*?<\/tr>/g)]
  .map((entry) => entry[0]).filter((row) => !parent || row.includes(`data-macro-parent="${parent}"`));

test("dual-basis indicators expose separate raw values, periods, component scores and allocated macro weights without expanding details", () => {
  const ui = loadUi({ frameworkUpdate: dualFramework, currentUpdate: dualCurrent,
    pointsById: { G01: 3.096 }, componentDetailsById: { G01: dualDetails() } });
  const before = JSON.stringify([ui.framework, ui.current]);
  const html = render(ui.MacroRatingInputs, { onViewStandard() {} });
  const visible = withoutClosedDetails(html);
  const children = componentRows(visible, "G01");
  assert.equal(children.length, 2);
  assert.match(children[0], /年初累计同比/);
  assert.match(children[0], /2026-01—2026-08/);
  assert.match(children[0], /5\.3%/);
  assert.match(children[0], /3\.12 分/);
  assert.match(children[0], /<strong>1%<\/strong>/);
  assert.match(children[0], /项内 40% · 已包含在父项/);
  assert.match(children[1], /最新单月同比/);
  assert.match(children[1], /<td>2026-08<\/td>/);
  assert.match(children[1], /5\.2%/);
  assert.match(children[1], /3\.08 分/);
  assert.match(children[1], /<strong>1\.5%<\/strong>/);
  assert.match(children[1], /项内 60% · 已包含在父项/);
  for (const row of children) {
    assert.match(row, /子项原文 ↗/);
    assert.match(row, /发布 2026-09-21 · 核验 2026-10-11/);
    assert.doesNotMatch(row, /<details/);
  }
  assert.match(visible, /<td>2\.5%<\/td>/);
  assert.match(visible, /3\.10 分/);
  assert.match(visible, /合成项 · 下方子项权重已包含在本项，不重复相加/);
  assert.ok(visible.includes(`${ui.framework.indicators.filter((item) => item.pillar === "增长动力").length} 项核心指标`));
  assert.equal(JSON.stringify([ui.framework, ui.current]), before);
});

test("dual-basis standards expose each component curve and allocation, leaving only evidence folded", () => {
  const ui = loadUi({ frameworkUpdate: dualFramework, currentUpdate: dualCurrent,
    pointsById: { G01: 3.096 }, componentDetailsById: { G01: dualDetails() } });
  const html = render(ui.MacroRatingIndicators, { selectedRuleId: "G01" });
  const visible = withoutClosedDetails(html);
  assert.match(visible, /<section class="macro-v1-item" id="macro-rule-G01"/);
  assert.match(visible, /年初累计同比 · 固定项内权重 40%/);
  assert.match(visible, /最新单月同比 · 固定项内权重 60%/);
  assert.match(visible, /折算总分权重 1% · 已包含在父项，不另加权/);
  assert.match(visible, /折算总分权重 1\.5% · 已包含在父项，不另加权/);
  assert.match(visible, /年初累计同比连续评分曲线/);
  assert.match(visible, /最新单月同比连续评分曲线/);
  assert.match(visible, /3\.12 分/);
  assert.match(visible, /3\.08 分/);
  assert.match(visible, /各子项折算权重合计为父项 2\.5%，不另加总权重/);
  assert.match(html, /<details class="macro-rating-row-evidence"><summary>完整评分依据与核验要求/);
  assert.doesNotMatch(visible, /quarterYoyChange|三个月景气变化评分分量/);
});

test("missing or rejected component evidence stays visible as pending without invented subitem scores", () => {
  const ui = loadUi({ frameworkUpdate: dualFramework, currentUpdate(current) {
    current.observations.G01 = dualObservation();
    current.observations.G01.value = null;
  }, pointsById: { G01: null }, componentDetailsById: { G01: dualDetails() } });
  const visible = withoutClosedDetails(render(ui.MacroRatingInputs, { onViewStandard() {} }));
  const children = componentRows(visible, "G01");
  assert.equal(children.length, 2);
  assert.match(children[0], /5\.3%/);
  assert.match(children[1], /<td>—<small>当月可比同比/);
  for (const row of children) {
    assert.match(row, /待核验，不计分/);
    assert.doesNotMatch(row, /3\.12 分|3\.08 分|NaN|Infinity/);
  }
  const mismatch = render(ui.MacroVisibleScoreComponents, { item: ui.framework.indicators.find((item) => item.id === "G01"), observation: dualObservation(),
    details: { components: [{ key: "yearToDateGrowth", value: 99, weight: .4, points: 5 }] } });
  assert.doesNotMatch(mismatch, /5\.00 分/);
});

test("history renders dual components only from its frozen framework, raw inputs and saved scores without rewriting older records", () => {
  const ui = loadUi({ frameworkUpdate: dualFramework, currentUpdate: dualCurrent, historyUpdate(history, framework, current) {
    const latest = history.snapshots[0];
    latest.framework = structuredClone(framework);
    latest.rows = [{ id: "G01", name: "冻结工业原值", weight: .025, points: 3.096, observation: structuredClone(current.observations.G01), scoringDetails: dualDetails(), gap: null }];
    const old = structuredClone(latest);
    old.version = "TEST-FROZEN-OLDER";
    delete old.framework.indicators.find((item) => item.id === "G01").displayComponents;
    old.rows[0].name = "旧版工业原值";
    old.rows[0].observation.value = 7.8;
    old.rows[0].points = 4.01;
    history.snapshots.unshift(old);
    framework.indicators.find((item) => item.id === "G01").weight = .099; // Must not leak into frozen history.
    current.observations.G01.value = 9.9;
  } });
  const before = JSON.stringify(ui.history);
  const html = render(ui.MacroRatingHistory);
  assert.equal([...html.matchAll(/data-macro-component=/g)].length, 2);
  assert.match(html, /冻结工业原值/);
  assert.match(html, /旧版工业原值/);
  assert.match(html, /7\.8%/);
  assert.match(html, /4\.01 分/);
  assert.match(html, /<strong>1%<\/strong>/);
  assert.match(html, /<strong>1\.5%<\/strong>/);
  assert.match(html, /3\.12 分/);
  assert.match(html, /3\.08 分/);
  assert.doesNotMatch(html, /9\.9%|3\.96%|5\.94%/);
  assert.equal(JSON.stringify(ui.history), before);
});

test("pending dual-basis proposals are visible plans, not score rows, coverage gaps or extra summary sections", () => {
  const ui = loadUi({ frameworkUpdate(framework) {
    framework.dualBasisReview = { pending: [{ id: "G03", name: "待补商品房销售面积标记", proposedAllocation: "累计40% / 最新单月60%", reason: "同版单月可比原值待补标记" }] };
  } });
  for (const html of [render(ui.MacroRatingInputs, { onViewStandard() {} }), render(ui.MacroRatingIndicators, { selectedRuleId: "E01" })]) {
    const visible = withoutClosedDetails(html);
    assert.match(visible, /双口径计划未启用清单/);
    assert.match(visible, /待补商品房销售面积标记/);
    assert.match(visible, /累计40% \/ 最新单月60%/);
    assert.match(visible, /同版单月可比原值待补标记/);
    assert.match(visible, /现有可核验口径及其得分继续保留/);
    assert.doesNotMatch(visible, /原值待核验 1 项/);
  }
  assert.doesNotMatch(render(ui.MacroRatingSummary), /计划未启用|待补商品房销售面积标记/);
  assert.equal(ui.result.coverage, 1);
  assert.equal(ui.framework.indicators.length, actualFramework.indicators.length);
});

const loanDualComponents = [
  { key: "yearToDateMoreIncrease", label: "年初累计同比多增或少增", weight: .4, unit: "亿元", anchorUnit: "亿元/月", scoreTransform: "calendar-month-average", basis: "年初累计新增中长期贷款同比多增少增", input: "observation.scoringInputs.yearToDateMoreIncrease", anchors: [[-2500, 1], [0, 3], [2500, 5]] },
  { key: "latestMonthMoreIncrease", label: "最新单月同比多增或少增", weight: .6, unit: "亿元", anchorUnit: "亿元", basis: "当月新增中长期贷款同比多增少增", input: "observation.scoringInputs.latestMonthMoreIncrease", anchors: [[-1000, 1], [0, 3], [1000, 5]] },
];
function loanDualFramework(framework) {
  framework.pillars = { 金融信贷: .2, 经济运行: .25, 增长动力: .4, 宏观调控: .15 };
  framework.indicators.forEach((item) => { delete item.displayComponents; });
  for (const id of ["F01", "F02"]) {
    const rule = framework.indicators.find((item) => item.id === id);
    rule.name = id === "F01" ? "居民中长期贷款双口径同比多增少增" : "企事业单位中长期贷款双口径同比多增少增";
    rule.displayComponents = true;
    rule.unit = "亿元";
    rule.weight = id === "F01" ? .025 : .035;
    rule.scoring = { method: "weighted-components", dualBasis: "loan-year-to-date-and-latest-month",
      description: "年初累计40%、最新单月60%，分别计算同比多增少增金额，不包含滚动第三分量。", components: structuredClone(loanDualComponents) };
  }
}
const loanDualObservation = (id) => ({ ...record(`${id}保留的近3月主值`, id === "F01" ? -693 : 615, "亿元"), period: "2026-08", verified: true,
  sourceUrl: "https://www.pbc.gov.cn/retained-monthly-release.html", scoringInputs: {
    yearToDateMoreIncrease: { ...record("累计新增同比多增少增金额", id === "F01" ? -10612 : -17400, "亿元"), period: "2026-08", basis: "年初累计新增中长期贷款同比多增少增", sourceUrl: "https://www.pbc.gov.cn/annual-cumulative-source.html", verified: true },
    latestMonthMoreIncrease: { ...record("单月新增同比多增少增金额", -891, "亿元"), period: "2026-08", basis: "当月新增中长期贷款同比多增少增", sourceUrl: "https://www.pbc.gov.cn/latest-month-source.html", verified: true },
  } });
const loanDualDetails = (id = "F01") => ({ points: 2.02, components: [
  { key: "yearToDateMoreIncrease", value: id === "F01" ? -10612 : -17400, scoreValue: id === "F01" ? -1326.5 : -2175,
    scoreUnit: "亿元/月", scoreTransform: "calendar-month-average", points: 2.20, weight: .4 },
  { key: "latestMonthMoreIncrease", value: -891, points: 1.90, weight: .6 },
] });
function loanDualCurrent(current) {
  for (const id of ["F01", "F02"]) current.observations[id] = loanDualObservation(id);
}

test("loan amount dual-basis rows expose four visible subitems and isolate retained three-month values from new scores", () => {
  const ui = loadUi({ frameworkUpdate: loanDualFramework, currentUpdate: loanDualCurrent,
    pointsById: { F01: 2.02, F02: 2.02 }, componentDetailsById: { F01: loanDualDetails("F01"), F02: loanDualDetails("F02") } });
  const before = JSON.stringify([ui.framework, ui.current]);
  const visible = withoutClosedDetails(render(ui.MacroRatingInputs, { onViewStandard() {} }));
  const children = [...visible.matchAll(/<tr[^>]*data-macro-component=[\s\S]*?<\/tr>/g)].map((entry) => entry[0]);
  assert.equal(children.length, 4);
  for (const index of [0, 2]) {
    assert.match(children[index], /年初累计同比多增或少增/);
    assert.match(children[index], /2026-01—2026-08/);
    assert.ok(children[index].includes(`${index === 0 ? -10612 : -17400}亿元`));
    assert.ok(children[index].includes(`评分输入：${index === 0 ? -1326.5 : -2175}亿元/月`));
    assert.match(children[index], /累计差 ÷ 已过月份（8个月）/);
    assert.match(children[index], /2\.20 分/);
    assert.match(children[index], /项内 40%/);
    assert.match(children[index], /https:\/\/www\.pbc\.gov\.cn\/annual-cumulative-source\.html/);
    assert.match(children[index + 1], /最新单月同比多增或少增/);
    assert.match(children[index + 1], /<td>2026-08<\/td>/);
    assert.match(children[index + 1], /-891亿元/);
    assert.match(children[index + 1], /1\.90 分/);
    assert.match(children[index + 1], /项内 60%/);
    assert.match(children[index + 1], /https:\/\/www\.pbc\.gov\.cn\/latest-month-source\.html/);
  }
  for (const [index, expected] of ["1%", "1.5%", "1.4%", "2.1%"].entries()) assert.ok(children[index].includes(`<strong>${expected}</strong>`));
  for (const child of children) assert.doesNotMatch(child, /-693亿元|615亿元|10612%|17400%|891%|近3月/);
  assert.match(visible, /历史主值：-693亿元/);
  assert.match(visible, /历史主值：615亿元/);
  assert.match(visible, /历史主值仅供回溯，不参与当前双口径合成/);
  assert.match(visible, /当前计分时期见分列子项/);
  assert.equal([...visible.matchAll(/当前双口径合成分/g)].length, 2);
  assert.equal(JSON.stringify([ui.framework, ui.current]), before);
});

test("loan standards show amount-unit curves, fixed dual allocations and no third rolling component", () => {
  const ui = loadUi({ frameworkUpdate: loanDualFramework, currentUpdate: loanDualCurrent,
    pointsById: { F01: 2.02, F02: 2.02 }, componentDetailsById: { F01: loanDualDetails("F01"), F02: loanDualDetails("F02") } });
  const visible = withoutClosedDetails(render(ui.MacroRatingIndicators, { selectedRuleId: "F01" }));
  assert.match(visible, /年初累计同比多增或少增 · 固定项内权重 40%/);
  assert.match(visible, /最新单月同比多增或少增 · 固定项内权重 60%/);
  assert.match(visible, /原值评分参照点（亿元）/);
  assert.match(visible, /评分输入参照点（亿元\/月）/);
  assert.doesNotMatch(visible, /原值评分参照点（亿元\/月）/);
  assert.match(visible, /评分输入：-1326\.5亿元\/月/);
  assert.match(visible, /评分输入：-2175亿元\/月/);
  assert.match(visible, /下面横轴为评分输入（亿元\/月），不是累计原始金额/);
  assert.match(visible, /不是贷款余额或同比百分比/);
  assert.match(visible, /保留的历史近3月主值不参与本版双口径合成/);
  assert.match(visible, /-10612亿元/);
  assert.match(visible, /-17400亿元/);
  assert.match(visible, /-891亿元/);
  assert.equal([...visible.matchAll(/评分分量"/g)].length, 4);
  assert.doesNotMatch(visible, /-693亿元|615亿元|三个月均值评分分量|近3月同比评分分量/);
});

test("loan dual rows cannot borrow the retained historical main value when a new single-month component is missing", () => {
  const ui = loadUi({ frameworkUpdate: loanDualFramework, currentUpdate(current) {
    loanDualCurrent(current);
    delete current.observations.F01.scoringInputs.latestMonthMoreIncrease;
  }, pointsById: { F01: null, F02: 2.02 }, componentDetailsById: { F01: loanDualDetails("F01"), F02: loanDualDetails("F02") } });
  const visible = withoutClosedDetails(render(ui.MacroRatingInputs, { onViewStandard() {} }));
  const children = [...visible.matchAll(/<tr[^>]*data-macro-component=[\s\S]*?<\/tr>/g)].map((entry) => entry[0]);
  assert.equal(children.length, 4);
  assert.match(children[0], /-10612亿元/);
  assert.match(children[0], /评分输入：待核验，不补算/);
  assert.match(children[0], /待核验，不计分/);
  assert.match(children[1], /<td>待核验<\/td>/);
  assert.match(children[1], /<td>—<small>当月新增中长期贷款同比多增少增/);
  assert.match(children[1], /待核验，不计分/);
  assert.doesNotMatch(children[1], /-693亿元|1\.90 分|2\.02 分/);
  assert.match(children[2], /2\.20 分/);
  assert.match(children[3], /1\.90 分/);
});

test("loan history labels preserved main values only for the frozen dual-basis rule and keeps old single-rule scores untouched", () => {
  const ui = loadUi({ frameworkUpdate: loanDualFramework, currentUpdate: loanDualCurrent, historyUpdate(history, framework, current) {
    const latest = history.snapshots[0];
    latest.framework = structuredClone(framework);
    latest.rows = [{ id: "F01", name: "新版居民贷款快照", weight: .025, points: 2.02, gap: null,
      observation: structuredClone(current.observations.F01), scoringDetails: loanDualDetails() }];
    const old = structuredClone(latest); old.version = "TEST-LEGACY-LOAN";
    const oldRule = old.framework.indicators.find((item) => item.id === "F01");
    delete oldRule.displayComponents;
    oldRule.scoring = { method: "piecewise-linear", anchors: [[-1000, 1], [0, 3], [1000, 5]] };
    old.rows[0].name = "旧版居民贷款快照";
    old.rows[0].points = 2.31;
    delete old.rows[0].scoringDetails;
    history.snapshots.unshift(old);
    current.observations.F01.value = 999777;
  } });
  const before = JSON.stringify(ui.history);
  const html = render(ui.MacroRatingHistory);
  assert.equal([...html.matchAll(/data-macro-component=/g)].length, 2);
  assert.equal([...html.matchAll(/历史主值：/g)].length, 1);
  assert.match(html, /新版居民贷款快照/);
  assert.match(html, /旧版居民贷款快照/);
  assert.match(html, /2\.31 分/);
  assert.match(html, /-10612亿元/);
  assert.match(html, /评分输入：-1326\.5亿元\/月/);
  assert.match(html, /-891亿元/);
  assert.doesNotMatch(html, /999777/);
  assert.equal(JSON.stringify(ui.history), before);
});

test("normalized loan score inputs require the saved unit, transform and calendar divisor to match the unchanged original amount", () => {
  const ui = loadUi({ frameworkUpdate: loanDualFramework, currentUpdate: loanDualCurrent });
  const item = ui.framework.indicators.find((rule) => rule.id === "F01");
  const observation = loanDualObservation("F01");
  const corruptions = [
    (part) => { part.scoreValue = part.value; },
    (part) => { part.scoreUnit = "亿元"; },
    (part) => { part.scoreTransform = "rolling-three-month-average"; },
    (part) => { delete part.scoreValue; },
    (part) => { part.scoreValue = NaN; },
    (part) => { delete part.value; },
  ];
  for (const corrupt of corruptions) {
    const details = loanDualDetails();
    corrupt(details.components[0]);
    const html = render(ui.MacroVisibleScoreComponents, { item, observation, details });
    const cumulative = html.match(/<tr[^>]*data-macro-component="yearToDateMoreIncrease"[\s\S]*?<\/tr>/)?.[0];
    assert.ok(cumulative);
    assert.match(cumulative, /-10612亿元/);
    assert.match(cumulative, /评分输入：待核验，不补算/);
    assert.match(cumulative, /待核验，不计分/);
    assert.doesNotMatch(cumulative, /2\.20 分|评分输入：-10612亿元\/月|NaN|Infinity/);
  }
  const wrongMonth = structuredClone(observation);
  wrongMonth.scoringInputs.yearToDateMoreIncrease.period = "2026-07";
  const mismatch = render(ui.MacroVisibleScoreComponents, { item, observation: wrongMonth, details: loanDualDetails() });
  assert.match(mismatch, /累计差 ÷ 已过月份（7个月）/);
  assert.match(mismatch, /评分输入：待核验，不补算/);
  assert.doesNotMatch(mismatch, /评分输入：-1326\.5亿元\/月/);
  const badUnit = structuredClone(item);
  badUnit.scoring.components[0].anchorUnit = "亿元";
  const standard = render(ui.MacroRuleScoring, { item: badUnit, observation, details: loanDualDetails() });
  assert.match(standard, /复合评分方法待核验/);
  assert.doesNotMatch(standard, /评分输入参照点|固定项内权重 40%/);
});

const actualCompositeDetails = Object.fromEntries(actualFramework.indicators.filter((rule) => rule.scoring.method === "weighted-components")
  .map((rule) => [rule.id, continuousScoreDetails(rule, actualCurrent.observations[rule.id], actualCurrent.asOf)]));
const actualPoints = Object.fromEntries(actualFramework.indicators.map((rule) => [rule.id,
  actualScoreIndicator(rule, actualCurrent.observations[rule.id], actualCurrent.asOf, actualFramework.freshness)]));
function actualObservationFixture(current) { current.observations = structuredClone(actualCurrent.observations); }

test("all quantitative composite inputs expose every component and parent formula without display flags or expanded details", () => {
  const compositeRules = actualFramework.indicators.filter((rule) => rule.scoring.method === "weighted-components");
  let seenComponents = 0, seenFormulas = 0;
  for (const pillar of Object.keys(actualFramework.pillars)) {
    const ui = loadUi({ frameworkUpdate(framework) {
      framework.pillars = Object.fromEntries([pillar, ...Object.keys(framework.pillars).filter((name) => name !== pillar)].map((name) => [name, framework.pillars[name]]));
      // The input presentation no longer depends on the formerly opt-in flag.
      framework.indicators.forEach((rule) => { delete rule.displayComponents; });
    }, currentUpdate: actualObservationFixture, pointsById: actualPoints, componentDetailsById: actualCompositeDetails });
    const before = JSON.stringify([ui.framework, ui.current, ui.history, ui.result]);
    const visible = withoutClosedDetails(render(ui.MacroRatingInputs, { onViewStandard() {} }));
    const expected = compositeRules.filter((rule) => rule.pillar === pillar);
    for (const rule of expected) {
      const rows = componentRows(visible, rule.id);
      assert.equal(rows.length, rule.scoring.components.length, rule.id);
      for (const [index, component] of rule.scoring.components.entries()) {
        const input = component.input === "observation.value" ? actualCurrent.observations[rule.id] : actualCurrent.observations[rule.id].scoringInputs[component.key];
        const saved = actualCompositeDetails[rule.id].components.find((part) => part.key === component.key);
        assert.ok(rows[index].includes(component.label), `${rule.id} ${component.key} label`);
        assert.ok(rows[index].includes(`${String(Number(input.value.toPrecision(10)))}${input.unit}`), `${rule.id} ${component.key} original`);
        assert.ok(rows[index].includes(`${ui.formatScore(saved.points)} 分`), `${rule.id} ${component.key} score`);
        assert.ok(rows[index].includes(`项内 ${displayWeight(component.weight)} · 已包含在父项`));
        assert.ok(rows[index].includes(`<strong>${displayWeight(rule.weight * component.weight)}</strong>`));
        assert.ok(rows[index].includes(`href="${input.sourceUrl}"`), `${rule.id} ${component.key} source`);
        assert.doesNotMatch(rows[index], /<details|待核验，不计分/);
      }
      const formulaRow = visible.match(new RegExp(`<tr data-macro-formula="${rule.id}"[\\s\\S]*?<\\/tr>`))?.[0];
      assert.ok(formulaRow, rule.id);
      assert.match(formulaRow, /合成公式/);
      assert.ok(formulaRow.includes(`＝ ${ui.formatScore(actualPoints[rule.id])} 分`), rule.id);
      assert.match(formulaRow, /按未舍入分量合成/);
      assert.doesNotMatch(formulaRow, /合成待核验|不展示完整数值算式/);
      seenComponents += rows.length;
      seenFormulas += 1;
    }
    assert.doesNotMatch(visible, /复合原值与分量曲线见对应评分标准；不以单个总观测值代替/);
    assert.equal(JSON.stringify([ui.framework, ui.current, ui.history, ui.result]), before);
  }
  assert.equal(seenFormulas, compositeRules.length);
  assert.equal(seenComponents, compositeRules.reduce((sum, rule) => sum + rule.scoring.components.length, 0));
});

test("GDP and deflator composite rows keep actual component periods, units and distinctions rather than copying the headline quarter", () => {
  const ui = loadUi();
  const deflatorRule = actualFramework.indicators.find((rule) => rule.id === "E07");
  const deflator = render(ui.MacroScoreComponentRows, { item: deflatorRule, observation: actualCurrent.observations.E07,
    details: actualCompositeDetails.E07, allComponents: true });
  const rows = componentRows(deflator, "E07");
  assert.equal(rows.length, 3);
  assert.match(rows[0], /<td>2026-Q2<\/td>/);
  assert.match(rows[1], /<td>2026-Q1<\/td>/);
  assert.match(rows[2], /<td>2025-Q4<\/td>/);
  assert.match(rows[0], /项内 70%/);
  assert.match(rows[1], /项内 15%/);
  assert.match(rows[2], /项内 15%/);
  assert.doesNotMatch(rows[1], /<td>2026-Q2<\/td>/);
  assert.doesNotMatch(rows[2], /<td>2026-Q2<\/td>/);
  const gdpRule = actualFramework.indicators.find((rule) => rule.id === "E01");
  const gdp = render(ui.MacroScoreComponentRows, { item: gdpRule, observation: actualCurrent.observations.E01,
    details: actualCompositeDetails.E01, allComponents: true });
  const change = componentRows(gdp, "E01")[1];
  assert.match(change, /<td>2026-Q1 → 2026-Q2<\/td>/);
  assert.match(change, /-0\.7百分点/);
  assert.match(change, /同比增速较前季变动，不是实际GDP季调环比/);
  assert.doesNotMatch(change, /-0\.7%/);
});

test("PMI composite rows identify the real three-month level window and the two nonoverlapping windows in index points", () => {
  const ui = loadUi();
  for (const id of ["E08", "E09", "G11"]) {
    const rule = actualFramework.indicators.find((item) => item.id === id);
    const html = render(ui.MacroScoreComponentRows, { item: rule, observation: actualCurrent.observations[id],
      details: actualCompositeDetails[id], allComponents: true });
    const rows = componentRows(html, id);
    assert.equal(rows.length, 2, id);
    assert.match(rows[0], /<td>2026-07—2026-09<\/td>/);
    assert.match(rows[1], /<td>2026-04—2026-06 → 2026-07—2026-09<\/td>/);
    assert.match(rows[0], /指数点/);
    assert.match(rows[1], /指数点/);
    assert.doesNotMatch(rows[0], /<td>2026-09<\/td>/);
    assert.doesNotMatch(rows[1], /<td>2026-09<\/td>/);
  }
});

test("incomplete or contradictory composite evidence never produces a complete numeric parent formula", () => {
  const ui = loadUi();
  const item = actualFramework.indicators.find((rule) => rule.id === "E07");
  const observation = structuredClone(actualCurrent.observations.E07);
  const details = structuredClone(actualCompositeDetails.E07);
  const cases = [];
  const missingInput = structuredClone(observation); delete missingInput.scoringInputs.previousQuarterPriceLevel;
  cases.push({ observation: missingInput, details, points: actualPoints.E07 });
  const missingScore = structuredClone(details); missingScore.components.pop();
  cases.push({ observation, details: missingScore, points: actualPoints.E07 });
  const wrongValue = structuredClone(details); wrongValue.components[1].value = 0;
  cases.push({ observation, details: wrongValue, points: actualPoints.E07 });
  const wrongComponentScore = structuredClone(details); wrongComponentScore.components[1].points = 5;
  cases.push({ observation, details: wrongComponentScore, points: actualPoints.E07 });
  cases.push({ observation, details, points: actualPoints.E07 + .01 });
  cases.push({ observation, details, points: null });
  for (const candidate of cases) {
    const formula = render(ui.MacroCompositeFormula, { item, ...candidate });
    assert.match(formula, /合成待核验/);
    assert.match(formula, /固定配比/);
    assert.match(formula, /不展示完整数值算式/);
    assert.doesNotMatch(formula, / ＝ |NaN|Infinity/);
  }
  const childHtml = render(ui.MacroScoreComponentRows, { item, observation: missingInput, details, allComponents: true });
  const missingRow = componentRows(childHtml, "E07")[1];
  assert.match(missingRow, /<td>待核验<\/td>/);
  assert.match(missingRow, /<td>—<small>/);
  assert.match(missingRow, /待核验，不计分/);
  assert.doesNotMatch(missingRow, /2026-Q2|1\.526649/);
});

test("input layout separates parent, compact component and numeric-composition rows without repeating long indicator names", () => {
  const ui = loadUi({ currentUpdate: actualObservationFixture, pointsById: actualPoints, componentDetailsById: actualCompositeDetails });
  const visible = withoutClosedDetails(render(ui.MacroRatingInputs, { onViewStandard() {} }));
  const pillar = Object.keys(ui.framework.pillars)[0];
  const expected = actualFramework.indicators.filter((rule) => rule.pillar === pillar);
  const parents = [...visible.matchAll(/<tr class="macro-score-parent-row">[\s\S]*?<\/tr>/g)].map((entry) => entry[0]);
  assert.equal(parents.length, expected.length);
  for (const rule of expected.filter((item) => item.scoring.method === "weighted-components")) {
    const parent = parents.find((row) => row.includes(`<strong>${rule.name}</strong>`));
    assert.ok(parent, rule.id);
    const children = componentRows(visible, rule.id);
    assert.equal(children.length, rule.scoring.components.length);
    for (const child of children) {
      assert.match(child, /class="macro-score-component-row"/);
      assert.match(child, /<small>计分子项<\/small>/);
      assert.ok(child.includes(`aria-label="${rule.name} · `));
      assert.ok(!child.replace(/<[^>]*>/g, "").includes(rule.name), rule.id);
    }
    const formula = visible.match(new RegExp(`<tr data-macro-formula="${rule.id}" class="macro-score-formula-row">[\\s\\S]*?<\\/tr>`))?.[0];
    assert.ok(formula, rule.id);
    assert.match(formula, /class="macro-score-composition"/);
    assert.match(formula, /<strong>合成：<\/strong>/);
    assert.match(formula, /按未舍入分量合成，上式仅显示两位小数/);
    assert.equal([...formula.matchAll(/<p>/g)].length, 1);
    assert.doesNotMatch(formula, /固定配比|合成待核验/);
    assert.ok(!formula.replace(/<[^>]*>/g, "").includes(rule.name));
    assert.ok(visible.indexOf(parent) < visible.indexOf(children[0]));
    assert.ok(visible.indexOf(children.at(-1)) < visible.indexOf(formula));
  }
});

test("compact composition layout retains fixed allocations and explicit limits when a component is missing", () => {
  const ui = loadUi();
  const item = actualFramework.indicators.find((rule) => rule.id === "E07");
  const observation = structuredClone(actualCurrent.observations.E07);
  delete observation.scoringInputs.previousQuarterPriceLevel;
  const html = render(ui.MacroCompositeFormula, { item, observation, details: actualCompositeDetails.E07, points: actualPoints.E07 });
  assert.match(html, /class="macro-score-composition"/);
  assert.match(html, /<strong>合成待核验<\/strong>/);
  assert.match(html, /固定配比/);
  for (const part of item.scoring.components) assert.ok(html.includes(`${part.label}得分 × ${displayWeight(part.weight)}`));
  assert.match(html, /不展示完整数值算式、不补分或重分权/);
  assert.doesNotMatch(html, / ＝ /);
  assert.ok(!html.replace(/<[^>]*>/g, "").includes(item.name));
});

test("pending monthly supplements show the already-scored official cumulative values, periods, scores and sources without changing scoring", () => {
  const ui = loadUi({ currentUpdate: actualObservationFixture, pointsById: actualPoints, componentDetailsById: actualCompositeDetails });
  const before = JSON.stringify([ui.framework, ui.current, ui.history, ui.result]);
  const pending = ui.framework.dualBasisReview.pending;
  assert.equal(pending.length, 5);
  for (const html of [render(ui.MacroRatingInputs, { onViewStandard() {} }), render(ui.MacroRatingIndicators, { selectedRuleId: "G03" })]) {
    const section = html.match(/<section class="macro-v1-rating-note" aria-label="双口径计划未启用清单">[\s\S]*?<\/section>/)?.[0];
    assert.ok(section);
    assert.match(section, /<strong>官方累计已计分 · 单月补充待核验<\/strong>/);
    assert.match(section, /5项现已采用官方累计数据参与本期评分/);
    assert.match(section, /这里待补仅指新增单月/);
    assert.match(section, /<th>已采用的官方累计数据<\/th>/);
    assert.match(section, /<th>新增单月待核验原因<\/th>/);
    const rows = [...section.matchAll(/<tr[^>]*data-macro-pending=[\s\S]*?<\/tr>/g)].map((entry) => entry[0]);
    assert.equal(rows.length, pending.length);
    for (const item of pending) {
      const rule = ui.framework.indicators.find((entry) => entry.id === item.id);
      const observation = ui.current.observations[item.id];
      const row = rows.find((entry) => entry.includes(`data-macro-pending="${item.id}"`));
      assert.ok(row, item.id);
      assert.ok(row.includes(`<strong>${String(Number(observation.value.toPrecision(10)))}${rule.unit}</strong>`));
      assert.ok(row.includes(`年初累计 · ${observation.period.slice(0, 4)}-01—${observation.period}`));
      assert.ok(row.includes(`${ui.formatScore(actualPoints[item.id])} 分，已参与本期评分`));
      assert.ok(row.includes(`href="${observation.sourceUrl}"`));
      assert.match(row, /官方累计原文 ↗/);
      assert.ok(row.includes(`发布 ${observation.releaseDate}`));
      assert.ok(row.includes(`现有总分权重 ${displayWeight(rule.weight)}`));
      assert.ok(row.includes(item.proposedAllocation));
      assert.match(row, /待核验，未用于计分/);
      assert.match(row, /新增单月：/);
      assert.doesNotMatch(row, /data-macro-component|计划未启用|单月值：0|缺失单月：0/);
    }
    assert.doesNotMatch(section.replace(/<[^>]*>/g, ""), /待补双口径 · 计划未启用/);
  }
  assert.equal(JSON.stringify([ui.framework, ui.current, ui.history, ui.result]), before);
  assert.equal(ui.result.coverage, 1);
});

test("pending supplement proposals do not fill missing cumulative observations or claim that an unverified row is already scored", () => {
  const ui = loadUi({ currentUpdate(current) {
    actualObservationFixture(current);
    current.observations.G03 = null;
  }, pointsById: { ...actualPoints, G03: null }, componentDetailsById: actualCompositeDetails });
  const before = JSON.stringify([ui.framework, ui.current, ui.history, ui.result]);
  const html = render(ui.MacroRatingInputs, { onViewStandard() {} });
  const section = html.match(/<section class="macro-v1-rating-note" aria-label="双口径计划未启用清单">[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.match(section, /4项现已采用官方累计数据参与本期评分/);
  const missing = section.match(/<tr[^>]*data-macro-pending="G03"[\s\S]*?<\/tr>/)?.[0];
  assert.ok(missing);
  assert.match(missing, /尚无可展示的已核验累计观测，不补原值或得分/);
  assert.match(missing, /待核验，未用于计分/);
  assert.doesNotMatch(missing, /分，已参与本期评分|0\.00 分|<strong>0%|官方累计原文 ↗/);
  assert.equal(ui.current.observations.G03, null);
  assert.equal(JSON.stringify([ui.framework, ui.current, ui.history, ui.result]), before);
});
