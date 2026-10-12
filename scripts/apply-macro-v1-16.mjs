import fs from "node:fs";
import assert from "node:assert/strict";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";
import { continuousScoreDetails } from "../lib/macro-scoring-continuous.mjs";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";

// A mechanical, versioned JSON migration. All original inputs are frozen before
// the first write; reruns use those originals rather than recalibrating outputs.
const path = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(path(name), "utf8"));
const write = (name, value) => fs.writeFileSync(path(name), JSON.stringify(value, null, 2) + "\n");
const backups = {
  framework: "deliverables/macro-rating-framework-before-v1-16-2026-10-11.json",
  current: "deliverables/macro-rating-current-before-v1-16-2026-10-11.json",
  history: "deliverables/macro-rating-history-before-v1-16-2026-10-11.json",
};
const files = { framework: "app/data/macro-rating-v1.json", current: "app/data/macro-rating-current.json", history: "app/data/macro-rating-history.json" };
assert.equal(read(files.framework).version, "V1.15", "Archived migrations must not roll back a published revision");
for (const key of Object.keys(files)) {
  if (!fs.existsSync(path(backups[key]))) {
    assert.equal(read(files.framework).version, "V1.15", "Freeze V1.15 before migration");
    fs.copyFileSync(path(files[key]), path(backups[key]));
  }
}
const before = read(backups.framework), oldCurrent = read(backups.current);
assert.equal(before.version, "V1.15");
assert.equal(oldCurrent.version, before.version);
const framework = structuredClone(before), current = structuredClone(oldCurrent);
const audits = ["real", "credit", "policy"].map((area) => read(`deliverables/macro-v1-16-${area}-calibration.json`));
const patches = audits.flatMap((audit) => audit.rules);
assert.equal(patches.length, 37);
assert.equal(new Set(patches.map((rule) => rule.id)).size, 37);
assert.deepEqual(patches.map((rule) => rule.id).sort(), framework.indicators.map((rule) => rule.id).sort());
const numericMethod = (scoring) => {
  const copy = structuredClone(scoring); delete copy.description; return copy;
};
const sampleText = (sample) => {
  if (typeof sample === "string") return sample;
  if (sample?.domesticPeriod) return `国内${sample.domesticPeriod}、国际同表${sample.internationalPeriod}；新兴市场参照${sample.peerCount}个经济体。只复核本期证据矩阵，没有完整历史矩阵回测。`;
  if (sample?.start) return `${sample.start}至${sample.end}；可比观测${sample.n ?? sample.count ?? "未记录"}期${sample.fullAvailableN ? `，全部可得历史${sample.fullAvailableN}期` : ""}。当前修订版本的尺度诊断，不是历史实时回测。`;
  if (Array.isArray(sample?.period)) return `${sample.period.join("至")}；${sample.observedChangeCount}个可核验观察，来自${sample.source}。不代表完整连续历史或独立政策动作样本；没有证明最优参数。`;
  if (sample?.historicalIndependentReviewCount) return `${sample.period}本期${sample.historicalIndependentReviewCount}组政策证据复核；不进行数值插值，也没有完整历史证据矩阵回测。`;
  return "没有足够可比历史；本轮只检查评分结构与证据要求，不宣称历史验证完成。";
};
const comparisonText = (candidate) => {
  if (Array.isArray(candidate.diagnostics)) {
    const selected = candidate.diagnostics.filter((entry) => entry.window === "all available" || entry.window === "recent 2024 onward");
    if (!selected.some((entry) => entry.n)) return "没有足够完整同口径样本；候选曲线已保存，但不能据此宣称历史验证。";
    return selected.map((entry) => {
      const parts = [entry.window === "all available" ? `全部可得${entry.n}期` : `2024年以来${entry.n}期`];
      if (Number.isFinite(entry.meanAbsoluteScoreChange)) parts.push(`相邻绝对变分均值${entry.meanAbsoluteScoreChange.toFixed(3)}`);
      if (Number.isFinite(entry.scoreChangeOver0_5Count)) parts.push(`超过0.5分变化${entry.scoreChangeOver0_5Count}次`);
      if (Number.isFinite(entry.endpointScoreCount)) parts.push(`触及1或5分${entry.endpointScoreCount}期`);
      if (Number.isFinite(entry.consecutiveTripletReversalsOver0_25Count)) parts.push(`超过0.25分反转${entry.consecutiveTripletReversalsOver0_25Count}次`);
      return parts.join("；");
    }).join("。") + "。这些变化不是经济误报率，疫情及低基数阶段另存于完整校准报告。";
  }
  const diagnostic = candidate.diagnostics;
  if (!diagnostic || !diagnostic.n) return candidate.reason ?? "没有足够同口径样本，不能给出历史验证结论。";
  const parts = [`${diagnostic.n}期`];
  if (Number.isFinite(diagnostic.meanAbsoluteMonthChange)) parts.push(`相邻绝对变分均值${diagnostic.meanAbsoluteMonthChange.toFixed(3)}`);
  if (Number.isFinite(diagnostic.tailCount)) parts.push(`触及1或5分${diagnostic.tailCount}期`);
  if (Number.isFinite(diagnostic.consecutiveSignReversals)) parts.push(`相邻变分反转${diagnostic.consecutiveSignReversals}次`);
  if (Number.isFinite(diagnostic.adjacentWithinYearCount)) parts.push(`同年连续期对${diagnostic.adjacentWithinYearCount}组`);
  if (Number.isFinite(diagnostic.meanAbsoluteWithinYearScoreChange)) parts.push(`同年连续期绝对变分均值${diagnostic.meanAbsoluteWithinYearScoreChange.toFixed(3)}`);
  if (Number.isFinite(diagnostic.halfPointWithinYearJumpCount)) parts.push(`同年连续期至少0.5分变化${diagnostic.halfPointWithinYearJumpCount}次`);
  if (Number.isFinite(diagnostic.floorCount) && Number.isFinite(diagnostic.ceilingCount)) parts.push(`触及1或5分${diagnostic.floorCount + diagnostic.ceilingCount}期`);
  return parts.join("；") + "。反转不是经济误报。";
};
for (const patch of patches) {
  const rule = framework.indicators.find((entry) => entry.id === patch.id);
  assert.ok(rule && patch.reason && patch.sampleSummary && Array.isArray(patch.limitations), patch.id);
  assert.ok(["调整", "保留"].includes(patch.decision), patch.id);
  assert.ok(patch.scoring, `${patch.id}: an explicit selected method is required`);
  assert.equal(patch.scoring.method, rule.scoring.method, `${patch.id}: do not substitute an indicator method`);
  if (rule.scoring.components) {
    const structure = (parts) => parts.map(({ anchors, ...part }) => part);
    assert.deepEqual(structure(patch.scoring.components), structure(rule.scoring.components), `${patch.id}: preserve fixed component meanings and weights`);
  }
  if (patch.weight !== undefined) assert.equal(patch.weight, rule.weight);
  if (patch.decision === "保留") assert.deepEqual(numericMethod(patch.scoring), numericMethod(rule.scoring), `${patch.id}: retained scoring must not change`);
  rule.scoring = structuredClone(patch.scoring);
  for (const key of ["definition", "scoringBasis", "requirements", "grades"]) if (patch[key] !== undefined) rule[key] = structuredClone(patch[key]);
  if (!patch.definition && patch.definitionCorrection) rule.definition += ` 本轮说明：${patch.definitionCorrection}`;
  rule.calibration = {
    version: "V1.16", decision: patch.decision, reason: patch.reason,
    sampleSummary: sampleText(patch.sampleSummary), limitations: patch.limitations,
    comparisons: patch.comparisons ?? (patch.candidates ?? []).map((candidate) => ({
      label: candidate.label ?? candidate.name ?? (candidate.key === "baseline" ? "现版" : "不适用"), summary: comparisonText(candidate),
    })),
  };
  if (patch.current?.recommendedScoreIntervalFromKnownPrecision) rule.calibration.precisionRange = {
    minimum: patch.current.recommendedScoreIntervalFromKnownPrecision[0], maximum: patch.current.recommendedScoreIntervalFromKnownPrecision[1],
    rawBound: patch.current.rawErrorBound, unit: rule.unit,
  };
  rule.thresholdStatus = "研究试行：已检查历史评分尺度及候选敏感性；短样本项保留现尺度。不是官方评分标准，未验证真实经济预警误报率或样本外投资表现。";
  if (["piecewise-linear", "weighted-components"].includes(rule.scoring.method)) {
    const curves = rule.scoring.anchors ? [{ label: "指标水平", anchors: rule.scoring.anchors }] : rule.scoring.components;
    rule.grades = [1, 2, 3, 4, 5].map((points) => {
      const refs = curves.flatMap((curve) => curve.anchors.filter((pair) => pair[1] === points).map((pair) => `${curve.label}: ${pair[0]}对应${points}分`));
      return (refs.length ? refs.join("；") : `${points}分语义参考，实际按公开曲线连续计算`) + "；这是分量参照，不是离散分档，完整算法以scoring为准。";
    });
  }
}
framework.version = current.version = "V1.16";
framework.versionDate = current.asOf;
framework.status = "V1.16评分尺度校准：37项、原始数据及已确认权重不变。逐项比较现版、适度收窄与明显收窄；可比历史足够且诊断支持时细化常态区间，两端保留空间，短样本与证据研判项审慎保留。评分尺度诊断不是投资收益回测或真实经济误报率验证。";
framework.scoringMethod.calibration = "当前修订版历史的分阶段敏感性诊断。常态区间细化与极端端点保护分别检查；不为达到预设当期总分调参。数据不足则保留现尺度。未完成当时可得数据回测及独立经济事件预警验证，候选选择仍属研究试行。";
framework.calibrationReview = {
  reviewedCount: 37, adjustedCount: patches.filter((rule) => rule.decision === "调整").length,
  retainedCount: patches.filter((rule) => rule.decision === "保留").length,
  method: framework.scoringMethod.calibration,
  officialMethodology: "https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html",
};
assert.deepEqual(framework.pillars, before.pillars);
assert.deepEqual(framework.ratingBands, before.ratingBands);
assert.deepEqual(framework.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })), before.indicators.map(({ id, weight, pillar }) => ({ id, weight, pillar })));
const oldResult = evaluateMacroRating(before, oldCurrent), result = evaluateMacroRating(framework, current);
const rows = framework.indicators.map((rule) => {
  const observation = current.observations[rule.id];
  const oldRule = before.indicators.find((entry) => entry.id === rule.id);
  const oldPoints = scoreIndicator(oldRule, observation, current.asOf, before.freshness);
  const points = scoreIndicator(rule, observation, current.asOf, framework.freshness);
  assert.notEqual(points, null, `${rule.id}: no evidence gate may be bypassed`);
  const patch = patches.find((entry) => entry.id === rule.id);
  const details = continuousScoreDetails(rule, observation, current.asOf);
  const componentText = details?.components.map((part) => `${part.label}${Number(part.value.toPrecision(10))}${part.unit ?? ""}，分量${part.points.toFixed(2)}分${part.weight < 1 ? `（项内${Math.round(part.weight * 100)}%）` : ""}`).join("；");
  observation.rationale = `本期原始观察为${observation.value}${observation.unit}，统计期${observation.period}，信息截止${current.asOf}。${rule.scoringBasis} 本次尺度${patch.decision}：${patch.reason} ${componentText ? `本期分解：${componentText}。` : ""}按V1.16规则为${points.toFixed(2)}分。原值未改，分数变化是规则校准，不是经济当日变化；完整取舍及验证限制见评分标准。`;
  return { id: rule.id, name: rule.name, weight: rule.weight, previousScore: oldPoints, currentScore: points,
    contributionChange: (points - oldPoints) * rule.weight, decision: patch.decision, reason: patch.reason };
});
current.reviewSummary = `本期按V1.16对37项评分尺度完成逐项复核：调整${framework.calibrationReview.adjustedCount}项、保留${framework.calibrationReview.retainedCount}项。信息截止日、指标、权重和原始观察不变，旧版完整记录本地备份可恢复，公开记录只保留本期新版。历史诊断不等于验证了经济预警误报率或资产配置收益。`;
current.evidenceLimitations = oldCurrent.evidenceLimitations.filter((item) => !/连续节点/.test(item.reason));
current.evidenceLimitations.push({ reason: framework.scoringMethod.calibration });
current.revisionComparison = { previousVersion: before.version, currentVersion: framework.version,
  kind: "同一信息截止日评分尺度校准，不是经济变化", previousScore: oldResult.formalScore,
  currentScore: result.formalScore, rows };
const withoutRationale = (value) => Object.fromEntries(Object.entries(value).map(([id, observation]) => {
  const copy = structuredClone(observation); delete copy.rationale; return [id, copy];
}));
assert.deepEqual(withoutRationale(current.observations), withoutRationale(oldCurrent.observations));
assert.equal(result.status, "正式");
assert.ok(Math.abs(result.coverage - 1) < 1e-9);
assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.contributionChange, 0) - (result.formalScore - oldResult.formalScore)) < 1e-9);
const record = createMacroRatingRecord(framework, current);
const history = { ...appendMacroRatingRecord(read(files.history), record), updatedAt: current.asOf };
write(files.framework, framework);
write(files.current, current);
// The user previously requested only the latest public record; frozen history is recoverable locally.
write(files.history, history);
write("deliverables/macro-v1-16-score-comparison.json", current.revisionComparison);
console.log(JSON.stringify({ version: framework.version, asOf: current.asOf, adjusted: framework.calibrationReview.adjustedCount,
  retained: framework.calibrationReview.retainedCount, previousScore: oldResult.formalScore, score: result.formalScore,
  pillars: result.pillars.map((pillar) => ({ name: pillar.name, score: pillar.observedScore })) }, null, 2));
