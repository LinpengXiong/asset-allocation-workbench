/** Fixed-budget, one-observation sensitivity disclosure, not a historical backtest. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { scoreIndicator, evaluateMacroRating } from "../lib/macro-rating.mjs";
import { continuousScoreDetails } from "../lib/macro-scoring-continuous.mjs";

const root = new URL("../", import.meta.url);
const read = async (file) => JSON.parse(await readFile(new URL(file, root), "utf8"));
const inputFiles = {
  framework: "deliverables/macro-rating-framework-before-v1-19-2026-10-11.json",
  current: "deliverables/macro-rating-current-before-v1-19-2026-10-11.json",
};
const [framework, current] = await Promise.all([read(inputFiles.framework), read(inputFiles.current)]);
assert.equal(framework.version, "V1.18", "use frozen V1.18, not the migrated shared framework");
assert.equal(current.version, "V1.18");
assert.equal(framework.indicators.length, 37);
const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value) => Number(value.toFixed(12));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const pillars = { 经济运行: .25, 增长动力: .40, 金融信贷: .20, 宏观调控: .15 };
const selectedWeights = {
  E01:.07,E02:.015,E03:.025,E04:.05,E05:.025,E07:.02,E08:.02,E09:.025,
  G01:.035,G02:.04,G19:.04,G03:.02,G14:.01,G15:.015,G07:.025,G16:.035,G13:.02,
  G17:.06,G12:.035,G10:.04,G11:.015,G18:.01,
  F01:.025,F02:.035,F07:.035,F08:.02,F09:.03,F10:.03,F05:.025,
  P01E:.035,P01F:.015,P02A:.02,P02E:.005,P02D:.025,P03A:.0125,P03B:.0125,P04A:.0125,P04B:.0125,
};
close(sum(Object.values(pillars)), 1);
close(sum(Object.values(selectedWeights)), 1);
assert.equal(Object.keys(selectedWeights).length, 38);
assert.deepEqual(Object.keys(selectedWeights).filter((id) => !framework.indicators.some((rule) => rule.id === id)), ["G19"]);
const ruleById = new Map(framework.indicators.map((rule) => [rule.id, rule]));
const baseline = evaluateMacroRating(framework, current);
assert.equal(baseline.status, "正式");
const points = Object.fromEntries(framework.indicators.map((rule) => [rule.id,
  scoreIndicator(rule, current.observations[rule.id], current.asOf, framework.freshness)]));
assert.ok(Object.values(points).every((value) => Number.isFinite(value) && value >= 1 && value <= 5));

const profitRule = ruleById.get("G02"), profitObservation = current.observations.G02;
const previousProfit = continuousScoreDetails(profitRule, profitObservation, current.asOf);
assert.equal(previousProfit.components.length, 5);
const breadthKey = "industryProfitImprovementBreadth";
const breadthPart = previousProfit.components.find((part) => part.key === breadthKey);
assert.ok(breadthPart && breadthPart.weight === .2);
const coreComponentWeights = {
  cumulativeComparableProfitGrowth:.5,
  officialCurrentMonthComparableProfitGrowth:.25,
  reportedProfitMarginYoyChange:.125,
  reportedReceivablesDaysYoyChange:.125,
};
const coreRule = clone(profitRule);
coreRule.scoring.components = coreRule.scoring.components.filter((part) => part.key !== breadthKey)
  .map((part) => ({ ...part, weight: coreComponentWeights[part.key] }));
const coreObservation = clone(profitObservation);
delete coreObservation.scoringInputs[breadthKey];
const coreProfit = continuousScoreDetails(coreRule, coreObservation, current.asOf);
assert.ok(coreProfit && coreProfit.components.length === 4);
close(sum(coreRule.scoring.components.map((part) => part.weight)), 1);
close(coreProfit.points, sum(previousProfit.components.filter((part) => part.key !== breadthKey)
  .map((part) => part.points * part.weight)) / .8);
close(scoreIndicator(coreRule, coreObservation, current.asOf, framework.freshness), coreProfit.points);
close(points.G02, previousProfit.points);
const newPoints = { ...points, G02: coreProfit.points, G19: breadthPart.points };

const rows = Object.entries(selectedWeights).map(([id, weight]) => {
  const original = ruleById.get(id);
  const observation = id === "G19" ? profitObservation.scoringInputs[breadthKey] : current.observations[id];
  return { id, name: id === "G19" ? "规模以上工业企业利润改善广度" : id === "G02"
    ? "规模以上工业企业盈利增长与质量" : original.name,
    pillar: original?.pillar ?? "增长动力", group: original?.group ?? "工业生产", weight,
    baselineWeight: original?.weight ?? 0, points: newPoints[id],
    period:observation.period, observedValue:observation.value, unit:observation.unit, basis:observation.basis,
    sourceUrl:observation.sourceUrl, releaseDate:observation.releaseDate,
    contribution: weight * newPoints[id], baselineContribution: original ? original.weight * points[id] : 0 };
});
const pillarSummary = Object.entries(pillars).map(([name, weight]) => {
  const selected = rows.filter((row) => row.pillar === name);
  close(sum(selected.map((row) => row.weight)), weight);
  return { name, weight, count:selected.length, contribution:round(sum(selected.map((row) => row.contribution))),
    normalizedScore:round(sum(selected.map((row) => row.contribution)) / weight),
    groups:[...new Set(selected.map((row) => row.group))].map((name) => ({ name,
      weight:round(sum(selected.filter((row) => row.group === name).map((row) => row.weight))) })) };
});
const selectedTotal = sum(rows.map((row) => row.contribution));
const realEstateIds = ["G03","G14","G15"], profitIds = ["G02","G19"];
const fundingRows = rows.filter((row) => row.pillar === "增长动力"
  && !realEstateIds.includes(row.id) && !profitIds.includes(row.id));
const fundingBudget = sum(fundingRows.map((row) => row.weight));
const realEstateBudget = sum(realEstateIds.map((id) => selectedWeights[id]));
close(fundingBudget, .275); close(realEstateBudget, .045);
const fundingContribution = sum(fundingRows.map((row) => row.contribution));
const fixedContribution = sum(rows.filter((row) => !fundingRows.some((item) => item.id === row.id)
  && !profitIds.includes(row.id)).map((row) => row.contribution));
const sensitivity = [];
// Nine fixed combinations: budget 6/8/10% and breadth 30/50/70% of that budget.
// The remainder of growth stays within 40%, preserving the full 4.5% real-estate block.
for (const budget of [.06,.08,.10]) for (const breadthShare of [.30,.50,.70]) {
  const qualityWeight = budget * (1 - breadthShare), breadthWeight = budget * breadthShare;
  const remainingGrowthBudget = pillars.增长动力 - realEstateBudget - budget;
  const fundingFactor = remainingGrowthBudget / fundingBudget;
  const adjustedFunding = fundingRows.map((row) => ({ id:row.id, name:row.name,
    oldWeight:row.weight, weight:row.weight * fundingFactor, points:row.points,
    contribution:row.weight * fundingFactor * row.points }));
  close(sum(adjustedFunding.map((row) => row.weight)) + budget + realEstateBudget, .4);
  const profitContribution = qualityWeight * coreProfit.points + breadthWeight * breadthPart.points;
  const fundingNewContribution = fundingContribution * fundingFactor;
  const total = fixedContribution + profitContribution + fundingNewContribution;
  const isSelected = budget === .08 && breadthShare === .50;
  if (isSelected) close(total, selectedTotal);
  sensitivity.push({ budget, breadthShare, qualityWeight, breadthWeight,
    profitCombinedScore:round(profitContribution / budget), profitContribution:round(profitContribution),
    fundingRule:"增长40%内，房地产4.5%固定；非房地产、非利润项目按新版相对权重等比例增减。",
    remainingGrowthBudget:round(remainingGrowthBudget), fundingFactor:round(fundingFactor),
    fundingContribution:round(fundingNewContribution), total:round(total),
    changeFromSelected:round(total-selectedTotal), profitContributionChangeFromSelected:round(profitContribution
      - selectedWeights.G02 * coreProfit.points - selectedWeights.G19 * breadthPart.points),
    fundingContributionChangeFromSelected:round(fundingNewContribution-fundingContribution),
    selected:isSelected, adjustedFunding:adjustedFunding.map((row) => ({...row,weight:round(row.weight),contribution:round(row.contribution)})),
  });
}
const protectedChecks = [
  {label:"PPI",ids:["E04"],expected:.05},
  {label:"城镇调查失业率",ids:["E05"],expected:.025},
  {label:"房地产三项合计",ids:realEstateIds,expected:.045},
  {label:"居民杠杆",ids:["F09"],expected:.03},
  {label:"企业杠杆",ids:["F10"],expected:.03},
].map((check) => { const actual = sum(check.ids.map((id) => selectedWeights[id])); close(actual,check.expected); return {...check,actual,passed:true}; });
const unchangedCredit = framework.indicators.filter((rule) => rule.pillar === "金融信贷")
  .map((rule) => {close(selectedWeights[rule.id],rule.weight);return {id:rule.id,weight:rule.weight,passed:true};});
const breadthInput = profitObservation.scoringInputs[breadthKey];
const componentSensitivity = [
  ...coreProfit.components.map((part) => ({key:part.key,label:part.label,points:part.points,
    oldEffectiveMacroWeight:profitRule.weight * previousProfit.components.find((prior) => prior.key === part.key).weight,
    newEffectiveMacroWeight:selectedWeights.G02 * part.weight})),
  {key:breadthKey,label:breadthPart.label,points:breadthPart.points,
    oldEffectiveMacroWeight:profitRule.weight * breadthPart.weight,newEffectiveMacroWeight:selectedWeights.G19},
];
const concerns = [
  "没有算术冲突：四类25/40/20/15合计100%，经济8项、增长14项、金融7项、政策9项，共38项。",
  "拆分后广度从G02移除，避免G02与G19重复计分；但两个利润指标来自同一统计表且经济含义相关，不能称为新增独立盈利来源。",
  "利润合计8%占增长类20%；工业生产组含工业增加值、两个利润指标、新订单和利用率，合计14%占增长类35%。这是有意强调工业盈利，但不能代表服务业、全体企业或全部上市公司盈利。",
  "广度按41行业等计数，小行业与大行业一票相同；它衡量改善覆盖面，不衡量利润份额或总利润规模。50%只表示行业数平衡，不是经济健康阈值。",
  "原广度有效宏观权重0.8%升至4%（五倍）；这比利润总预算4%变8%的两倍更集中，需要单列披露，不能说只是把旧项拆成两项。",
  "累计增长、当月增长及利润质量都来自工业统计，与工业产出、PPI和制造业景气有共同暴露；加权表示研究取向，不证明这些信号完全独立。",
  "经济运行降至25%仍保留PPI5%和失业率2.5%，因此PPI占该类20%；GDP降至7%、平减指数降至2%，弱化总量与广义价格观察，应在四维分数中持续保留解释。",
  "金融20%及全部七项权重原样保留，居民/企业杠杆各3%未挤压；政策货币5%、财政5%、产业2.5%、制度2.5%合计15%，政策支持仍不等于基本面复苏。",
  "需求并未完全被利润挤掉：消费9.5%、投资8%、房地产4.5%、出口4%，增长40%仍含需求与投入维度；但名义零售与利润存在价格影响。",
];
const limits = [
  "只有截至2026-10-11这一期完整五组件利润输入（统计期2026-08），拆后的四组件及广度同样只有这一个完整可验点；不构成多年、分阶段或样本外验证。",
  "9组固定候选只披露本期对预算和广度比的依赖，不按最高/最低总分挑参，也不声称8%或50%已由历史回测证明最优。",
  "本期质量分与广度分接近，使广度配比的实际影响较小；不能把本期敏感性较小误说成跨时期稳健。若两分未来拉开，配比影响会明显扩大。",
  "所有候选保持大类25/40/20/15、房地产4.5%、经济/金融/政策及其它评分方法不变；仅为诊断而明确调整增长内部资金来源，不是已部署的备选版。",
  "得分及原值沿用被冻结、已核验V1.18输入；本脚本复算来源与输入一致性，未重新下载完整历史，也未增加、插值或伪造原始观测。",
  "电子行业62%是利润增长贡献率，不是利润份额；没有把它当作广度原值或额外集中扣分。",
  "本报告未修改共享框架/评分/记录，未发布。正式新版总分与记录须由主流程使用完整评分器独立复算。",
];
const output = {version:"V1.19",baseVersion:"V1.18",asOf:current.asOf,status:"one-observation fixed-budget sensitivity disclosure; not backtest-optimal or asset-allocation signal",
  inputFiles,hypothesis:"在宏观背景框架中强调需求、盈利及改善广度，保留信用约束；公开预算配平与相依性，不用本期目标总分选权重。",
  selected:{pillars,weights:selectedWeights,pillarSummary,totalDiagnostic:round(selectedTotal),baselineTotal:round(baseline.formalScore),
    changeFromBaseline:round(selectedTotal-baseline.formalScore),count:38,coreComponentWeights,profitBudget:.08,breadthShare:.5},
  checks:{protectedChecks,unchangedCredit,weightSum:sum(Object.values(selectedWeights)),arithmeticPassed:true},
  observations:{profitQuality:{period:profitObservation.period,value:profitObservation.value,unit:profitObservation.unit,basis:profitObservation.basis,
    originalPublisher:profitObservation.originalPublisher,sourceUrl:profitObservation.sourceUrl,releaseDate:profitObservation.releaseDate,
    oldFiveComponentScore:previousProfit.points,newFourComponentScore:coreProfit.points,components:coreProfit.components},
    breadth:{period:breadthInput.period,value:breadthPart.value,unit:breadthInput.unit,basis:breadthInput.basis,
      sourceUrl:breadthInput.sourceUrl,originalPublisher:breadthInput.originalPublisher,releaseDate:breadthInput.releaseDate,
      points:breadthPart.points,numberOfIndustries:breadthInput.rawEvidence.industries.length,
      definition:"(改善行业数+0.5×持平行业数)/41×100%，分数1+4×广度/100"}},
  rows:rows.map((row) => ({...row,contribution:round(row.contribution),baselineContribution:round(row.baselineContribution)})),
  effectiveProfitComponentWeights:componentSensitivity,
  concentration:{profitWeight:.08,profitShareOfGrowth:.2,industryGroupWeight:.14,industryShareOfGrowth:.35,
    breadthMacroWeight:.04,breadthShareOfGrowth:.1,oneIndustryDownToUpMacroScoreChange:round(.04*4/41),
    oneIndustryDownToFlatMacroScoreChange:round(.04*2/41)},
  sensitivityProtocol:{budgets:[.06,.08,.10],breadthShares:[.3,.5,.7],growthBudget:.4,realEstateFixedBudget:.045,
    selectedFundingBudget:fundingBudget,fundingIds:fundingRows.map((row) => row.id),
    formula:"利润质量权重=B×(1−q)，广度权重=B×q；增长其余非房地产非利润项权重=新版权重×(0.40−0.045−B)/0.275；其它项、原值与评分函数不变。",
    criterion:"披露参数依赖，不根据本期总分选最优；用户确认的8%/50%作为试行取向。"},
  sensitivityDependence:{observedGridMinimum:round(Math.min(...sensitivity.map((row) => row.total))),
    observedGridMaximum:round(Math.max(...sensitivity.map((row) => row.total))),
    observedGridRange:round(Math.max(...sensitivity.map((row) => row.total))-Math.min(...sensitivity.map((row) => row.total))),
    selectedQualityBreadthScoreDifference:round(coreProfit.points-breadthPart.points),
    dTotal_dBreadthShareAtSelectedBudget:round(.08*(breadthPart.points-coreProfit.points)),
    scoreBoundMaximumEffectVsSelectedAt8BudgetFor30or70Share:.064,
    scoreBoundMaximumEffect30vs70ShareAt8Budget:.128,
    interpretation:"0.064/0.128只是1—5评分量尺的代数上限，不是未来预测、概率区间或置信区间；本期范围小不能证明历史稳健。"},
  sensitivity,concerns,limitations:limits,
};
function markdown(result) {
  const lines = ["# V1.19大类与利润权重：本期敏感性披露","",
    `截止日${result.asOf}；冻结基线V1.18，完整利润输入仅一个统计期。该表是可复算的本期权重诊断，不是历史回测最优证明。`,"",
    "## 合计与重点项","","四类25%/40%/20%/15%，38项合计100%；PPI5%、失业率2.5%、房地产4.5%、两类杠杆各3%保留。","",
    "|大类|权重|指标数|本期归一分（诊断）|","|---|---:|---:|---:|",
    ...result.selected.pillarSummary.map((row) => `|${row.name}|${row.weight*100}%|${row.count}|${row.normalizedScore.toFixed(6)}|`),"",
    "## 拆分后的利润含义","",
    `G02四组件为累计增长50%、当月增长25%、利润率变化12.5%、回款周期变化12.5%，本期${coreProfit.points.toFixed(8)}分；G19独立改善广度${breadthPart.value.toFixed(8)}%，得${breadthPart.points.toFixed(8)}分。两项各占宏观4%，合计8%。`,"",
    "广度不再进入G02计算，但仍与G02来自同一工业利润表，不能把拆分误称为完全独立的信息。原广度有效总分权重0.8%升至4%，为五倍。","",
    "## 固定9组本期敏感性","",
    "房地产4.5%固定；利润预算从6%变到10%时，其余非房地产、非利润增长项在增长40%内部按新版相对比例配平。其它大类、所有原值、评分函数均固定。不能只加利润而不减其它增长项。","",
    "|利润总预算|广度占利润预算|质量/广度宏观权重|利润贡献|其余增长缩放|合成总分（诊断）|较8%/50%差值|",
    "|---|---:|---|---:|---:|---:|---:|",
    ...result.sensitivity.map((row) => `|${row.budget*100}%|${row.breadthShare*100}%|${(row.qualityWeight*100).toFixed(1)}% / ${(row.breadthWeight*100).toFixed(1)}%|${row.profitContribution.toFixed(8)}|${row.fundingFactor.toFixed(6)}|${row.total.toFixed(8)}|${row.changeFromSelected.toFixed(8)}${row.selected?"（试行选择）":""}|`),"",
    "完整资金来源和逐项权重保存在JSON的sensitivity[].adjustedFunding，选定方案仅是研究取向，未按本期最高/最低分优化。","",
    `本期9组合成总分范围${result.sensitivityDependence.observedGridMinimum}—${result.sensitivityDependence.observedGridMaximum}；但质量与广度分本期仅差${result.sensitivityDependence.selectedQualityBreadthScoreDifference}。若二者未来分化，8%预算下广度30%与70%配置的代数影响上限可达0.128分（仅1—5量尺界限，不是概率区间），不能把本期差异较小当作跨时期稳健。`,"",
    "## 算术、集中与逻辑审查","",...result.concerns.map((text) => `- ${text}`),"",
    `在4%广度总权重下，固定41行业中单个行业由恶化转改善，宏观总分机械增加${result.concentration.oneIndustryDownToUpMacroScoreChange}；由恶化转持平增加${result.concentration.oneIndustryDownToFlatMacroScoreChange}。这只是计数函数敏感度，不代表经济冲击大小。`,"",
    "## 限制","",...result.limitations.map((text) => `- ${text}`),"",
    "复算入口：scripts/calibrate-macro-v1-19-weights.mjs --write；只写本报告JSON/Markdown，不修改共享评级资料或发布。","",
  ];
  return lines.join("\n");
}
if (process.argv.includes("--write")) {
  await writeFile(new URL("deliverables/macro-v1-19-weight-sensitivity.json",root),JSON.stringify(output,null,2)+"\n");
  await writeFile(new URL("deliverables/macro-v1-19-weight-sensitivity.md",root),markdown(output));
}
console.log(JSON.stringify({version:output.version,inputFiles,pillarSummary,selectedTotal:output.selected.totalDiagnostic,
  oldProfit:previousProfit.points,newCoreProfit:coreProfit.points,breadth:breadthPart.points,
  sensitivity:output.sensitivity.map(({budget,breadthShare,qualityWeight,breadthWeight,profitContribution,total,changeFromSelected}) =>
    ({budget,breadthShare,qualityWeight,breadthWeight,profitContribution,total,changeFromSelected})),
  checks:output.checks},null,2));
