import fs from "node:fs";
import assert from "node:assert/strict";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";
import { continuousScoreDetails } from "../lib/macro-scoring-continuous.mjs";

const path = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(path(name), "utf8"));
const write = (name, value) => fs.writeFileSync(path(name), JSON.stringify(value, null, 2) + "\n");
const shown = (value) => Number(value.toFixed(2));
const files = { framework: "app/data/macro-rating-v1.json", current: "app/data/macro-rating-current.json", history: "app/data/macro-rating-history.json" };
assert.equal(read(files.framework).version, "V1.19", "This one-time migration must not roll back an already published version");
const backups = Object.fromEntries(Object.keys(files).map((key) => [key, `deliverables/macro-rating-${key}-before-v1-20-2026-10-11.json`]));
for (const key of Object.keys(files)) if (!fs.existsSync(path(backups[key]))) fs.copyFileSync(path(files[key]), path(backups[key]));
const before = read(backups.framework), oldCurrent = read(backups.current);
assert.equal(before.version, "V1.19");
assert.equal(oldCurrent.version, before.version);
if (process.argv.includes("--freeze-only")) {
  console.log("V1.19 framework, observations and history frozen; current data unchanged.");
  process.exit(0);
}
assert.deepEqual(read(files.framework), before, "Do not overwrite another writer's framework");
assert.deepEqual(read(files.current), oldCurrent, "Do not overwrite another writer's observations");
const evidence = read("deliverables/macro-dual-basis-v1-20-evidence.json");
assert.equal(evidence.asOf, oldCurrent.asOf);
const evidenceItem = (id) => evidence.items.find((item) => item.id === id);
const framework = structuredClone(before), current = structuredClone(oldCurrent);
const plans = {
  G01: { cumulativeWeight: .4, cumulativeBasis: "年初累计实际同比", series: "industrialValueAdded" },
  G17: { cumulativeWeight: .4, cumulativeBasis: "年初累计名义同比", series: "goodsRetailSales" },
  G10: { cumulativeWeight: .5, cumulativeBasis: "年初累计美元金额同比", series: "goodsExportsUsd" },
  P01E: { cumulativeWeight: .4, cumulativeBasis: "全国年初累计支出可比同比", series: "全国一般公共预算支出", fiscal: true },
  P01F: { cumulativeWeight: .6, cumulativeBasis: "全国年初累计支出可比同比", series: "全国政府性基金预算支出", fiscal: true },
};
const enabledIds = [...Object.keys(plans), "G02"];
for (const [id, plan] of Object.entries(plans)) {
  const rule = framework.indicators.find((item) => item.id === id);
  const previous = before.indicators.find((item) => item.id === id);
  const observation = current.observations[id];
  const inputKey = plan.fiscal ? "latestMonthGrowth" : "yearToDateGrowth";
  const input = evidenceItem(id)?.[inputKey];
  assert.ok(input?.verified, `${id}: extra official evidence required`);
  assert.equal(input.period, observation.period);
  assert.equal(input.unit, "%");
  assert.equal(input.basis, plan.fiscal ? "全国当月支出金额同比" : plan.cumulativeBasis);
  observation.scoringInputs = { ...observation.scoringInputs, [inputKey]: structuredClone(input) };
  observation.series = plan.series;
  const monthLabel = plan.fiscal ? "最新单月支出金额同比（官方金额复算）" : "最新单月同比";
  rule.displayComponents = true;
  rule.scoring = {
    method: "weighted-components", dualBasis: "year-to-date-and-latest-month",
    components: [
      { key: "yearToDateGrowth", label: "年初累计同比", weight: plan.cumulativeWeight,
        unit: "%", basis: plan.cumulativeBasis, anchors: structuredClone(previous.scoring.anchors),
        input: plan.fiscal ? "observation.value" : "observation.scoringInputs.yearToDateGrowth" },
      { key: "latestMonthGrowth", label: monthLabel, weight: 1 - plan.cumulativeWeight,
        unit: "%", basis: plan.fiscal ? "全国当月支出金额同比" : previous.measurementBasis,
        anchors: structuredClone(previous.scoring.anchors),
        input: plan.fiscal ? "observation.scoringInputs.latestMonthGrowth" : "observation.value" },
    ],
    description: `年初累计与最新单月分别按公开曲线计分，再按${plan.cumulativeWeight * 100}%/${(1 - plan.cumulativeWeight) * 100}%合成；不是平均原始同比。总分权重${shown(rule.weight * 100)}%不变，累计与单月作为两条直接可见子项列示；未增加近三个月评分层。`,
  };
  if (plan.fiscal) rule.name = id === "P01E" ? "全国一般公共预算支出同比（累计＋当月）" : "全国政府性基金预算支出同比（累计＋当月）";
  rule.definition = previous.definition + " " + rule.scoring.description + (plan.fiscal
    ? "主原值仍是财政部直接公布的累计可比同比；当月同比由两年同月及上月同范围累计金额分别差分后相除，保留四端原值、官方累计增长率交叉检查及修订限制，不能将两个累计增速相减。名义支出不是净财政冲量或实际经济改善。"
    : "补充累计同比须来自同一期同范围官方原表，不用累计增速相减估算当月；商品零售不换成社零总额，美元出口不换成人民币口径。" );
  rule.scoringBasis = `累计口径保留年内背景，最新单月提高边际变化的可见性。固定${plan.cumulativeWeight * 100}%/${(1 - plan.cumulativeWeight) * 100}%为已确认的研究试行配比，分别计分再加权，沿用本指标现有曲线以隔离本轮配比变化；累计与当月高度相关，子项不新增父项总权重，也不称独立信号。`;
  rule.thresholdStatus = "研究试行：双口径配比及累计/单月共用参考曲线尚未完成联合历史校准与样本外检验，不称最优权重或已验证预警效果。" + (plan.fiscal ? "单月使用刊载金额推算，未发现统一重修订版声明，口径改动时须重新核验。" : "累计值不能代替最新单月；官方合并发布期不拆分。" );
  rule.requirements = [...previous.requirements,
    "双口径统计月、原发布方、全国范围、单位及指标序列须一致；新增原值保存period、latestAvailablePeriod、sourceUrl、releaseDate、verifiedAt、verified、basis、series与原表证据。",
    plan.fiscal ? "单月金额同比保留本年/上年同月与上月四个官方累计金额；同年连续月份、相同预算范围、当月金额正值且两端官方累计同比与金额比率交叉核对。当前双口径仅3—12月支持单月金额差分；1—2月官方合并期保留累计观察，合并期双组件计分尚未实现，不能拆造一月或二月独立值；跨年累计差分、缺月、范围混用和修订冲突均拒绝。"
      : "累计新增输入保存同表reportedMonthlyYoyPct与reportedCumulativeYoyPct，必须分别与主当月值和新增累计值一致；不把年初平均价格指数、存量同比或不同统计范围冒充累计流量。",
    "累计和单月在指标页直接分行列示：数值、统计期、分量得分、项内比例及折算宏观总分权重；父项总权重仅计一次。缺少必需口径不认证完整父项分，不自动重配。",
  ];
  rule.grades = [1, 2, 3, 4, 5].map((points) => rule.scoring.components.flatMap((part) => part.anchors.filter(([, score]) => score === points)
    .map(([value]) => `${part.label}：${value}%对应${points}分`)).join("；") + "；父项按固定累计/当月得分配比合成，非原值平均。");
  rule.calibration = { ...previous.calibration, version: "V1.20", decision: "增加可见双口径", reason: rule.scoringBasis,
    sampleSummary: "本期官方双口径证据复算；不是完整历史回测", limitations: [rule.thresholdStatus], comparisons: [] };
  if (id === "G17") rule.definition = rule.definition.replace("但两者仍是当月与年初累计不同节奏", "商品零售已同列累计与单月，服务零售仍为累计口径");
}

const profit = framework.indicators.find((item) => item.id === "G02");
profit.displayComponents = true;
const profitWeights = { cumulativeComparableProfitGrowth: .3, officialCurrentMonthComparableProfitGrowth: .45,
  reportedProfitMarginYoyChange: .125, reportedReceivablesDaysYoyChange: .125 };
for (const part of profit.scoring.components) part.weight = profitWeights[part.key];
profit.definition = "规模以上工业企业盈利增长与质量在原4%总权重内计分：累计利润同比30%、最新单月利润同比45%、利润率同比变化12.5%、应收账款回收期同比变化12.5%，逐分量计分再加权。提高最新单月的项内比重，不增加近三个月层，四分量直接可见。主原值、四分量原始证据及参考曲线不变；行业利润改善广度另列G19，不重复计分。规上工业利润不等于全体企业或上市公司盈利。";
profit.scoring.description = profit.definition;
profit.scoringBasis = "原有累计和当月已共同计分，本轮不重复新增指标。累计从50%降至30%、最新单月从25%升至45%，质量合计25%不动；降低累计值对最新走弱或修复的掩盖，保留回款与利润率约束。配比为研究试行，未通过联合历史及样本外验证，不按本期总分倒推。";
profit.thresholdStatus = "研究试行：本轮仅调整累计/当月项内比例并直接分行展示，质量、广度总权重和参考曲线不变；单月噪声上升的代价仍需历史检验。";
profit.calibration = { ...profit.calibration, version: "V1.20", decision: "增加当月比重与可见子项", reason: profit.scoringBasis,
  sampleSummary: "本期四原值不变，固定配比敏感性比较；非历史或预警验证", limitations: [profit.thresholdStatus], comparisons: [] };

framework.version = current.version = "V1.20";
framework.versionDate = current.asOf;
framework.status = "V1.20可见双口径：工业增加值、商品零售、美元出口及两项财政支出分别展示累计和最新单月；盈利增长质量提高当月比重。仍为38项，四类25/40/20/15及父指标权重不变，历史评分全部保留；缺可比月度数据的计划未启用。";
framework.scoringMethod.calibration = "新增五项累计/最新单月双口径并提高工业利润最新单月比重，六项直接展示分量原值、得分与折算总权重；参考曲线不改，不增加滚动近三个月评分层。未就绪项保留现行方法，本轮为固定证据的研究试行，不宣称历史最优。";
framework.calibrationReview = { ...framework.calibrationReview, reviewedCount: 38, indicatorCount: 38, adjustedCount: 6, retainedCount: 32,
  summary: "38项双向口径复核 · 5项新增双口径 · 1项提高当月比重 · 其余保留", scope: framework.status, method: framework.scoringMethod.calibration };
framework.dualBasisReview = {
  version: "V1.20", enabledIds, allocationOrder: "累计得分 / 最新单月得分", noNewRollingWindow: true,
  pending: [
    { id: "G03", name: "商品房销售面积", proposedAllocation: "40% / 60%", reason: "未取得修订后可比单月同比或完整可比金额；原累计计分保留，计划未启用。" },
    { id: "G14", name: "房地产开发投资", proposedAllocation: "60% / 40%", reason: "上年基数修订，不能用分别刊载的旧金额机械拆单月；原累计计分保留。" },
    { id: "G07", name: "制造业投资", proposedAllocation: "60% / 40%", reason: "当前只有可靠累计同比，未取得可比单月原值；计划未启用。" },
    { id: "G13", name: "基础设施投资", proposedAllocation: "60% / 40%", reason: "须保持含电力、热力、燃气及水的现行范围，尚缺同范围可比单月数据。" },
    { id: "G16", name: "扣除房地产开发的民间投资", proposedAllocation: "60% / 40%", reason: "须用扣除房地产的同范围原值，不能换成民间投资总量；缺单月可比数据。" },
    { id: "F01", name: "居民中长期新增贷款", proposedAllocation: "待核验40% / 60%", reason: "累计/当月需比较同比多增少增金额，不用零或负新增额作比率分母；两期原值和独立金额尺度尚待校准，保留现行方法。" },
    { id: "F02", name: "企（事）业单位中长期新增贷款", proposedAllocation: "待核验40% / 60%", reason: "不套用居民或近三个月的金额阈值；原值和累计/单月独立尺度仍需核验，计划未启用。" },
  ],
  retained: [
    { ids: ["G12", "G19"], reason: "服务零售与行业利润改善广度尚缺完整可比单月证据，保留现有累计口径，不伪造单月。" },
    { ids: ["E01", "E07"], reason: "GDP与平减指数保留既有季度/持续性方法，不重复加累计层。" },
    { ids: ["E02", "E03", "E04", "E05", "E08", "E09", "G18", "F04", "F07", "F08", "F09", "F10"], reason: "价格平均指数、失业率、PMI、存量、杠杆率等不按可加总流量硬造年初累计同比。" },
  ],
};
current.reviewSummary = framework.status + " 原有主观测值与信息截止日不变；新口径来自同一期官方原表补充或四端金额复算，不代表当日新增宏观发布。子项权重从父项拆分，仅计一次，版本记录只追加不覆盖。";
current.sourceStatus = "本期38项均沿用或补充官方原始发布核验；五项新增双口径与工业利润配比修订按V1.20计分。财政当月由四端金额推算，保留可比范围和未统一重修订版局限；房地产、投资及贷款后续计划未启用，不以缺失数据补造评分。";
current.evidenceLimitations.push({ items: enabledIds, reason: "双口径项内权重及共用原有曲线为研究试行；累计与单月相关，月度噪声更大。本期完整复算不是联合历史或样本外验证。" });
current.evidenceLimitations.push({ items: ["P01E", "P01F"], reason: "财政单月同比由官方金额差分推算，不是财政部直接公布的单月可比同比；官方累计比率交叉核对匹配舍入，仍未发现四期统一重修订版声明，未来口径修订须重核。" });
const oldResult = evaluateMacroRating(before, oldCurrent);
for (const id of enabledIds) {
  const rule = framework.indicators.find((item) => item.id === id), observation = current.observations[id];
  const details = continuousScoreDetails(rule, observation, current.asOf);
  assert.ok(details, `${id}: complete scoring components required`);
  observation.rationale = `${rule.scoring.description} 本期：` + details.components.map((part) => `${part.label}${shown(part.value)}${part.unit}→${shown(part.points)}分，项内${shown(part.weight * 100)}%，折算宏观总权重${shown(part.weight * rule.weight * 100)}%`).join("；") + `；合成${shown(details.points)}分。原主值及统计期不变，得分差异来自新增口径与项内配比，不代表经济当日变化。`;
  if (["P01E", "P01F"].includes(id)) observation.reason = "累计采用财政部公布同比；最新单月按同范围四端金额差分复算，两者分别计分再加权，不将预算执行比例当作同比。";
}
const result = evaluateMacroRating(framework, current);
assert.equal(result.status, "正式");
assert.equal(result.coverage, 1);
assert.equal(framework.indicators.length, before.indicators.length);
assert.deepEqual(framework.pillars, before.pillars);
assert.deepEqual(framework.ratingBands, before.ratingBands);
assert.deepEqual(framework.freshness, before.freshness);
const comparisonRows = framework.indicators.map((rule) => {
  const previous = before.indicators.find((item) => item.id === rule.id), observation = current.observations[rule.id];
  assert.equal(rule.weight, previous.weight);
  for (const key of ["value", "period", "unit", "basis", "sourceUrl", "releaseDate", "verifiedAt", "originalPublisher", "latestAvailablePeriod"])
    assert.deepEqual(observation[key], oldCurrent.observations[rule.id][key], `${rule.id}: original ${key} unchanged`);
  const previousScore = scoreIndicator(previous, oldCurrent.observations[rule.id], current.asOf, before.freshness);
  const currentScore = scoreIndicator(rule, observation, current.asOf, framework.freshness);
  assert.notEqual(currentScore, null);
  if (!enabledIds.includes(rule.id)) {
    assert.deepEqual(rule, previous, `${rule.id}: unrelated rule unchanged`);
    assert.deepEqual(observation, oldCurrent.observations[rule.id], `${rule.id}: unrelated observation unchanged`);
    assert.equal(currentScore, previousScore);
  }
  return { id: rule.id, name: rule.name, previousScore, currentScore, weight: rule.weight,
    previousWeight: previous.weight, currentWeight: rule.weight,
    contributionChange: (currentScore - previousScore) * rule.weight,
    reason: enabledIds.includes(rule.id) ? rule.scoringBasis : "规则、原值及权重未变。" };
});
current.revisionComparison = { previousVersion: before.version, currentVersion: framework.version,
  kind: "同截止日增加累计/最新单月双口径与项内配比修订，不是经济变化", previousScore: oldResult.formalScore,
  currentScore: result.formalScore, rows: comparisonRows };
assert.ok(Math.abs(comparisonRows.reduce((sum, item) => sum + item.contributionChange, 0) - (result.formalScore - oldResult.formalScore)) < 1e-12);
const priorHistory = read(files.history);
assert.deepEqual(priorHistory.snapshots, read(backups.history).snapshots, "Do not overwrite records changed by another writer");
const record = createMacroRatingRecord(framework, current);
const history = { ...appendMacroRatingRecord(priorHistory, record), updatedAt: current.asOf };
assert.deepEqual(history.snapshots.slice(0, -1), priorHistory.snapshots);
write(files.framework, framework);
write(files.current, current);
write(files.history, history);
write("deliverables/macro-v1-20-score-comparison.json", current.revisionComparison);
console.log(JSON.stringify({ version: framework.version, enabledIds, count: framework.indicators.length,
  previousScore: oldResult.formalScore, score: result.formalScore, coverage: result.coverage,
  records: history.snapshots.length, pillars: result.pillars.map(({name, observedScore, weight}) => ({name, observedScore, weight})) }, null, 2));
