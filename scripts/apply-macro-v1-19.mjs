import fs from "node:fs";
import assert from "node:assert/strict";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";
import { continuousScoreDetails } from "../lib/macro-scoring-continuous.mjs";

const path = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(path(name), "utf8"));
const write = (name, value) => fs.writeFileSync(path(name), JSON.stringify(value, null, 2) + "\n");
const display = (value) => Number(value.toFixed(2));
const files = { framework: "app/data/macro-rating-v1.json", current: "app/data/macro-rating-current.json", history: "app/data/macro-rating-history.json" };
assert.equal(read(files.framework).version, "V1.18", "This one-time migration must not roll back an already published version");
const backups = Object.fromEntries(Object.keys(files).map((key) => [key, `deliverables/macro-rating-${key}-before-v1-19-2026-10-11.json`]));
for (const key of Object.keys(files)) if (!fs.existsSync(path(backups[key]))) fs.copyFileSync(path(files[key]), path(backups[key]));
const before = read(backups.framework), oldCurrent = read(backups.current);
assert.equal(before.version, "V1.18");
assert.equal(oldCurrent.version, before.version);
if (process.argv.includes("--freeze-only")) {
  console.log("Prior rules, observations and public history frozen; no current data changed.");
  process.exit(0);
}

// Explicitly authorized research weights, not fitted to the current score.
const framework = structuredClone(before), current = structuredClone(oldCurrent);
framework.pillars = { 经济运行: .25, 增长动力: .40, 金融信贷: .20, 宏观调控: .15 };
const weights = {
  E01: .070, E02: .015, E03: .025, E04: .050, E05: .025, E07: .020, E08: .020, E09: .025,
  G01: .035, G02: .040, G19: .040, G03: .020, G14: .010, G15: .015, G07: .025,
  G16: .035, G13: .020, G17: .060, G12: .035, G10: .040, G11: .015, G18: .010,
  P01E: .035, P01F: .015, P02A: .020, P02E: .005, P02D: .025,
  P03A: .0125, P03B: .0125, P04A: .0125, P04B: .0125,
};
for (const item of framework.indicators) if (weights[item.id] !== undefined) item.weight = weights[item.id];

const profit = framework.indicators.find((item) => item.id === "G02");
const oldProfit = before.indicators.find((item) => item.id === "G02");
const breadthComponent = oldProfit.scoring.components.find((item) => item.key === "industryProfitImprovementBreadth");
const breadthInput = structuredClone(oldCurrent.observations.G02.scoringInputs.industryProfitImprovementBreadth);
profit.name = "规模以上工业企业盈利增长与质量";
profit.scoring.components = profit.scoring.components.filter((item) => item.key !== "industryProfitImprovementBreadth");
const internalWeights = { cumulativeComparableProfitGrowth: .5, officialCurrentMonthComparableProfitGrowth: .25,
  reportedProfitMarginYoyChange: .125, reportedReceivablesDaysYoyChange: .125 };
for (const part of profit.scoring.components) part.weight = internalWeights[part.key];
profit.definition = "观察规模以上工业企业盈利总量、边际增速及现金回收质量。项内累计可比利润同比50%、官方当月可比利润同比25%、营业收入利润率同比变化12.5%、应收账款平均回收期同比变化12.5%；分别按原曲线打分后加权。行业改善广度已独立为G19，不在本项重复计分；主原值仍为累计可比利润同比。四项原值、可比范围及质量反证须完整，缺项不补分、不重分配权重。规上工业利润不等同全部企业或上市公司盈利。";
profit.scoring.description = profit.definition;
profit.scoringBasis = "盈利增长与质量、行业改善广度回答不同问题，分别占宏观总分4%，合计8%。本项移除原20%广度组件，其余四组件按原相对比例归一到50/25/12.5/12.5，锚点不动；保留总量和质量，避免广度既在本项又在G19重复加权。提高盈利组是已获确认的研究优先级，不是历史回测最优值。";
profit.thresholdStatus = "研究试行：四组件历史完整性及其与上市公司盈利的映射尚需检验；本次只拆分与重配权，不调整原锚点或原始数据。";
profit.requirements = profit.requirements.filter((text) => !text.startsWith("industryProfitImprovementBreadth须"))
  .map((text) => text.replace("固定10%+10%", "固定12.5%+12.5%"));
profit.calibration = { ...profit.calibration, version: "V1.19", decision: "拆分与调权", reason: profit.scoringBasis,
  sampleSummary: "本期四组件证据完整；未完成四组件联合历史与样本外验证",
  limitations: [profit.thresholdStatus, "规上工业盈利与上市公司利润覆盖不同，不能因长期股价重视盈利便称本项为股票回报预测。"], comparisons: [] };
profit.grades = [1, 2, 3, 4, 5].map((points) => profit.scoring.components.flatMap((part) =>
  part.anchors.filter(([, score]) => score === points).map(([value]) => `${part.label}: ${value}${part.unit}对应${points}分`)).join("；") + "；原值参照是分量分，综合分按公开项内权重合成。");
delete current.observations.G02.scoringInputs.industryProfitImprovementBreadth;

const breadth = {
  id: "G19", pillar: "增长动力", group: "工业生产", name: "行业利润改善广度（规模以上工业，%）",
  frequency: "月度", unit: "%", mode: "高优", weight: .04,
  measurementBasis: "年初累计分行业利润改善广度", originalPublisher: "国家统计局",
  definition: "工作台按国家统计局GB/T4754-2017的41个工业行业原表计算：B=(改善行业数+0.5×持平行业数)/41×100%。利润增长、减亏、扭亏计改善；利润下降、增亏、由盈转亏计恶化；负基期依官方明确事实分类，不能强算同比。评分=1+4B/100，按等行业数量观察改善覆盖面，与盈利总量互补；50%只代表改善与恶化数量平衡，不是健康阈值。利润下降不等于亏损，行业增长贡献率不等于利润份额。本项不是全经济或上市公司盈利广度。",
  scoringBasis: "单列覆盖面并提升到宏观总分4%，与盈利增长与质量4%等权，降低少数大行业拉高总利润时对分化的掩盖。原广度公式和锚点保持不变，等行业计数防止规模总量再次主导，但大小行业各一票也有局限；两项同源、并非完全独立，合计8%是研究试行偏好而非经回测证明的最优权重。",
  thresholdStatus: "研究试行：本期41行业原表完整；完整月度广度历史尚未补齐，不把单期敏感性比较称为历史回测、经济预警或收益验证。",
  requirements: [
    ...profit.requirements.slice(0, 3).map((text) => text.replace("basis=年初累计可比同比", "basis=年初累计分行业利润改善广度")),
    "本项计分目前要求国家统计局完整41行业原表；来源仍先查官方，Wind和财新可用于定位、补查与交叉核对，但不得用不完整的供应商比例直接替代原表认证计分。",
    "独立观察G19保留完整唯一41行业名单、当期利润金额、官方可比同比或负基期特殊事实及原表出处、同一统计月、全国规模以上工业企业可比范围。缺行业不算下降，未覆盖41/41不计完整分，不缩小分母。",
    "rawEvidence保存分类版本、41行原表快照及每行发布/核验日期、金额和原文同比；本地逐行核对数值和特殊事实并复算B，不能只自填改善状态、汇总比例或verified标记。",
    "不从两年不同范围的刊载金额相除，不用累计金额差分伪造当月广度；主value为公开算法计算的比例，basis和scope须严格匹配。",
    "50%和1—5线性刻度为透明研究参照，不表示50%即经济健康；等行业计数、增长贡献率及利润总额份额分开解释，权重未经完整历史和样本外验证。",
  ],
  grades: [0, 25, 50, 75, 100].map((value, i) => `改善广度${value}%对应${i + 1}分；相邻参考点线性连续评分，持平行业半票，缺少行业不计算完整分。`),
  scoring: { method: "piecewise-linear", anchors: structuredClone(breadthComponent.anchors), description: "B=(改善+0.5×持平)/41×100%；得分=1+4B/100。行业分类须由完整官方原表复算，不能仅凭自填比例得分。" },
  calibration: { version: "V1.19", decision: "独立展示与调权", reason: "原行业改善广度由G02的内部20%转为独立4%宏观权重；不是新增原始数据或更改广度分档。",
    sampleSummary: "本期41/41行业完整，广度独立历史待补", limitations: ["等行业计数不代表规模份额，不涵盖服务业或全体上市公司。", "权重和线性映射为研究试行；单期复算与敏感性不等于历史回测。"], comparisons: [],
    evidenceSources: structuredClone(oldProfit.calibration.evidenceSources) },
};
framework.indicators.splice(framework.indicators.findIndex((item) => item.id === "G02") + 1, 0, breadth);
delete breadthInput.key;
current.observations.G19 = { ...breadthInput, indicatorId: "G19", aggregation: "行业利润改善广度",
  rationale: "2026年1—8月完整41行业原表：21行业利润增长、1行业扭亏，合计22行业改善；19行业下降、0持平。B=22/41×100%=53.66%，得分=1+4×22/41=3.15分（展示四舍五入，计算保留全精度）。下降不等于亏损；电子行业62%为利润增长贡献率，不是利润总额份额，不重复扣分。本项来自原已核验广度输入，不是新发布数据。" };

framework.version = current.version = "V1.19";
framework.versionDate = current.asOf;
framework.status = "V1.19权重与盈利拆分：经济运行25%、增长动力40%、金融信贷20%、宏观调控15%；盈利增长与质量4%、行业利润改善广度4%，共38项。原始数据及信息截止日不变，原有价格曲线保持；变化源于规则和权重，不是经济当日变化。";
framework.policyMethod.weights = "货币5%：政策利率2%、近12完整月普遍准备金率政策动作0.5%、新发放企业贷款名义利率2.5%；财政5%：一般公共预算支出3.5%、政府性基金支出1.5%；产业2.5%和制度2.5%，四项各1.25%。保留实际执行证据门槛，减少政策支持对基本面偏弱的抵消；财政两项并非完全独立，支出增加不等于净刺激或经济改善。无新增降准仅在完整证据核验后给中性分；旧政策不重复奖励。新组内比例为研究试行，非回测最优。";
framework.scoringMethod.quantitative = "32项量化采用1—5连续评分；相邻锚点间线性计算，两端截断；其中行业广度由完整41行业原表复算。";
framework.scoringMethod.calibration = "四大类权重25/40/20/15；盈利总量与质量和行业改善广度分别4%，合计8%。G02四分量50/25/12.5/12.5，G19保留原广度公式和曲线。原有其余36项评分方法不变；本期固定数据进行权重敏感性，不冒称完整历史回测，不以本期总分高低选参。宏观仍仅提供研究背景。";
framework.calibrationReview = { ...before.calibrationReview, reviewedCount: 38, adjustedCount: 2, retainedCount: 36, indicatorCount: 38,
  summary: "38项权重复核 · 盈利拆分为2项 · 其余评分方法保留", scope: framework.status, method: framework.scoringMethod.calibration };
framework.weightRevision = { version: "V1.19", authorized: true, previousPillars: structuredClone(before.pillars),
  rationale: "提高需求、盈利、投资及行业覆盖面对总分的影响，适度降低政策支持的补偿作用；分类更多不构成加权的独立理由。保留PPI5%、失业率2.5%、地产三项合计4.5%、金融信贷20%及两类杠杆各3%。",
  limitations: "研究优先级与已确认偏好，不是客观最优权重；相关指标仍有交叉。完整历史与样本外验证尚未完成。" };

// Keep current explanatory prose aligned with weights; never rewrite frozen prior records.
const definitionCorrections = {
  E03: ["权重3.5%", "V1.19权重2.5%"], G16: ["权重2.5%不变", "V1.19权重3.5%"],
  G17: ["权重4.5%不变", "V1.19权重6%"], G12: ["权重2.5%", "V1.19权重3.5%"],
  P01E: ["权重4%", "V1.19权重3.5%"], P01F: ["权重2%", "V1.19权重1.5%"],
  P02A: ["权重2.5%", "V1.19权重2%"], P02E: ["权重仍为总分1%", "V1.19权重为总分0.5%"],
  P03A: ["权重2%", "V1.19权重1.25%"], P03B: ["权重2%", "V1.19权重1.25%"],
  P04A: ["权重2%", "V1.19权重1.25%"], P04B: ["权重2%", "V1.19权重1.25%"],
};
for (const item of framework.indicators) if (definitionCorrections[item.id]) item.definition = item.definition.replace(...definitionCorrections[item.id]);
current.sourceStatus = current.sourceStatus.replace("本期37项", "本期38项")
  .replace("财政实际支出权重4%和2%不变，其他权重不动", "财政实际支出权重3.5%和1.5%；四类总权重25/40/20/15，盈利增长质量与改善广度各4%");
current.observations.P02D.reason = current.observations.P02D.reason.replace("落在[-20,20)中性3分", "按既有连续曲线得3.72分（0基点为3分）");

for (const [pillar, weight] of Object.entries(framework.pillars)) assert.ok(Math.abs(framework.indicators.filter((item) => item.pillar === pillar).reduce((sum, item) => sum + item.weight, 0) - weight) < 1e-12, `${pillar}: weight budget`);
assert.equal(framework.indicators.length, 38);
assert.deepEqual(framework.ratingBands, before.ratingBands);
assert.deepEqual(framework.freshness, before.freshness);
const oldResult = evaluateMacroRating(before, oldCurrent), result = evaluateMacroRating(framework, current);
const rows = framework.indicators.map((item) => {
  const oldRule = before.indicators.find((entry) => entry.id === item.id);
  const oldPoints = oldRule ? scoreIndicator(oldRule, oldCurrent.observations[item.id], oldCurrent.asOf, before.freshness) : null;
  const points = scoreIndicator(item, current.observations[item.id], current.asOf, framework.freshness);
  assert.notEqual(points, null, `${item.id}: complete audited input required`);
  if (oldRule) {
    for (const key of ["value", "period", "unit", "basis", "sourceUrl", "releaseDate", "verifiedAt", "originalPublisher", "latestAvailablePeriod"]) assert.deepEqual(current.observations[item.id][key], oldCurrent.observations[item.id][key], `${item.id}: raw ${key} unchanged`);
    if (item.id !== "G02") { assert.deepEqual(item.scoring, oldRule.scoring); assert.equal(points, oldPoints); }
  }
  return { id: item.id, name: item.name, pillar: item.pillar, group: item.group, previousWeight: oldRule?.weight ?? 0,
    weight: item.weight, currentWeight: item.weight, previousScore: oldPoints, currentScore: points,
    previousContribution: oldPoints === null ? 0 : oldPoints * oldRule.weight, currentContribution: points * item.weight,
    contributionChange: points * item.weight - (oldPoints === null ? 0 : oldPoints * oldRule.weight),
    decision: item.id === "G19" ? "独立广度" : item.id === "G02" ? "拆分" : item.weight === oldRule.weight ? "保留" : "调权",
    reason: ["G02", "G19"].includes(item.id) ? item.scoringBasis : item.weight === oldRule.weight ? "原规则、原值和权重保持。" : "仅按四大类新预算重配权重，原评分曲线和原值不变。" };
});
const profitDetails = continuousScoreDetails(profit, current.observations.G02, current.asOf);
current.observations.G02.rationale = `本期累计可比利润同比15.7%、官方当月4.2%、利润率同比+0.44个百分点、回款周期同比+0.9天，原值和出处不变。四分量分别按50/25/12.5/12.5合成${display(profitDetails.points)}分，广度另列G19不重复计分；两项各4%、合计8%。原V1.18合成含广度${display(scoreIndicator(oldProfit, oldCurrent.observations.G02, oldCurrent.asOf, before.freshness))}分，差异来自拆分，不是经济变化。`;
assert.equal(result.status, "正式");
assert.ok(Math.abs(result.coverage - 1) < 1e-12);
assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.contributionChange, 0) - (result.formalScore - oldResult.formalScore)) < 1e-12);
current.reviewSummary = framework.status + " 工业利润改善广度与增长质量均单独可见；利润下降不等于亏损，规上工业不等于全经济或上市公司。评分记录默认全部保留，新版仅追加，未经用户明确指定不删除；此前已获准删除的旧记录不自动恢复。";
current.evidenceLimitations.push({ items: ["G02", "G19"], reason: framework.scoringMethod.calibration });
current.revisionComparison = { previousVersion: before.version, currentVersion: framework.version,
  kind: "同一信息截止日权重重配与工业盈利拆分，不是经济变化", previousScore: oldResult.formalScore, currentScore: result.formalScore, rows };
const record = createMacroRatingRecord(framework, current);
const priorHistory = read(files.history);
assert.deepEqual(priorHistory.snapshots, read(backups.history).snapshots, "Do not overwrite records changed by another writer");
const history = { ...appendMacroRatingRecord(priorHistory, record), updatedAt: current.asOf };
write(files.framework, framework);
write(files.current, current);
write(files.history, history);
write("deliverables/macro-v1-19-score-comparison.json", current.revisionComparison);
console.log(JSON.stringify({ version: framework.version, score: result.formalScore, previousScore: oldResult.formalScore,
  coverage: result.coverage, count: framework.indicators.length, records: history.snapshots.length,
  profit: profitDetails.points, breadth: rows.find((item) => item.id === "G19").currentScore,
  pillars: result.pillars.map(({ name, observedScore, weight }) => ({ name, observedScore, weight })) }, null, 2));
