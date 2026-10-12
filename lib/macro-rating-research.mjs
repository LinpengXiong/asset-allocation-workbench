import { evaluateMacroRating, scoreIndicator } from "./macro-rating.mjs";

const ALLOWED_RESEARCH_INDICATORS = new Set(["P01A", "P02B"]);
const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const nonemptyStrings = (value) => Array.isArray(value) && value.length > 0 && value.every(nonempty);
const calendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const monthEnd = (period) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period || "")) return null;
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};
const dateAfterMonths = (value, months) => {
  const [year, month, day] = value.split("-").map(Number);
  const finalDay = new Date(Date.UTC(year, month + months, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, finalDay))).toISOString().slice(0, 10);
};
const rounded = (value) => value === null ? null : Number(value.toFixed(6));
const coverageRatio = (value) => Math.abs(value - 1) < 1e-9 ? 1 : value;

const officialResearchSource = (id, item, reviewDate) => {
  if (!item || !nonempty(item.finding) || !calendarDate(item.releaseDate)
    || item.releaseDate > reviewDate || !nonempty(item.originalPublisher)) return false;
  let url;
  try { url = new URL(item.sourceUrl); } catch { return false; }
  if (url.protocol !== "https:") return false;
  const matches = (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`);
  if (id === "P02B") return matches("pbc.gov.cn") && item.originalPublisher === "中国人民银行";
  if (matches("mof.gov.cn")) return item.originalPublisher === "财政部";
  if (matches("stats.gov.cn")) return item.originalPublisher === "国家统计局";
  return matches("npc.gov.cn") && ["全国人大", "全国人民代表大会", "全国人大常委会", "全国人民代表大会常务委员会"].includes(item.originalPublisher);
};

const researchAssessmentValid = (framework, current, rule, assessment) => {
  const policy = framework.researchAssessmentPolicy;
  if (policy?.enabled !== true || !ALLOWED_RESEARCH_INDICATORS.has(rule.id)
    || !Array.isArray(policy.allowedIndicators) || !policy.allowedIndicators.includes(rule.id)
    || current.version !== framework.version || !calendarDate(current.asOf)) return false;
  if (!assessment || assessment.status !== "研究暂评" || !Number.isInteger(assessment.points)
    || assessment.points < 1 || assessment.points > 5 || !nonempty(assessment.rationale)
    || !["低", "中", "高"].includes(assessment.confidence)
    || !nonemptyStrings(assessment.unknowns) || !nonemptyStrings(assessment.counterEvidence)
    || !nonempty(assessment.thresholdComparison)
    || !/(不是|不代表|不意味着|不宣称|并非).*(已验证落档|已核验落档|实际值.*落入|实际值.*落档)/.test(assessment.thresholdComparison)
    || !calendarDate(assessment.reviewDate) || assessment.reviewDate > current.asOf
    || assessment.reviewDate.slice(0, 7) !== current.asOf.slice(0, 7)
    || !Array.isArray(assessment.evidence) || !assessment.evidence.length
    || !assessment.evidence.every((item) => officialResearchSource(rule.id, item, assessment.reviewDate))) return false;
  if (rule.id === "P01A") return /^\d{4}$/.test(assessment.period || "") && assessment.period === current.asOf.slice(0, 4);
  const end = monthEnd(assessment.period);
  const maxAge = framework.freshness?.monthlyMaxAgeMonths ?? 3;
  return Boolean(end && end <= assessment.reviewDate && end <= current.asOf
    && Number.isInteger(maxAge) && maxAge >= 0 && current.asOf <= dateAfterMonths(end, maxAge));
};

/** Officially verified observations always win; an explicit research judgment never certifies a missing raw value. */
export function resolveMacroAssessment(framework, current, rule) {
  if (!rule || !current || !framework.indicators?.some((active) => active.id === rule.id)) return { points: null, type: "待核验", assessment: null };
  const strictPoints = scoreIndicator(rule, current.observations?.[rule.id], current.asOf, framework.freshness);
  if (strictPoints !== null) return { points: strictPoints, type: "核验评分", assessment: null };
  const assessment = current.researchAssessments?.[rule.id];
  if (!researchAssessmentValid(framework, current, rule, assessment)) return { points: null, type: "待核验", assessment: null };
  return { points: assessment.points, type: "研究暂评", assessment: structuredClone(assessment) };
}

/** The returned strict coverage/formal score are untouched; research coverage is a separate, non-formal channel. */
export function evaluateMacroResearchRating(framework, current) {
  const strict = evaluateMacroRating(framework, current);
  const resolved = framework.indicators.map((rule) => ({ rule, ...resolveMacroAssessment(framework, current, rule) }));
  const rated = resolved.filter((item) => item.points !== null);
  const researchCount = rated.filter((item) => item.type === "研究暂评").length;
  const coveredWeight = rated.reduce((sum, item) => sum + item.rule.weight, 0);
  const complete = rated.length === framework.indicators.length && Math.abs(coveredWeight - 1) < 1e-9;
  const research = {
    count: researchCount,
    countTotal: rated.length,
    indicatorCount: framework.indicators.length,
    coverage: coverageRatio(coveredWeight),
    score: researchCount > 0 && complete ? rounded(rated.reduce((sum, item) => sum + item.rule.weight * item.points, 0)) : null,
    grade: null,
    pillars: Object.entries(framework.pillars).map(([name, weight]) => {
      const rules = resolved.filter((item) => item.rule.pillar === name);
      const scored = rules.filter((item) => item.points !== null);
      const covered = scored.reduce((sum, item) => sum + item.rule.weight, 0);
      return {
        name,
        count: scored.length,
        indicatorCount: rules.length,
        score: scored.length === rules.length && Math.abs(covered - weight) < 1e-9
          ? rounded(scored.reduce((sum, item) => sum + item.rule.weight * item.points, 0) / weight) : null,
        coverage: coverageRatio(covered / weight),
        researchCount: scored.filter((item) => item.type === "研究暂评").length,
      };
    }),
  };
  return { ...strict, research };
}
