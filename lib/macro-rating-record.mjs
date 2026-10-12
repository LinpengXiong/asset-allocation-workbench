import { evaluateMacroRating, scoreIndicator } from "./macro-rating.mjs";
import { evaluateMacroResearchRating, resolveMacroAssessment } from "./macro-rating-research.mjs";
import { continuousScoreDetails } from "./macro-scoring-continuous.mjs";

const rounded = (value) => value === null ? null : Number(value.toFixed(6));

/** A record freezes what was actually known, including gaps, not a hindsight-completed rating. */
export function createMacroRatingRecord(framework, current) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(current.asOf || "")) throw new Error("A current information cutoff is required");
  if (current.version !== framework.version) throw new Error("Observation and scoring versions differ");
  const result = evaluateMacroRating(framework, current);
  const research = evaluateMacroResearchRating(framework, current).research;
  const rows = framework.indicators.map((rule) => {
    const observation = current.observations?.[rule.id] ?? null;
    const points = scoreIndicator(rule, observation, current.asOf, framework.freshness);
    const gap = current.gaps?.find((item) => item.id === rule.id);
    const resolved = resolveMacroAssessment(framework, current, rule);
    return { id: rule.id, name: rule.name, pillar: rule.pillar, weight: rule.weight,
      points, contribution: points === null ? null : rounded(points * rule.weight),
      researchPoints: resolved.type === "研究暂评" ? resolved.points : null,
      researchAssessment: resolved.assessment,
      scoringDetails: points !== null && ["piecewise-linear", "weighted-components"].includes(rule.scoring?.method)
        ? continuousScoreDetails(rule, observation, current.asOf) : null,
      observation: structuredClone(observation), gap: points === null ? gap?.reason ?? "尚无符合当前规则的完整原始证据" : null };
  });
  const scores = Object.fromEntries(result.pillars.map((item) => [item.name, rounded(item.observedScore)]));
  return {
    id: `${current.asOf}-${framework.version}`,
    type: result.status === "正式" ? "正式评级" : research.count > 0 ? "研究观察" : result.status === "暂定" ? "暂定观察" : "核验记录",
    period: current.asOf.slice(0, 7), asOf: current.asOf, version: framework.version,
    status: result.status, economic: scores.经济运行, growth: scores.增长动力,
    credit: scores.金融信贷, policy: scores.宏观调控,
    score: rounded(result.formalScore), grade: result.grade ?? "未发布正式档位",
    coverage: rounded(result.coverage), pillars: structuredClone(result.pillars),
    research: structuredClone(research),
    researchEvidence: structuredClone(current.researchAssessments ?? {}),
    evidence: current.reviewSummary ?? "原始数据、派生计算与政策研判按本版规则逐项留档。",
    collectionAudit: structuredClone({ sourcePriority: current.sourcePriority ?? [], sourceStatus: current.sourceStatus ?? "",
      latestReleaseChecks: current.latestReleaseChecks ?? [], sourceChecks: current.sourceChecks ?? [],
      evidenceLimitations: current.evidenceLimitations ?? [], gaps: current.gaps ?? [] }),
    revisionComparison: structuredClone(current.revisionComparison ?? null),
    validation: research.count > 0
      ? "权重和分档为研究试行；缺项不默认补中性分。单列研究暂评不增加原值核验覆盖率、不生成正式总分或档位。政策支持不等同经济复苏，宏观评级不直接生成资产配置。"
      : "按本版证据门槛核验评分，缺项不默认补中性分；全部核验只表示符合当前规则，不表示权重和分档已完成回测。政策支持不等同经济复苏，宏观评级不直接生成资产配置。",
    rows, framework: structuredClone(framework),
  };
}

/** New releases append a new snapshot; an already archived cutoff/version must not be silently replaced. */
export function appendMacroRatingRecord(history, snapshot) {
  const snapshots = history.snapshots ?? [];
  if (snapshots.some((item) => item.id === snapshot.id || item.asOf === snapshot.asOf && item.version === snapshot.version)) {
    throw new Error("This cutoff and rule version are already archived; use an explicit new revision");
  }
  return { ...history, snapshots: [...snapshots, snapshot] };
}
