import fs from "node:fs";
import assert from "node:assert/strict";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";

// Mechanical, idempotent migration from a frozen V1.16 input set. Only E04's
// scoring rule changes; score interpolation never fills a missing observation.
const path = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(path(name), "utf8"));
const write = (name, value) => fs.writeFileSync(path(name), JSON.stringify(value, null, 2) + "\n");
const files = { framework: "app/data/macro-rating-v1.json", current: "app/data/macro-rating-current.json", history: "app/data/macro-rating-history.json" };
assert.equal(read(files.framework).version, "V1.16", "Archived migrations must not roll back a published revision");
const backups = Object.fromEntries(Object.keys(files).map((key) => [key, `deliverables/macro-rating-${key}-before-v1-17-2026-10-11.json`]));
if (Object.values(backups).some((name) => !fs.existsSync(path(name)))) {
  assert.equal(read(files.framework).version, "V1.16", "Never freeze V1.17 as its own prior version");
  assert.equal(read(files.current).version, "V1.16");
  for (const key of Object.keys(files)) if (!fs.existsSync(path(backups[key]))) fs.copyFileSync(path(files[key]), path(backups[key]));
}
const before = read(backups.framework), oldCurrent = read(backups.current);
assert.equal(before.version, "V1.16");
assert.equal(oldCurrent.version, before.version);
if (process.argv.includes("--freeze-only")) {
  console.log("Frozen V1.16 framework, original observations, and public record; no current data changed.");
  process.exit(0);
}
const audit = read("deliverables/macro-v1-17-ppi-calibration.json");
const framework = structuredClone(before), current = structuredClone(oldCurrent);
const oldRule = before.indicators.find((item) => item.id === "E04");
const rule = framework.indicators.find((item) => item.id === "E04");
assert.ok(rule && audit.scoring && audit.reason && audit.limitations?.length);
assert.equal(audit.scoring.method, "piecewise-linear");
assert.deepEqual(audit.scoring.anchors.filter(([value]) => value <= -1), oldRule.scoring.anchors.filter(([value]) => value <= -1));
rule.scoring = structuredClone(audit.scoring);
rule.definition = "全国工业生产者出厂价格当月同比；评价整体工业价格环境，不是上游股票盈利或收益评分。温和正增长与高涨幅成本压力分开表达；同比受需求、供给、国际商品价格及基数共同影响，不能把超过3%或4%直接称为恶性通胀。";
rule.scoringBasis = "以温和正增长为研究高分区，超过峰区逐步降分，减少把上游涨价视为全经济改善的奖励。候选曲线由经济含义事先设定，再用同一组官方当月同比比较评分跳变和饱和；官方保供稳价与恢复性上涨案例支持双侧判断，但不提供官方PPI目标或评分锚点。具体峰区及降分幅度仍为研究试行，历史尺度诊断不是健康价格环境或预警效果的验证。";
rule.thresholdStatus = "研究试行：本次专项检验正值峰区和上端降分，非官方PPI目标，未证明最优健康区间、经济预警误报率或样本外资产回报。负值侧沿用V1.16，不因此认定−1%是健康中性水平。";
rule.calibration = {
  version: "V1.17", decision: "调整", reason: audit.reason,
  sampleSummary: audit.sampleSummary, limitations: audit.limitations,
  comparisons: audit.comparisons,
  evidenceSources: audit.evidenceSources,
  precisionRange: audit.precisionRange,
};
rule.grades = [1, 2, 3, 4, 5].map((points) => {
  const refs = rule.scoring.anchors.filter(([, score]) => score === points).map(([value]) => `指标水平: ${value}对应${points}分`);
  return (refs.length ? refs.join("；") : `${points}分语义参考，实际按公开曲线连续计算`) + "；这是分量参照，不是离散分档，完整算法以scoring为准。";
});
framework.version = current.version = "V1.17";
framework.versionDate = current.asOf;
framework.status = "V1.17 PPI专项修订：仅调整PPI温和正值峰区与高位降分，其余36项沿用V1.16。37项指标、全部权重、原始数据和信息截止日不变；GDP平减指数另行分析，不在本次授权范围内自动改分。";
framework.scoringMethod.calibration = "本版PPI专项采用固定候选、同样本、分阶段的历史尺度诊断；选择温和峰区和较早上端降分，不以本期总分、方差最大或历史收益挑选。其余36项沿用V1.16已公开规则及校准说明。不是当时可得数据回放、健康价格区间验证或真实经济预警误报率检验。";
framework.calibrationReview = {
  reviewedCount: 1, adjustedCount: 1, retainedCount: 36, indicatorCount: 37,
  summary: "PPI专项复核1项 · 调整1项 · 其余36项沿用V1.16",
  scope: "仅PPI重新比较候选；全部37项另做变更范围、权重与原始输入一致性检查。GDP平减指数的同期分析不等于授权修改。",
  method: framework.scoringMethod.calibration,
  officialMethodology: before.calibrationReview.officialMethodology,
};
for (const item of framework.indicators) if (item.id !== "E04") assert.deepEqual(item, before.indicators.find((entry) => entry.id === item.id));
assert.deepEqual(framework.pillars, before.pillars);
assert.deepEqual(framework.ratingBands, before.ratingBands);
assert.deepEqual(framework.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })), before.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })));
const oldResult = evaluateMacroRating(before, oldCurrent), result = evaluateMacroRating(framework, current);
const rows = framework.indicators.map((item) => {
  const observation = current.observations[item.id];
  const previous = before.indicators.find((entry) => entry.id === item.id);
  const oldPoints = scoreIndicator(previous, observation, current.asOf, before.freshness);
  const points = scoreIndicator(item, observation, current.asOf, framework.freshness);
  assert.notEqual(points, null, item.id);
  if (item.id === "E04") {
    observation.rationale = `本期原始观察为${observation.value}${observation.unit}，统计期${observation.period}，信息截止${current.asOf}。${item.scoringBasis} 本次取舍：${audit.reason} 按V1.17规则连续计算为${points.toFixed(2)}分（V1.16为${oldPoints.toFixed(2)}分）。这是评分规则修订，不是原值变化；较高PPI不等于恶性通胀，也不能仅由涨幅判断上下游利润。`;
  } else {
    assert.equal(points, oldPoints, `${item.id}: all other scores must remain unchanged`);
    observation.rationale += " V1.17沿用此项V1.16算法与观察值，单项得分未变。";
  }
  return { id: item.id, name: item.name, weight: item.weight, previousScore: oldPoints, currentScore: points,
    contributionChange: (points - oldPoints) * item.weight, decision: item.id === "E04" ? "调整" : "保留",
    reason: item.id === "E04" ? audit.reason : "本次PPI专项修订不改变此项规则、权重和原始输入。" };
});
current.reviewSummary = "本期按V1.17只调整PPI正值高分区与上端降分，其他36项及全部权重不变。信息截止日与原始官方观察沿用上一版，分数差异仅来自评分规则修订。PPI候选诊断未验证最优健康水平或真实经济预警效果；旧版完整记录本地备份可恢复，公开评分记录仍只展示本期新版。";
current.evidenceLimitations = oldCurrent.evidenceLimitations.filter((item) => item.reason !== before.scoringMethod.calibration);
current.evidenceLimitations.push({ items: ["E04"], reason: framework.scoringMethod.calibration });
current.revisionComparison = { previousVersion: before.version, currentVersion: framework.version,
  kind: "同一信息截止日PPI评分规则修订，不是经济变化", previousScore: oldResult.formalScore, currentScore: result.formalScore, rows };
const rawInputs = (observations) => Object.fromEntries(Object.entries(observations).map(([id, observation]) => {
  const copy = structuredClone(observation); delete copy.rationale; return [id, copy];
}));
assert.deepEqual(rawInputs(current.observations), rawInputs(oldCurrent.observations));
assert.equal(result.status, "正式");
assert.ok(Math.abs(result.coverage - 1) < 1e-9);
assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.contributionChange, 0) - (result.formalScore - oldResult.formalScore)) < 1e-9);
const record = createMacroRatingRecord(framework, current);
const history = { ...appendMacroRatingRecord(read(files.history), record), updatedAt: current.asOf };
write(files.framework, framework);
write(files.current, current);
// User's latest-only display preference: preserve prior data in the frozen backup.
write(files.history, history);
write("deliverables/macro-v1-17-score-comparison.json", current.revisionComparison);
console.log(JSON.stringify({ version: framework.version, asOf: current.asOf, previousScore: oldResult.formalScore,
  score: result.formalScore, ppi: rows.find((item) => item.id === "E04"),
  pillars: result.pillars.map((item) => ({ name: item.name, score: item.observedScore })) }, null, 2));
