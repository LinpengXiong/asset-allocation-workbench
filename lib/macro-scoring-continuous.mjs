import { PROFIT_BREADTH_BASIS, validateProfitBreadthInput,
  validateStandaloneProfitBreadthObservation } from "./macro-profit-breadth.mjs";
import { validateDeflatorPersistenceInput } from "./macro-deflator-persistence.mjs";
import { isDualBasisRule, validateDualBasisObservation,
  validateDualBasisComponent } from "./macro-dual-basis.mjs";
import { isLoanDualBasisRule, validateLoanDualBasisObservation,
  validateLoanDualBasisComponent, loanDualBasisScoreInput } from "./macro-loan-dual-basis.mjs";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const same = (a, b, tolerance = 1e-6) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const date = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const month = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || "")
  ? Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) : null;
const quarter = (value) => /^\d{4}-Q[1-4]$/.test(value || "")
  ? Number(value.slice(0, 4)) * 4 + Number(value.slice(-1)) : null;
const periodEnd = (value) => {
  if (month(value) !== null) return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5)), 0)).toISOString().slice(0, 10);
  if (quarter(value) !== null) return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(-1)) * 3, 0)).toISOString().slice(0, 10);
  return null;
};
const officialInput = (item, cutoff) => {
  if (!item || item.verified !== true || !finite(item.value) || item.originalPublisher !== "国家统计局"
    || !date(cutoff) || !date(item.releaseDate) || !date(item.verifiedAt)
    || item.releaseDate > item.verifiedAt || item.verifiedAt > cutoff
    || !periodEnd(item.period) || item.releaseDate < periodEnd(item.period)) return false;
  try {
    const url = new URL(item.sourceUrl);
    return url.protocol === "https:" && (url.hostname === "stats.gov.cn" || url.hostname.endsWith(".stats.gov.cn"));
  } catch { return false; }
};

/** Fixed, versioned score anchors; interpolation applies to scores, never to missing statistical observations. */
export function interpolateScore(value, anchors) {
  if (!finite(value) || !Array.isArray(anchors) || anchors.length < 2
    || anchors.some((pair, index) => !Array.isArray(pair) || pair.length !== 2 || !pair.every(finite)
      || pair[1] < 1 || pair[1] > 5 || index > 0 && pair[0] <= anchors[index - 1][0])) return null;
  if (value <= anchors[0][0]) return anchors[0][1];
  if (value >= anchors.at(-1)[0]) return anchors.at(-1)[1];
  const index = anchors.findIndex((pair) => pair[0] >= value);
  const [x0, s0] = anchors[index - 1], [x1, s1] = anchors[index];
  return s0 + (s1 - s0) * (value - x0) / (x1 - x0);
}

function compositeInput(rule, observation, component, asOf) {
  if (isDualBasisRule(rule)) return validateDualBasisComponent(rule, observation, component, asOf);
  if (isLoanDualBasisRule(rule)) return validateLoanDualBasisComponent(rule, observation, component, asOf);
  if (rule.id === "E07") {
    const lags = { currentPriceLevel: 0, previousQuarterPriceLevel: 1, twoQuartersAgoPriceLevel: 2 };
    const lag = lags[component.key];
    if (lag === undefined || component.unit !== "%" || component.basis !== rule.measurementBasis) return null;
    if (lag === 0) return component.input === "observation.value"
      ? validateDeflatorPersistenceInput(observation, observation, asOf, 0) : null;
    return component.input === `observation.scoringInputs.${component.key}`
      ? validateDeflatorPersistenceInput(observation.scoringInputs?.[component.key], observation, asOf, lag) : null;
  }
  if (component.input === "observation.value") {
    const duplicate = observation.scoringInputs?.[component.key];
    if (duplicate && (!officialInput(duplicate, asOf) || !same(duplicate.value, observation.value)
      || duplicate.unit !== observation.unit || duplicate.basis !== observation.basis
      || duplicate.period !== observation.period || duplicate.latestAvailablePeriod !== duplicate.period)) return null;
    return component.unit === observation.unit && component.basis === observation.basis ? observation.value : null;
  }
  if (component.input !== `observation.scoringInputs.${component.key}`) return null;
  const item = observation.scoringInputs?.[component.key];
  if (!officialInput(item, asOf) || item.period !== observation.period || item.latestAvailablePeriod !== item.period
    || item.unit !== component.unit || item.basis !== component.basis) return null;
  const raw = item.rawEvidence;
  if (!raw || typeof raw !== "object") return null;
  let calculated;
  if (rule.id === "E01" && component.key === "quarterYoyChange") {
    const { current, preceding } = raw;
    if (!officialInput(current, asOf) || !officialInput(preceding, asOf)
      || current.period !== observation.period || quarter(current.period) - quarter(preceding.period) !== 1
      || !nonempty(observation.revisionVersion) || item.revisionVersion !== observation.revisionVersion
      || [current, preceding].some((part) => part.revisionVersion !== observation.revisionVersion
        || part.unit !== "%" || part.basis !== "单季实际同比")
      || !same(current.value, observation.value)) return null;
    calculated = current.value - preceding.value;
  } else if (["E08", "E09", "G11"].includes(rule.id) && component.key === "nonOverlappingThreeMonthChange") {
    const parts = raw.components;
    if (!Array.isArray(parts) || parts.length !== 6 || parts.at(-1).period !== observation.period
      || parts.some((part, index) => !officialInput(part, asOf) || part.series !== rule.componentSeries
        || part.unit !== "指数点" || part.basis !== "季调当月指数" || part.value < 0 || part.value > 100
        || month(part.period) === null || index > 0 && month(part.period) - month(parts[index - 1].period) !== 1)
      || !Array.isArray(observation.components) || observation.components.length !== 3
      || parts.slice(3).some((part, index) => part.period !== observation.components[index].period
        || !same(part.value, observation.components[index].value))) return null;
    const latest = parts.slice(3).reduce((sum, part) => sum + part.value, 0) / 3;
    const preceding = parts.slice(0, 3).reduce((sum, part) => sum + part.value, 0) / 3;
    if (!same(observation.value, latest)) return null;
    calculated = latest - preceding;
  } else if (rule.id === "G02") {
    if (item.scope !== "全国规模以上工业企业可比范围" || !observation.profitQuality?.sameScope) return null;
    if (component.key === "industryProfitImprovementBreadth") {
      return validateProfitBreadthInput(item, observation, asOf);
    } else if (component.key === "officialCurrentMonthComparableProfitGrowth") {
      if (item.unit !== "%" || item.basis !== "当月可比同比" || raw.notDerivedFromPublishedAmounts !== true
        || month(item.period) === null || ["01", "02"].includes(item.period.slice(-2))
        || raw.aggregation !== `${Number(item.period.slice(-2))}月单月`) return null;
      calculated = raw.reportedYoyPct;
    } else if (component.key === "reportedProfitMarginYoyChange") {
      if (item.unit !== "百分点" || item.basis !== "年初累计营业收入利润率同比变动"
        || raw.unit !== "%" || raw.reportedChangeUnit !== "百分点" || !nonempty(raw.comparability)
        || !same(raw.currentProfitMargin, observation.profitQuality.profitMargin?.value)) return null;
      calculated = raw.reportedYoyChange;
    } else if (component.key === "reportedReceivablesDaysYoyChange") {
      if (item.unit !== "天" || item.basis !== "月末应收账款平均回收期同比变动"
        || raw.unit !== "天" || raw.reportedChangeUnit !== "天" || !nonempty(raw.comparability)
        || observation.profitQuality.receivables?.unit !== "天"
        || !same(raw.currentReceivablesDays, observation.profitQuality.receivables?.value)) return null;
      calculated = raw.reportedYoyChange;
    } else return null;
  } else return null;
  return same(item.value, calculated) ? calculated : null;
}

/** Return auditable components; invalid/missing evidence never redistributes the remaining weights. */
export function continuousScoreDetails(rule, observation, asOf) {
  if (!rule?.scoring || !finite(observation?.value) || !date(asOf)) return null;
  if (rule.id === "G19" && rule.scoring.method !== "piecewise-linear") return null;
  if (rule.scoring.method === "piecewise-linear") {
    let value = observation.value;
    if (rule.id === "G19") {
      if (rule.unit !== "%" || rule.measurementBasis !== PROFIT_BREADTH_BASIS) return null;
      value = validateStandaloneProfitBreadthObservation(observation, asOf);
      if (value === null) return null;
    }
    const points = interpolateScore(value, rule.scoring.anchors);
    return points === null ? null : { points, components: [{ label: "指标水平", value,
      unit: observation.unit, weight: 1, points }] };
  }
  if (rule.scoring.method !== "weighted-components") return null;
  const verifiedMain = isDualBasisRule(rule) ? validateDualBasisObservation(rule, observation, asOf)
    : isLoanDualBasisRule(rule) ? validateLoanDualBasisObservation(rule, observation, asOf)
      : officialInput(observation, asOf);
  if (!verifiedMain || observation.latestAvailablePeriod !== observation.period
    || observation.unit !== rule.unit || observation.basis !== rule.measurementBasis) return null;
  const parts = rule.scoring.components;
  if (!Array.isArray(parts) || parts.length < 2 || new Set(parts.map((part) => part?.key)).size !== parts.length
    || parts.some((part) => !part || !nonempty(part.key) || !nonempty(part.label) || !finite(part.weight) || part.weight <= 0)
    || !same(parts.reduce((sum, part) => sum + part.weight, 0), 1, 1e-9)) return null;
  const components = [];
  for (const part of parts) {
    const value = compositeInput(rule, observation, part, asOf);
    const scoreValue = isLoanDualBasisRule(rule) ? loanDualBasisScoreInput(observation, part, value) : value;
    const points = interpolateScore(scoreValue, part.anchors);
    if (points === null) return null;
    const detail = { key: part.key, label: part.label, weight: part.weight, unit: part.unit, value, points };
    if (isDualBasisRule(rule)) {
      const evidence = part.input === "observation.value" ? observation
        : observation.scoringInputs[part.key];
      Object.assign(detail, { period: evidence.period, basis: evidence.basis,
        sourceUrl: evidence.sourceUrl, releaseDate: evidence.releaseDate, verifiedAt: evidence.verifiedAt });
      if (evidence.periodScope !== undefined) detail.periodScope = evidence.periodScope;
    }
    if (isLoanDualBasisRule(rule)) {
      const evidence = observation.scoringInputs[part.key];
      Object.assign(detail, { period: evidence.period, basis: evidence.basis,
        sourceUrl: evidence.sourceUrl, releaseDate: evidence.releaseDate, verifiedAt: evidence.verifiedAt,
        roundingErrorBound: evidence.roundingErrorBound });
      if (evidence.periodScope !== undefined) detail.periodScope = evidence.periodScope;
      if (part.scoreTransform === "calendar-month-average") Object.assign(detail,
        { scoreValue, scoreUnit: part.anchorUnit, scoreTransform: part.scoreTransform });
    }
    components.push(detail);
  }
  return { points: components.reduce((sum, part) => sum + part.points * part.weight, 0), components };
}

export function scoreContinuous(rule, observation, asOf) {
  return continuousScoreDetails(rule, observation, asOf)?.points ?? null;
}
