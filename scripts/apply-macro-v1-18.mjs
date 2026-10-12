import fs from "node:fs";
import assert from "node:assert/strict";

const path = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(path(name), "utf8"));
const write = (name, value) => fs.writeFileSync(path(name), JSON.stringify(value, null, 2) + "\n");
const displayScore = (value) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
const files = { framework: "app/data/macro-rating-v1.json", current: "app/data/macro-rating-current.json", history: "app/data/macro-rating-history.json" };
assert.equal(read(files.framework).version, "V1.17", "Archived migrations must not roll back or overwrite an already published scoring revision");
const backups = Object.fromEntries(Object.keys(files).map((key) => [key, `deliverables/macro-rating-${key}-before-v1-18-2026-10-11.json`]));
if (Object.values(backups).some((name) => !fs.existsSync(path(name)))) {
  assert.equal(read(files.framework).version, "V1.17", "Never freeze the new version as its own baseline");
  for (const key of Object.keys(files)) if (!fs.existsSync(path(backups[key]))) fs.copyFileSync(path(files[key]), path(backups[key]));
}
const before = read(backups.framework), oldCurrent = read(backups.current);
assert.equal(before.version, "V1.17");
assert.equal(oldCurrent.version, before.version);
if (process.argv.includes("--freeze-only")) {
  console.log("V1.17 rules, original observations and latest-only public record backed up; no current data changed.");
  process.exit(0);
}

// Fixed, authorized transformations from immutable prior inputs. This migration
// never fills missing data or chooses parameters by the desired current total.
const { evaluateMacroRating, scoreIndicator } = await import("../lib/macro-rating.mjs");
const { createMacroRatingRecord, appendMacroRatingRecord } = await import("../lib/macro-rating-record.mjs");
const { continuousScoreDetails } = await import("../lib/macro-scoring-continuous.mjs");
const framework = structuredClone(before), current = structuredClone(oldCurrent);
const changedIds = new Set(["E04", "E07", "G02"]);
const ppi = framework.indicators.find((item) => item.id === "E04");
ppi.scoring.anchors = [[-5, 1], [-2.5, 2], [-1, 3], [.5, 4], [1, 5], [2, 5], [3, 3.5], [5, 2.5], [8, 1.5], [12, 1]];
ppi.scoring.description = "PPI价格环境连续评分；1—2%为研究试行峰区，超过2%更快降分：3%=3.5分、5%=2.5分、8%=1.5分、12%=1分。负值侧及0.5%过渡点不动；不按涨幅直接认定恶性通胀，不叠加利润或PMI奖金。";
ppi.scoringBasis = "采用适度高端扣分方案，相比较严格方案减轻2—3%区段的陡坡，同时不再将3%或5%的偏高涨幅给予原版高分。评的是整体工业价格环境，不是上游资产收益；输入成本、需求、供给与基数另以原文说明，不从剪刀差单独推断传导失败。具体峰区、锚点和降分幅度为研究试行，尺度诊断不证明健康区间或经济误报率。";
ppi.thresholdStatus = "研究试行：适度加快高位扣分；负侧中性参照未在本次重设，不能据此认定−1%健康。历史尺度和参数敏感性可复算，不是经济或收益最优值。";

const deflator = framework.indicators.find((item) => item.id === "E07");
const anchors = structuredClone(deflator.scoring.anchors);
deflator.scoring = { method: "weighted-components", components: [
  { key: "currentPriceLevel", label: "本季价格水平", weight: .7, anchors, unit: "%", basis: deflator.measurementBasis, input: "observation.value" },
  { key: "previousQuarterPriceLevel", label: "上季价格水平", weight: .15, anchors: structuredClone(anchors), unit: "%", basis: deflator.measurementBasis, input: "observation.scoringInputs.previousQuarterPriceLevel" },
  { key: "twoQuartersAgoPriceLevel", label: "前两季价格水平", weight: .15, anchors: structuredClone(anchors), unit: "%", basis: deflator.measurementBasis, input: "observation.scoringInputs.twoQuartersAgoPriceLevel" },
], description: "三季分别按原水平曲线评分，再按70%/15%/15%合成；不是先平均原值再打分。本季仍占主导，过去两季提供轻量持续性。主原值保留本季单季同比，不写成三季均值。缺季、跨修订版本或GDP原值复算不符则不给完整分，不重分权。" };
deflator.definition += " V1.18加入近三季持续性：本季水平分70%、上季15%、前两季15%；三季原值同版复算，主value仍为本季值。";
deflator.scoringBasis = "同版单季名义GDP与实际同比指数复算原值；70%权重保持当前修复信号，前两季各15%区分刚转正与持续修复。改善和恶化确认都可能滞后。本次单独改变持续性，不同时拟合峰区、成因和行业权重；原0.75%=4分及2—3%峰区仍为待验证研究参照，不因保留而视为客观健康标准。";
deflator.thresholdStatus = "研究试行：70/15/15为低参数持续性设定；60/70/80同窗比较仅揭示尺度和滞后，不证明更准确或更少经济误报。";
deflator.requirements.push("连续本季、上季及前两季原值同revisionVersion，名义GDP原值与实际同比指数均保留；由每季完整原值复算且不跳季、不混版本。缺任一季不得自动用本季代替或重分权。");

const profit = framework.indicators.find((item) => item.id === "G02");
profit.scoring.components[0].weight = .4;
profit.scoring.components.splice(1, 0, { key: "industryProfitImprovementBreadth", label: "行业利润改善广度", weight: .2,
  anchors: [[0, 1], [25, 2], [50, 3], [75, 4], [100, 5]], unit: "%", basis: "年初累计分行业利润改善广度", input: "observation.scoringInputs.industryProfitImprovementBreadth" });
profit.name = "规模以上工业企业盈利增长与质量（含行业改善广度）";
profit.definition = "主观察仍为规上工业累计可比利润同比；项内累计增长40%、行业利润改善广度20%、官方当月增长20%、利润率同比变化10%、回款周期同比变化10%。广度=(改善行业数+0.5×持平行业数)/41×100%，分数=1+4×广度/100。固定GB/T4754-2017的41大类，增长/减亏/扭亏计改善，下降/增亏/由盈转亏计恶化；负基期以官方原文核验，不强算普通同比。50%只表示行业数量上的改善与恶化平衡，不是经济健康阈值。固定等行业计数与按规模的总量互补；该样本不代表服务业、所有企业或上市公司。任何必需组件缺证据不生成完整单项分，不重分权。行业增长贡献集中单列解释，不重复扣分或当作利润占比。";
profit.scoringBasis = "总利润可被少数大行业拉动，行业改善广度衡量改善覆盖面；从原累计同比60%中挪出20%，保留总量、边际与质量，4%总分权重不变。官方分行业可比同比和特殊项事实决定分类，不接受自填状态。锚点1+4B是透明线性试行刻度；41行业等计数有规模差异限制，配比未验证最优。";
profit.thresholdStatus = "研究试行：新增广度有本期完整41行业原表支持；完整五组件历史尚不足，不将本期复算或部分利润历史当作全项回测。";
profit.scoring.description = profit.definition;
profit.requirements = profit.requirements.map((text) => text.replace("四分量", "五分量"));
profit.requirements.push("industryProfitImprovementBreadth须留完整唯一41行业名单、当期利润金额、官方可比同比或负基期特殊事实及原表出处；缺行业不算下降，未覆盖41/41不计完整广度分，不能用累计金额差分伪造当月广度。");

const deflatorInput = read("deliverables/macro-v1-18-deflator-input.json");
const breadthInput = read("deliverables/macro-v1-18-profit-breadth-input.json");
// Agent evidence payloads are inspected and extracted explicitly before applying.
const observationE07 = deflatorInput.currentObservation ?? deflatorInput.observation ?? deflatorInput;
assert.equal(observationE07.value, oldCurrent.observations.E07.value);
assert.equal(observationE07.basis, oldCurrent.observations.E07.basis);
assert.equal(observationE07.period, oldCurrent.observations.E07.period);
current.observations.E07 = { ...structuredClone(oldCurrent.observations.E07), ...structuredClone(observationE07) };
current.observations.G02.scoringInputs.industryProfitImprovementBreadth = structuredClone(breadthInput.input ?? breadthInput.item ?? breadthInput);
current.observations.G02.scoringInputs.industryProfitImprovementBreadth.rawEvidence.growthContribution = structuredClone(breadthInput.growthContribution);

const diagnostics = read("deliverables/macro-v1-18-parameter-diagnostics.json");
for (const item of framework.indicators.filter((entry) => changedIds.has(entry.id))) {
  item.grades = [1, 2, 3, 4, 5].map((points) => {
    const parts = item.scoring.method === "weighted-components" ? item.scoring.components : [{ label: "指标水平", anchors: item.scoring.anchors }];
    const refs = parts.flatMap((part) => part.anchors.filter(([, score]) => score === points).map(([value]) => `${part.label}: ${value}对应${points}分`));
    return (refs.length ? refs.join("；") : `${points}分为条件语义，实际按公开曲线连续计算`) + "；分量参照不是综合单项分，完整算法及项内权重以评分标准为准。";
  });
  const scale = item.id === "E04" ? diagnostics.ppi : item.id === "E07" ? diagnostics.deflator : null;
  const previousSources = before.indicators.find((entry) => entry.id === item.id).calibration?.evidenceSources ?? [];
  item.calibration = { version: "V1.18", decision: "调整", reason: item.scoringBasis,
    sampleSummary: scale?.sampleSummary ?? "本期41行业完整，五分量完整仅本期1点；不声称完整历史回测",
    limitations: [item.thresholdStatus, ...(scale?.limitations ?? breadthInput.limitations), "历史整理值并非当时可得数据回放，已观察样本不称未见验证集；分数修订不是本期经济变化。"],
    comparisons: structuredClone(scale?.comparisons ?? []), evidenceSources: structuredClone(previousSources) };
  if (item.id === "E04") item.calibration.precisionRange = structuredClone(diagnostics.ppi.precisionRange);
  if (!item.calibration.evidenceSources.some((entry) => entry.url === current.observations[item.id].sourceUrl)) {
    item.calibration.evidenceSources.push({ title: "国家统计局本期原始发布", url: current.observations[item.id].sourceUrl, note: "原值保留，派生项按同口径原表复算。" });
  }
  if (item.id === "G02") item.calibration.evidenceSources.push({ title: "国家统计局工业司：行业利润变化和增长贡献", url: breadthInput.growthContribution.sourceUrl,
    note: "21个行业利润增长、19个下降、1个扭亏；电子行业62%是利润增长贡献率，不是利润总额占比。增长贡献集中仅作解释，不再额外扣分。" });
}
framework.version = current.version = "V1.18";
framework.versionDate = current.asOf;
framework.status = "V1.18价格尺度与盈利广度完善：仅PPI、GDP平减指数和工业盈利三项评分修订，37项指标及全部权重不变；原观察值与信息截止日不变，新增同版历史和分行业证据。";
framework.scoringMethod.calibration = "固定适度PPI曲线、平减指数70/15/15和工业盈利40/20/20/10/10；不按本期总分选择参数，不把尺度稳定性当经济误报率，完整盈利历史不足如实注明。政策支持与基本面分开理解，宏观只提供背景指导。";
framework.calibrationReview = { ...before.calibrationReview, reviewedCount: 3, adjustedCount: 3, retainedCount: 34, indicatorCount: 37,
  summary: "专项复核3项 · 调整3项 · 其余34项保留", scope: framework.status, method: framework.scoringMethod.calibration };
assert.deepEqual(framework.pillars, before.pillars);
assert.deepEqual(framework.ratingBands, before.ratingBands);
assert.deepEqual(framework.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })), before.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })));
const oldResult = evaluateMacroRating(before, oldCurrent), result = evaluateMacroRating(framework, current);
const rows = framework.indicators.map((item) => {
  const oldRule = before.indicators.find((entry) => entry.id === item.id);
  const observation = current.observations[item.id];
  const oldPoints = scoreIndicator(oldRule, oldCurrent.observations[item.id], current.asOf, before.freshness);
  const points = scoreIndicator(item, observation, current.asOf, framework.freshness);
  assert.notEqual(points, null, `${item.id}: complete audited input required`);
  assert.equal(observation.value, oldCurrent.observations[item.id].value, `${item.id}: raw value unchanged`);
  if (!changedIds.has(item.id)) {
    assert.deepEqual(item, oldRule);
    assert.equal(points, oldPoints);
    assert.deepEqual(observation, oldCurrent.observations[item.id]);
  } else {
    const details = continuousScoreDetails(item, observation, current.asOf);
    observation.rationale = `本期原值${observation.value}${observation.unit}，统计期${observation.period}，信息截止${current.asOf}。${item.scoringBasis} 本期分量：${details.components.map((part) => `${part.label}${part.value}${part.unit}、${displayScore(part.points)}分（项内${part.weight * 100}%）`).join("；")}。按V1.18合成为${displayScore(points)}分，原V1.17为${displayScore(oldPoints)}分；差异来自规则修订和补充证据，不是原值或经济当日变化。`;
    if (item.id === "G02") observation.rationale += " 本期41行业中21个增长、19个下降、1个扭亏，改善计22个；利润下降不等于亏损。电子行业对总利润增长贡献62%，并非利润份额，不重复扣分。";
  }
  return { id: item.id, name: item.name, weight: item.weight, previousScore: oldPoints, currentScore: points,
    contributionChange: (points - oldPoints) * item.weight, decision: changedIds.has(item.id) ? "调整" : "保留", reason: changedIds.has(item.id) ? item.scoringBasis : "本版不改变此项规则、权重或原值。" };
});
assert.equal(result.status, "正式");
assert.ok(Math.abs(result.coverage - 1) < 1e-9);
assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.contributionChange, 0) - (result.formalScore - oldResult.formalScore)) < 1e-9);
current.reviewSummary = framework.status + " 工业行业利润下降不等于亏损；改善广度只代表规上工业。PPI−CPI仅作结构解释，不新增权重或单独证明传导失败。评分记录默认全部保留，后续更新只追加，不覆盖已有记录；仅在用户明确指定时删除。此前已获准删除的记录不自动恢复。";
current.evidenceLimitations = oldCurrent.evidenceLimitations.filter((item) => item.reason !== before.scoringMethod.calibration);
current.evidenceLimitations.push({ items: [...changedIds], reason: framework.scoringMethod.calibration });
current.revisionComparison = { previousVersion: before.version, currentVersion: framework.version, kind: "同一信息截止日三项评分修订与证据补充，不是经济变化", previousScore: oldResult.formalScore, currentScore: result.formalScore, rows };
assert.equal(diagnostics.version, "V1.18");
const record = createMacroRatingRecord(framework, current);
const history = { ...appendMacroRatingRecord(read(files.history), record), updatedAt: current.asOf };
write(files.framework, framework);
write(files.current, current);
write(files.history, history);
write("deliverables/macro-v1-18-score-comparison.json", current.revisionComparison);
console.log(JSON.stringify({ version: framework.version, score: result.formalScore, coverage: result.coverage,
  changed: rows.filter((item) => changedIds.has(item.id)), pillars: result.pillars.map((item) => ({ name: item.name, score: item.observedScore })) }, null, 2));
