import fs from "node:fs";
import assert from "node:assert/strict";
import { scoreIndicator, evaluateMacroRating } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";

// This migration starts from frozen, independently recoverable observations. It never rewrites old evidence.
const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const write = (path, value) => fs.writeFileSync(new URL(`../${path}`, import.meta.url), JSON.stringify(value, null, 2) + "\n");
const previous = read("deliverables/macro-rating-framework-before-v1-15-2026-10-11.json");
const priorCurrent = read("deliverables/macro-rating-current-before-v1-15-2026-10-11.json");
const previousHistory = read("deliverables/macro-rating-history-before-v1-15-2026-10-11.json");
const framework = structuredClone(previous), current = structuredClone(priorCurrent);
assert.equal(read("app/data/macro-rating-v1.json").version, "V1.14", "Archived migrations must not roll back a published revision");
for (const area of ["real-economy", "credit"]) {
  const patch = read(`deliverables/macro-v1-15-${area}-implementation.json`);
  for (const rulePatch of patch.rules) {
    const rule = framework.indicators.find((item) => item.id === rulePatch.id);
    assert.ok(rule, rulePatch.id);
    if (rulePatch.weight !== undefined) assert.equal(rulePatch.weight, rule.weight);
    Object.assign(rule, rulePatch);
  }
  for (const [id, item] of Object.entries(patch.observations)) Object.assign(current.observations[id], item);
}
const policyNumerical = {
  P01E: { anchors: [[-5, 1], [0, 2], [3, 3], [7, 4], [12, 5]],
    reason: "全国一般公共预算支出年初累计可比同比；3%仅为名义执行扩张的试行中间参考，不是官方财政中性增速。连续函数区分1.2%与2.9%，不把名义支出当实际政府需求或净财政冲量。" },
  P01F: { anchors: [[-25, 1], [-10, 2], [0, 3], [10, 4], [25, 5]],
    reason: "政府性基金预算组成及波动与一般预算不同，采用独立尺度，0对应同比持平；保留负增长中改善的区分度。土地、债券用途及跨预算转移均影响含义，不与一般预算相加冒称去重广义财政。" },
  P02A: { anchors: [[-50, 5], [-25, 4], [0, 3], [25, 2], [50, 1]],
    reason: "仍用近6个月两端有效7天逆回购政策利率之差，以0为3分；连续且对称表达小步升降息。只评分窗口内新增支持方向，不因绝对利率低而再次奖励，不等同经济已改善。" },
  P02E: { anchors: [[-100, 5], [-50, 4], [0, 3], [50, 2], [100, 1]],
    reason: "保留12完整月政策动作账本及所有证据门槛，只细化累计基点到得分的映射，0为3分、升降幅度对称；旧降准退出窗口不代表原政策失效，不延窗重复奖励，不由亿元表符号推定无动作。" },
  P02D: { anchors: [[-50, 5], [-25, 4], [0, 3], [25, 2], [50, 1]],
    reason: "仍用同口径新发放企业贷款加权平均名义利率同比变化，0为3分，下降18基点与上升18基点分别反映相反方向；受客户结构和信贷需求影响，不是扣通胀后的实际融资利率，也不单独证明政策因果传导。" },
};
for (const [id, spec] of Object.entries(policyNumerical)) {
  const rule = framework.indicators.find((item) => item.id === id);
  rule.scoring = { method: "piecewise-linear", anchors: spec.anchors,
    description: "相邻锚点之间线性计算得分，端点外封顶/保底；内部不先取整。仅插值得分，不插值统计数据。" };
  rule.scoringBasis = spec.reason;
  rule.thresholdStatus = "研究试行：固定解释性锚点，非官方评分标准、非回测最优，未完成样本外验证";
  rule.grades = [1, 2, 3, 4, 5].map((score) => spec.anchors.filter((pair) => pair[1] === score)
    .map((pair) => `${pair[0]}${rule.unit}对应${score}分`).join("；") + "；其间按连续函数评分");
  rule.requirements.push("采用公开连续锚点，原值派生复算与原有时效门槛不变；公式产生的小数不是统计置信度，缺证据不补中性。");
  current.observations[id].rationale += ` 本版改用连续映射：${spec.reason}`;
}
const scope = {
  P03A: ["全国行业", ["钢铁产能准入退出和联合监管实施条件"], ["其他产业覆盖", "全国钢铁实际退出及执行成效"]],
  P03B: ["全国专项", ["设备更新和消费品以旧换新资格、责任和实施条件"], ["设备更新全部领域执行", "资金完整兑付"]],
  P04A: ["全国制度", ["产权、准入、公平竞争法律及贯彻要求"], ["全国壁垒清理完成", "跨地区实际执法和权利救济一致性"]],
  P04B: ["全国制度", ["主要长期资金考核与上市股东回报制度条件"], ["逐类机构完整执行", "全部回报治理制度落实"]],
};
for (const id of Object.keys(scope)) {
  const rule = framework.indicators.find((item) => item.id === id);
  const review = current.observations[id].policyReview;
  rule.policyEvidenceMatrixRequired = true;
  rule.scoring = { method: "evidence-rubric", step: 1, description: "保留五档整数研判；有正式文件与实施条件才可4分，5分还须与完整评价范围匹配的执行证据，不按文件数量或市场涨幅计分。" };
  rule.scoringBasis += " 本版把覆盖范围及四项实施条件绑定到正式证据编号；单行业或单子项进展不能外推全经济。四分表示明确范围内可执行条件改善，并不代表全经济实施完成。";
  rule.requirements.push("policyReview.coverageAssessment逐项记录实际覆盖与未核实范围；implementationChecks将工具、责任、时间、受益范围四个判断绑定至有效正式文件。5分须无未核实评价范围、执行范围匹配且能追溯相同正式机制。");
  const formal = review.evidence.filter((item) => item.stage === "正式文件" && item.status === "有效");
  review.coverageAssessment = { level: scope[id][0], coveredAreas: scope[id][1], unverifiedAreas: scope[id][2],
    wholeEconomyClaim: false, executionMatchesScope: false,
    representativeness: review.scope + " 本项分数不宣称所有行业或全部对象已经受益；未公开执行证据不等于未执行。" };
  review.implementationChecks = ["instruments", "responsibleAgency", "timetable", "beneficiaries"].map((dimension) => ({
    dimension, finding: review[dimension], evidenceRefs: formal.map((item) => item.eventId),
  }));
}
framework.version = current.version = "V1.15";
framework.versionDate = current.asOf;
framework.status = "V1.15评分灵敏度与证据标准修订：37项和已确认权重完全不变，31项量化指标按固定锚点连续评分，其中GDP、三项PMI和工业利润用有原始证据的固定组件；居民及企业杠杆按新兴市场主参照及国内证据矩阵以半分档研判，四项产业制度继续整数五档。数值锚点和组件比例均为研究试行，并非回测最优；仅插值得分，不插值缺失数据。基本面与政策支持分开解读，宏观只提供各类资产独立研究的背景。";
framework.researchAssessmentPolicy.definition = "本版不开放缺原值的研究暂评。量化数据须通过原始发布、频率、截止与派生复算校验；结构化杠杆研判属于原文研判指标，其证据局限单独展示，不冒称直接核验了部门债务服务率。";
framework.scoringMethod = { quantitative: "31项量化采用1—5连续评分；相邻锚点间线性计算，两端截断。",
  qualitative: "2项杠杆使用结构化证据半分档，4项产业制度使用证据五档；不得制造小数精确感。",
  missingData: "缺失必需组件不重分配权重、不补中性；只对得分函数插值。",
  calibration: "节点为经济含义与历史区分度驱动的研究试行，尚未完成样本外校准。不得为获得预设总分调整参数。",
  sources: [{ title: "JRC复合指标归一化方法", sourceUrl: "https://knowledge-for-policy.ec.europa.eu/composite-indicators/toolkit_en/navigation-page/10-step-guide_en/step-5-normalisation_en" },
    { title: "BIS非金融部门信贷定义与国际比较", sourceUrl: "https://data.bis.org/topics/TOTAL_CREDIT" },
    { title: "BIS债务服务率及口径限制", sourceUrl: "https://data.bis.org/topics/DSR" }] };
for (const rule of framework.indicators) {
  assert.equal(rule.weight, previous.indicators.find((item) => item.id === rule.id).weight);
  assert.ok(rule.scoring && rule.requirements.length && rule.grades.length === 5);
  if (rule.scoring.method !== "evidence-rubric" && rule.scoring.method !== "evidence-matrix") {
    // Retain only descriptive legacy boundaries, never present them as the live scoring algorithm.
    rule.previousIntegerLimits = rule.limits;
    delete rule.limits;
  }
}
assert.deepEqual(framework.pillars, previous.pillars);
assert.deepEqual(framework.indicators.map((item) => item.id), previous.indicators.map((item) => item.id));
current.evidenceLimitations = [
  { items: ["F09", "F10"], severity: "证据研判局限", reason: "未取得可比的中国居民/企业分别债务服务率。新兴市场为主参照，国内杠杆趋势、收入/盈利、回款和价格证据联合判断；BIS私人非金融总DSR只能作背景，不能分配为两部门DSR。国际排名不等于风险阈值，收入差距不修改官方总量比率。" },
  { reason: "31项连续节点及内部组件配比均是可解释的研究试行，不是官方评分标准或样本外回测最优；输入小数不代表统计置信度。" },
  { reason: "GDP和PMI变化组件仍可能受基数、修订或平滑滞后影响。利润单月只用官方公布可比同比，不从累计增速相减。" },
  { reason: "贷款金额锚点使用当前名义尺度，需要定期复核；M1口径仅使用2024年起新口径可比序列。房价高位过热阈值缺充分历史，本版只封顶，不声称高涨幅最优。" },
];
const priorResult = evaluateMacroRating(previous, priorCurrent);
const result = evaluateMacroRating(framework, current);
const rows = framework.indicators.map((rule) => ({ id: rule.id, name: rule.name, weight: rule.weight,
  previous: scoreIndicator(previous.indicators.find((item) => item.id === rule.id), priorCurrent.observations[rule.id], priorCurrent.asOf, previous.freshness),
  current: scoreIndicator(rule, current.observations[rule.id], current.asOf, framework.freshness) }));
const missing = rows.filter((row) => row.current === null);
if (missing.length) throw new Error(`Do not publish incomplete migration: ${missing.map((row) => row.id).join(", ")}`);
const displayScore = (value) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
for (const row of rows) {
  const rule = framework.indicators.find((item) => item.id === row.id);
  if (!["piecewise-linear", "weighted-components"].includes(rule.scoring.method)) continue;
  const observation = current.observations[row.id];
  let facts = `本期官方观察值为${observation.value}${observation.unit}，统计期${observation.period}。`;
  if (row.id === "E01") facts += "同版前季单季实际同比为5.0%，本季为4.3%，同比增速较前季回落0.7个百分点；水平占项内80%，变化占20%。";
  if (row.id === "G02") facts += "官方当月可比利润增长4.2%，累计利润率同比增加0.44个百分点，应收回收期增加0.9天；四个固定分量为累计60%、单月20%、利润率10%、回款10%，不是从累计增速相减生成单月。";
  if (["E08", "E09", "G11"].includes(row.id)) facts += `最新三个月均值较前一组三个月变动${Number(observation.scoringInputs.nonOverlappingThreeMonthChange.value.toFixed(3))}指数点；水平80%、变化20%。`;
  if (["F01", "F02", "F07", "F08", "F05"].includes(row.id)) facts = priorCurrent.observations[row.id].rationale
    .split("依据当前研究试行标准")[0].replace("均不足改变本次分档", "会传导到连续得分，不能把小数当作无误差原值");
  if (row.id === "F01") facts += "按已知公布精度估计，原值误差约±51.5亿元，对本期分数影响约±0.02分。";
  if (row.id === "F02") facts += "按已知公布精度估计，原值误差约±200亿元，对本期分数影响约±0.04分。";
  if (row.id === "P02A") facts += "两端有效利率均为1.40%，0操作量不当作0利率，0基点仅代表窗口内无新增变动。";
  if (row.id === "P02D") facts += "2026年6月3.04%减上年同月3.22%，再乘100得到-18基点；名义利率下降，不等于通胀调整后的成本下降。";
  if (row.id === "P02E") facts = priorCurrent.observations[row.id].rationale.replace("按[-25,25)基点评中性3分", "由完整账本核验为0基点");
  observation.rationale = `${facts} ${rule.scoringBasis} 按本版固定方法为${displayScore(row.current)}分；本期原始主观察未变，分数差异是规则修订，并非经济当日变化。`;
}
current.revisionComparison = { previousVersion: previous.version, version: framework.version, asOf: current.asOf,
  previousScore: priorResult.formalScore, score: result.formalScore,
  kind: "同一信息截止日的规则重算，不是经济当日变化", previousEvidenceRetained: true,
  rows: rows.map((row) => ({ ...row, contributionChange: (row.current - row.previous) * row.weight })) };
current.reviewSummary = "本期按V1.15重算37项：31项连续量化、2项杠杆证据矩阵、4项政策整数研判。权重和信息截止日不变，原始事实与评分方法分开留档；版本差异不表示经济突然变化。全部通过当前证据规则不表示锚点已经过样本外验证，不直接生成资产仓位。";
current.gaps = [];
const snapshot = createMacroRatingRecord(framework, current);
const history = { ...appendMacroRatingRecord(read("app/data/macro-rating-history.json"), snapshot), updatedAt: current.asOf };
write("app/data/macro-rating-v1.json", framework);
write("app/data/macro-rating-current.json", current);
write("app/data/macro-rating-history.json", history);
write("deliverables/macro-v1-15-score-comparison.json", current.revisionComparison);
console.log(JSON.stringify({ version: framework.version, count: rows.length, total: result.formalScore, grade: result.grade, pillars: result.pillars, rows }, null, 2));
