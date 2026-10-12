import fs from "node:fs";
import assert from "node:assert/strict";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";
import { continuousScoreDetails } from "../lib/macro-scoring-continuous.mjs";

const path = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(path(name), "utf8"));
const write = (name, value) => fs.writeFileSync(path(name), JSON.stringify(value, null, 2) + "\n");
const files = { framework: "app/data/macro-rating-v1.json", current: "app/data/macro-rating-current.json", history: "app/data/macro-rating-history.json" };
assert.equal(read(files.framework).version, "V1.20", "This one-time migration must not roll back an already published version");
const backups = Object.fromEntries(Object.keys(files).map((key) => [key, `deliverables/macro-rating-${key}-before-v1-21-2026-10-11.json`]));
for (const key of Object.keys(files)) if (!fs.existsSync(path(backups[key]))) fs.copyFileSync(path(files[key]), path(backups[key]));
const before = read(backups.framework), oldCurrent = read(backups.current);
assert.equal(before.version, "V1.20");
assert.equal(oldCurrent.version, before.version);
if (process.argv.includes("--freeze-only")) {
  console.log("V1.20 framework, observations and history frozen; current data unchanged.");
  process.exit(0);
}
assert.deepEqual(read(files.framework), before, "Do not overwrite another writer's framework");
assert.deepEqual(read(files.current), oldCurrent, "Do not overwrite another writer's observations");
const framework = structuredClone(before), current = structuredClone(oldCurrent);
const changedIds = ["F01", "F02"];
const shown = (value) => Number(value.toFixed(2));
const diagnosticPath = "deliverables/macro-loan-dual-v1-21-calibration.json";
assert.ok(fs.existsSync(path(diagnosticPath)), "Independent loan-scale diagnostic required before applying rules");
const diagnostic = read(diagnosticPath);
const propertyEvidence = read("deliverables/macro-property-dual-v1-21-evidence.json");
const amountBasis = "年初累计新增";
const scope = "全国金融机构人民币贷款";
const configurations = {
  F01: { series: "householdLong", label: "居民", cumulative: [300, 800], month: [800, 2800], bounds: [50.5, 101] },
  F02: { series: "enterpriseLong", label: "企（事）业单位", cumulative: [1600, 2100], month: [1500, 3800], bounds: [100, 200] },
};
const makeAnchors = ([inner, outer]) => [[-outer, 1], [-inner, 2], [0, 3], [inner, 4], [outer, 5]];
const sourceEndpoint = (observation, period, series, roundingUnit) => {
  const candidates = observation.components.flatMap((component) => component.cumulativeParts || []).filter((item) => item.period === period);
  assert.ok(candidates.length, `Official loan cumulative endpoint ${period} required`);
  for (const candidate of candidates) assert.deepEqual(candidate, candidates[0], `Conflicting endpoint ${period}`);
  return { ...structuredClone(candidates[0]), basis: amountBasis, series, originalPublisher: "中国人民银行",
    verified: true, verifiedAt: current.asOf, latestAvailablePeriod: period, scope, currency: "CNY",
    periodScope: `${period.slice(0, 4)}-01—${period}`, roundingUnit };
};
const proofLabel = (record) => `${record.periodScope} ${record.value}亿元`;
for (const id of changedIds) {
  const rule = framework.indicators.find((item) => item.id === id);
  const previous = before.indicators.find((item) => item.id === id);
  const observation = current.observations[id], plan = configurations[id];
  const [year, month] = observation.period.split("-").map(Number);
  assert.ok(month > 1, "January has no same-year preceding cumulative endpoint; do not cross years");
  const period = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
  const currentEndpoint = sourceEndpoint(observation, period(year, month), plan.series, id === "F01" ? 1 : 100);
  const preceding = sourceEndpoint(observation, period(year, month - 1), plan.series, id === "F01" ? 1 : 100);
  const previousEndpoint = sourceEndpoint(observation, period(year - 1, month), plan.series, 100);
  const previousPreceding = sourceEndpoint(observation, period(year - 1, month - 1), plan.series, 100);
  const cumulativeValue = currentEndpoint.value - previousEndpoint.value;
  const monthValue = currentEndpoint.value - preceding.value - (previousEndpoint.value - previousPreceding.value);
  const comparability = { sameScope: true,
    revisionNote: "同部门、同人民币新增流量及同年累计差分；均为各期官方初步发布值，未声称四期统一重新修订版本。后续官方修订须重新核验。",
    roundingNote: "部分原表以0.01万亿元（100亿元）披露，其他以1亿元披露；同比差分分别保留两端/四端最大半粒度舍入界，不虚增精度。" };
  const inputBase = { period: observation.period, latestAvailablePeriod: observation.period, unit: "亿元",
    originalPublisher: "中国人民银行", verified: true, verifiedAt: current.asOf,
    sourceUrl: observation.sourceUrl, releaseDate: observation.releaseDate, series: plan.series, scope, currency: "CNY" };
  const cumulativeInput = { ...inputBase, periodScope: `${year}-01—${observation.period}`, value: cumulativeValue, basis: "年初累计新增额同比多增", roundingErrorBound: plan.bounds[0],
    rawEvidence: { kind: "loan-year-to-date-amount-difference", current: currentEndpoint, previous: previousEndpoint, comparability,
      formula: "年初累计同比多增额 = 本年同月累计新增额 − 上年同月累计新增额；评分输入 = 累计多增额 ÷ 统计月已过月份。",
      components: [currentEndpoint, previousEndpoint], explanation: `${proofLabel(currentEndpoint)} − ${proofLabel(previousEndpoint)} = ${cumulativeValue}亿元；除以${month}个月 = ${cumulativeValue / month}亿元/月。` } };
  const monthlyInput = { ...inputBase, value: monthValue, basis: "当月新增额同比多增", roundingErrorBound: plan.bounds[1],
    rawEvidence: { kind: "loan-single-month-cumulative-amounts", currentYear: { preceding, current: currentEndpoint },
      previousYear: { preceding: previousPreceding, current: previousEndpoint }, comparability,
      formula: "最新单月同比多增额 = (本年同月累计新增额 − 本年上月累计新增额) − (上年同月累计新增额 − 上年上月累计新增额)；不是两个累计增速相减。",
      components: [preceding, currentEndpoint, previousPreceding, previousEndpoint],
      explanation: `本年月新增${currentEndpoint.value - preceding.value}亿元 − 上年月新增${previousEndpoint.value - previousPreceding.value}亿元 = ${monthValue}亿元。单月允许净减少，不以零或负新增额作同比百分比分母。` } };
  observation.scoringInputs = { ...observation.scoringInputs, yearToDateMoreIncrease: cumulativeInput, latestMonthMoreIncrease: monthlyInput };
  rule.name = `${plan.label}中长期新增贷款（累计＋当月同比多增）`;
  rule.displayComponents = true;
  delete rule.aggregation;
  rule.scoring = { method: "weighted-components", dualBasis: "loan-year-to-date-and-latest-month", components: [
    { key: "yearToDateMoreIncrease", label: "年初累计同比多增/少增", weight: .4, unit: "亿元", basis: cumulativeInput.basis,
      input: "observation.scoringInputs.yearToDateMoreIncrease", scoreTransform: "calendar-month-average", anchorUnit: "亿元/月", anchors: makeAnchors(plan.cumulative) },
    { key: "latestMonthMoreIncrease", label: "最新单月同比多增/少增", weight: .6, unit: "亿元", basis: monthlyInput.basis,
      input: "observation.scoringInputs.latestMonthMoreIncrease", anchorUnit: "亿元", anchors: makeAnchors(plan.month) },
  ], description: "两条金额口径分别连续计分，再按累计40%/最新单月60%合成；各自独立尺度，零多增均为中性3分。累计原值保持亿元，除以年内已过月份后按亿元/月曲线评分，避免8月累计天然比2月累计更大；不新增近三个月层。" };
  rule.definition = `${plan.label}中长期新增贷款采用年初累计同比多增/少增与最新单月同比多增/少增，在父项总分权重${shown(rule.weight * 100)}%内按40%/60%配比。原始累计金额和当月差分均保留，两条子项直接显示原值、得分、项内权重、折算总权重、时期及来源。主观察保留旧近3月原值，仅供历史对照，不参与当前计算。` + (id === "F01" ? "住户中长期贷款并非全部住房按揭。" : "企（事）业单位包括非金融企业及机关团体，不等于纯私人企业贷款、上市公司盈利或已经发生的资本开支。" );
  rule.scoringBasis = "累计保留年内融资背景、最新单月提高边际变化的可见性；40%/60%为研究试行配比，两者相关而非独立信号。部门分别取2025年对2024年完整12个月的绝对同比多增P50/P90，整百选定2/4及1/5分节点；0=3分，不把样本中位数当健康水平。累计按已过月份标准化，最新单月独立校准，不套用旧近3月金额节点。2026年仅作尺度诊断，不用于选择本期总分方向。";
  rule.thresholdStatus = "研究试行：12个训练月份样本较短、累计高度相关、绝对金额尺度随融资规模变化；不是实时历史回测、样本外预警验证或跨资产投资收益检验。官方各期初步数不等于同版历史重修订值；保留舍入分数区间。2026年8个诊断月中，居民累计分量8期触底、企业累计5期触底，尚未解决极弱区间的全部灵敏度问题；单月60%仍提供变化响应，后续扩长样本需再审外端点。累计各月重叠，不能视为12个独立经济周期。";
  rule.requirements = [
    "保留历史主观察value/basis/unit/components及官方来源；measurementBasis描述历史主值，当前计分只读取两个独立scoringInputs，不以历史近3月主值作第三分量。",
    "累计和单月输入须有period=latestAvailablePeriod、verified=true、verifiedAt、sourceUrl、releaseDate、originalPublisher=中国人民银行、unit=亿元、series、scope=全国金融机构人民币贷款、currency=CNY；来源发布日期不晚于核验日或信息截止日。",
    "累计同比多增保留本年/上年同月两端原始累计新增额；单月保留两年同月和上月四端，同年相邻月份、两年相差12个月、同部门同单位同范围，两个输入的同月端点必须完全一致。",
    "rawEvidence分别保存公式、原发布链接、统计期和舍入粒度roundingUnit；roundingErrorBound严格按两端或四端半粒度和计算。缺端点、混范围、跨年差分或混版本拒绝计分，不补估值。",
    "累计原值按亿元显示，scoreTransform=calendar-month-average仅在评分时除以统计月已过月份，曲线单位亿元/月；单月曲线单位亿元。不能把累计总额套用月均或旧近3月节点。",
    "新增额可正可负，比较同比多增/少增金额而非以负值/零值为分母的同比百分比。零多增对应3分不表示信贷结构健康；须和杠杆、社融等共同解读。",
    "当前差分证据契约支持2—12月；1月应独立核验官方直接单月原值后另行接入，不从12月累计跨年差分。",
    "两条子项在页面直接列示，折算总权重合计等于父项权重；必需输入缺失不认证完整父项分，不自动重配给另一项；旧评分记录仍按冻结旧规则复算。",
  ];
  rule.methods = [rule.scoring.description, "参照点之间线性插值得分，超出端点截断1—5；显示两位小数、计算保留精度，插值得分而非插值缺失数据。", rule.thresholdStatus];
  rule.grades = [1, 2, 3, 4, 5].map((points) => rule.scoring.components.map((part) => {
    const anchor = part.anchors.find(([, score]) => score === points);
    return `${part.label}：${anchor[0]}${part.anchorUnit}对应${points}分${part.scoreTransform ? "（先将累计额除以已过月份）" : ""}`;
  }).join("；") + "；固定40%/60%合成，不是两个原始金额平均。" );
  rule.calibration = { version: "V1.21", decision: "新增可见贷款双口径及独立金额尺度", reason: rule.scoringBasis,
    sampleSummary: "2025年对2024年12个完整月份训练；2026年仅尺度诊断，完整原值、公式和来源见独立报告。",
    limitations: [rule.thresholdStatus], comparisons: [], evidenceFile: diagnosticPath };
  assert.equal(rule.weight, previous.weight);
}
framework.version = current.version = "V1.21";
framework.versionDate = current.asOf;
framework.status = "V1.21贷款可见双口径：居民与企（事）业单位中长期新增贷款分别列示累计/最新单月同比多增金额，40%/60%合成；38父项及四类25/40/20/15、全部父指标总权重不变。房地产及投资五项尚未取得可靠可比单月，保留累计评分；历史全部追加保存。";
framework.scoringMethod.calibration = "本轮仅F01/F02从近3月合计同比多增改为累计/最新单月同比多增，两种独立金额尺度；累计评分标准化已过月份但原始累计额不改。其他36项方法与权重不变，既有双口径保留；不按本期分数高低选参数。";
framework.calibrationReview = { ...framework.calibrationReview, reviewedCount: 38, indicatorCount: 38, adjustedCount: 2, retainedCount: 36,
  summary: "38父项保留 · 2项贷款启用累计/单月分列 · 5项待可比单月", scope: framework.status, method: framework.scoringMethod.calibration };
framework.dualBasisReview = { ...framework.dualBasisReview, version: "V1.21",
  enabledIds: [...framework.dualBasisReview.enabledIds, ...changedIds],
  pending: framework.dualBasisReview.pending.filter((item) => !changedIds.includes(item.id)).map((item) => ({ ...item,
    reason: ["G03", "G14"].includes(item.id)
      ? "官方有累计量及累计可比同比，但上年比较数修订；已取Wind四端金额，算出的累计同比与官方可比同比不一致。国家数据本次访问被拒绝，不等于数据不存在；尚未取得同修订可比单月，保留现累计评分。"
      : "官方分项当前有累计同比；尚未取得同范围、可比单月原值或官方单月同比，不将累计增长率相减，不替换统计范围；计划未启用，现累计评分保留。",
    evidenceFile: "deliverables/macro-property-dual-v1-21-evidence.json" })),
};
current.reviewSummary = framework.status + " 信息截止日和保留的主观测值不变；贷款补充同一已公布月份的官方累计/单月原值，并非当日新宏观发布。旧近3月主值不参与新版合成。";
current.sourceStatus = "本期38父项核验沿用官方原始发布；新启用两项贷款双口径的原值来自人民银行两年7/8月报告，新增额同比差分不是余额同比或同比百分比。房地产官方与Wind四端的修订可比性未通过，不用不匹配金额生成单月分数。";
current.evidenceLimitations.push({ items: changedIds, reason: "贷款累计40%/最新单月60%及独立金额尺度仍为研究试行，训练只12个月；累计先除已过月份仅作尺度标准化，不是新增滚动窗口。初步原表和舍入误差保留，未验证经济预警或投资表现。" });
current.evidenceLimitations.push({ items: ["G03", "G14", "G07", "G13", "G16"], reason: "尚未启用单月并非笼统官方无数据：房地产四端旧刊金额与官方修订可比同比不符，投资分项尚未核齐同范围可比单月；现有累计评分仍有效。", evidenceFile: "deliverables/macro-property-dual-v1-21-evidence.json" });
const previousResult = evaluateMacroRating(before, oldCurrent);
for (const id of changedIds) {
  const rule = framework.indicators.find((item) => item.id === id), observation = current.observations[id];
  const detail = continuousScoreDetails(rule, observation, current.asOf);
  assert.ok(detail, `${id}: fully validated loan components required`);
  observation.rationale = `累计/最新单月各自评分后按40%/60%合成。` + detail.components.map((part) => `${part.label}${shown(part.value)}${part.unit}${part.scoreTransform ? `；评分输入${shown(part.scoreValue)}${part.scoreUnit}` : ""}→${shown(part.points)}分，折算总权重${shown(part.weight * rule.weight * 100)}%`).join("；") + `；本项${shown(detail.points)}分。原主值${observation.value}亿元与原始证据均保留，仅供历史对照，不参与新版合成；同比多增为负表示较上年少增，不等于贷款余额负增长。`;
}
const result = evaluateMacroRating(framework, current);
assert.equal(result.status, "正式");
assert.equal(result.coverage, 1);
assert.equal(framework.indicators.length, before.indicators.length);
assert.deepEqual(framework.pillars, before.pillars);
assert.deepEqual(framework.ratingBands, before.ratingBands);
assert.deepEqual(framework.freshness, before.freshness);
const rows = framework.indicators.map((rule) => {
  const previous = before.indicators.find((item) => item.id === rule.id), observation = current.observations[rule.id];
  assert.equal(rule.weight, previous.weight);
  for (const key of ["value", "period", "unit", "basis", "sourceUrl", "releaseDate", "verifiedAt", "originalPublisher", "latestAvailablePeriod", "components"])
    assert.deepEqual(observation[key], oldCurrent.observations[rule.id][key], `${rule.id}: preserved original ${key}`);
  const previousScore = scoreIndicator(previous, oldCurrent.observations[rule.id], current.asOf, before.freshness);
  const currentScore = scoreIndicator(rule, observation, current.asOf, framework.freshness);
  assert.notEqual(currentScore, null);
  if (!changedIds.includes(rule.id)) {
    assert.deepEqual(rule, previous); assert.deepEqual(observation, oldCurrent.observations[rule.id]); assert.equal(currentScore, previousScore);
  }
  return { id: rule.id, name: rule.name, previousScore, currentScore, weight: rule.weight, previousWeight: previous.weight, currentWeight: rule.weight,
    contributionChange: (currentScore - previousScore) * rule.weight, reason: changedIds.includes(rule.id) ? rule.scoringBasis : "规则、原值、权重和得分均不变。" };
});
current.revisionComparison = { previousVersion: before.version, currentVersion: framework.version,
  kind: "同截止日贷款双口径及评分尺度修订，不是经济变化", previousScore: previousResult.formalScore, currentScore: result.formalScore, rows };
assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.contributionChange, 0) - (result.formalScore - previousResult.formalScore)) < 1e-12);
const priorHistory = read(files.history);
assert.deepEqual(priorHistory.snapshots, read(backups.history).snapshots, "Do not overwrite newly saved records");
const record = createMacroRatingRecord(framework, current);
const history = { ...appendMacroRatingRecord(priorHistory, record), updatedAt: current.asOf };
assert.deepEqual(history.snapshots.slice(0, -1), priorHistory.snapshots);
write(files.framework, framework); write(files.current, current); write(files.history, history);
write("deliverables/macro-v1-21-score-comparison.json", current.revisionComparison);
write("deliverables/macro-loan-dual-v1-21-evidence.json", { version: framework.version, asOf: current.asOf,
  originalSources: [...new Set(changedIds.flatMap((id) => current.observations[id].scoringInputs.latestMonthMoreIncrease.rawEvidence.components.map((part) => part.sourceUrl)))],
  items: changedIds.map((id) => ({ id, ...current.observations[id].scoringInputs })),
  propertyEvidenceFile: "deliverables/macro-property-dual-v1-21-evidence.json", diagnosticFile: diagnosticPath });
console.log(JSON.stringify({ version: framework.version, enabledIds: changedIds, count: framework.indicators.length,
  previousScore: previousResult.formalScore, score: result.formalScore, coverage: result.coverage, records: history.snapshots.length,
  pillars: result.pillars.map(({ name, observedScore, weight }) => ({ name, observedScore, weight })) }, null, 2));
