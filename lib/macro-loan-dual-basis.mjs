/**
 * V1.21 loan flow contracts. Amount differences, never rates calculated using
 * zero/negative new lending, compare the same department and currency scope.
 * Earlier three-month rules and their frozen observations remain untouched.
 */
export const LOAN_DUAL_BASIS_MARKER = "loan-year-to-date-and-latest-month";
export const LOAN_YTD_BASIS = "年初累计新增额同比多增";
export const LOAN_MONTH_BASIS = "当月新增额同比多增";
export const LOAN_AMOUNT_BASIS = "年初累计新增";
export const LOAN_SCOPE = "全国金融机构人民币贷款";
const LEGACY_BASIS = "近3月当月新增额同比多增";
const definitions = Object.freeze({ F01: "householdLong", F02: "enterpriseLong" });
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const same = (a, b, tolerance = 1e-6) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const date = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const month = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || "")
  ? Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) : null;
const end = (value) => month(value) === null ? null
  : new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5)), 0)).toISOString().slice(0, 10);
const ytdScope = (period) => `${period.slice(0, 4)}-01—${period}`;
const officialUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === "pbc.gov.cn" || url.hostname.endsWith(".pbc.gov.cn"));
  } catch { return false; }
};
function record(item, asOf, requireLatest = true) {
  return Boolean(item && finite(item.value) && item.verified === true && date(asOf)
    && item.originalPublisher === "中国人民银行" && officialUrl(item.sourceUrl)
    && end(item.period) !== null && date(item.releaseDate) && date(item.verifiedAt)
    && end(item.period) <= item.releaseDate && item.releaseDate <= item.verifiedAt
    && item.verifiedAt <= asOf && (requireLatest ? item.latestAvailablePeriod === item.period
      : item.latestAvailablePeriod === undefined || item.latestAvailablePeriod === item.period));
}
export function isLoanDualBasisRule(rule) {
  return Object.hasOwn(definitions, rule?.id ?? "") && rule.scoring?.method === "weighted-components"
    && rule.scoring.dualBasis === LOAN_DUAL_BASIS_MARKER;
}

/** The retained legacy primary value is provenance only, not a scored component. */
export function validateLoanDualBasisObservation(rule, observation, asOf) {
  if (!isLoanDualBasisRule(rule) || rule.unit !== "亿元" || rule.originalPublisher !== "中国人民银行"
    || rule.measurementBasis !== LEGACY_BASIS
    || rule.componentSeries !== definitions[rule.id] || rule.aggregation !== undefined
    || !record(observation, asOf) || observation.unit !== "亿元" || observation.basis !== LEGACY_BASIS) return false;
  const parts = rule.scoring.components;
  if (!Array.isArray(parts) || parts.length !== 2 || new Set(parts.map((part) => part?.key)).size !== 2
    || parts.some((part) => !part || !["yearToDateMoreIncrease", "latestMonthMoreIncrease"].includes(part.key)
      || !nonempty(part.label) || !finite(part.weight) || part.weight <= 0 || part.unit !== "亿元"
      || part.input !== `observation.scoringInputs.${part.key}`
      || part.basis !== (part.key === "yearToDateMoreIncrease" ? LOAN_YTD_BASIS : LOAN_MONTH_BASIS)
      || (part.key === "yearToDateMoreIncrease"
        ? part.scoreTransform !== "calendar-month-average" || part.anchorUnit !== "亿元/月"
        : part.scoreTransform !== undefined || part.anchorUnit !== "亿元"))
    || !same(parts.reduce((sum, part) => sum + part.weight, 0), 1, 1e-9)) return false;
  // January needs a separate direct-month publication contract. It is never
  // manufactured by subtracting December from the reset January YTD value.
  if (Number(observation.period.slice(5)) < 2) return false;
  const legacy = observation.components;
  if (!Array.isArray(legacy) || legacy.length !== 6 || legacy.at(-1).period !== observation.period
    || legacy.some((item, index) => !finite(item?.value) || item.unit !== "亿元" || item.basis !== "当月新增"
      || item.series !== definitions[rule.id] || item.originalPublisher !== "中国人民银行"
      || !officialUrl(item.sourceUrl) || end(item.period) === null || !date(item.releaseDate)
      || item.releaseDate < end(item.period) || item.releaseDate > observation.releaseDate
      || index > 0 && index !== 3 && month(item.period) - month(legacy[index - 1].period) !== 1)
    || legacy.slice(3).some((item, index) => month(item.period) - month(legacy[index].period) !== 12)
    || !same(observation.value, legacy.slice(3).reduce((sum, item) => sum + item.value, 0)
      - legacy.slice(0, 3).reduce((sum, item) => sum + item.value, 0))) return false;
  return true;
}
function inputRecord(input, observation, asOf, definition, basis) {
  return record(input, asOf) && input.period === observation.period && input.unit === "亿元"
    && input.basis === basis && input.series === definition && input.scope === LOAN_SCOPE
    && input.currency === "CNY" && input.sourceUrl === observation.sourceUrl
    && input.releaseDate === observation.releaseDate && input.verifiedAt <= observation.verifiedAt
    && finite(input.roundingErrorBound) && input.roundingErrorBound > 0;
}
function amount(item, input, asOf, definition) {
  return record(item, asOf, false) && item.unit === "亿元" && item.basis === LOAN_AMOUNT_BASIS
    && item.series === definition && item.scope === LOAN_SCOPE && item.currency === "CNY"
    && item.periodScope === ytdScope(item.period) && item.releaseDate <= input.releaseDate
    && item.verifiedAt <= input.verifiedAt && finite(item.roundingUnit) && item.roundingUnit > 0;
}
function comparable(raw, parts) {
  if (raw?.comparability?.sameScope !== true || !nonempty(raw.comparability.revisionNote)
    || !nonempty(raw.comparability.roundingNote)) return false;
  if (raw.comparability.sameRevisionVersion === true
    && (parts.some((item) => !nonempty(item.revisionVersion))
      || new Set(parts.map((item) => item.revisionVersion)).size !== 1)) return false;
  return true;
}
const endpointKeys = ["period", "value", "unit", "basis", "series", "scope", "currency", "periodScope",
  "originalPublisher", "sourceUrl", "releaseDate", "verified", "verifiedAt", "roundingUnit", "revisionVersion"];
const sameEndpoint = (left, right) => left && right && endpointKeys.every((key) => left[key] === right[key]);

function monthlyInput(rule, observation, asOf) {
  const input = observation.scoringInputs?.latestMonthMoreIncrease;
  const definition = definitions[rule.id];
  if (!inputRecord(input, observation, asOf, definition, LOAN_MONTH_BASIS)
    || input.key !== undefined && input.key !== "latestMonthMoreIncrease") return null;
  const raw = input.rawEvidence;
  if (raw?.kind !== "loan-single-month-cumulative-amounts") return null;
  const { preceding: currentPreceding, current } = raw.currentYear ?? {};
  const { preceding: previousPreceding, current: previous } = raw.previousYear ?? {};
  const parts = [currentPreceding, current, previousPreceding, previous];
  if (parts.some((item) => !amount(item, input, asOf, definition)) || !comparable(raw, parts)
    || current.period !== observation.period || current.sourceUrl !== observation.sourceUrl
    || current.releaseDate !== observation.releaseDate
    || currentPreceding.period.slice(0, 4) !== current.period.slice(0, 4)
    || previousPreceding.period.slice(0, 4) !== previous.period.slice(0, 4)
    || month(current.period) - month(currentPreceding.period) !== 1
    || month(previous.period) - month(previousPreceding.period) !== 1
    || month(current.period) - month(previous.period) !== 12
    || month(currentPreceding.period) - month(previousPreceding.period) !== 12) return null;
  const currentMonth = current.value - currentPreceding.value;
  const previousMonth = previous.value - previousPreceding.value;
  // Negative new lending and repayment-dominated months are valid amounts.
  // Their YoY amount difference has no denominator and cannot flip sign.
  const value = currentMonth - previousMonth;
  const roundingErrorBound = parts.reduce((sum, item) => sum + item.roundingUnit / 2, 0);
  if (!same(input.value, value) || !same(input.roundingErrorBound, roundingErrorBound)
    || !same(currentMonth, observation.components[5].value)
    || !same(previousMonth, observation.components[2].value)
    || previous.sourceUrl !== observation.components[2].sourceUrl
    || previous.releaseDate !== observation.components[2].releaseDate) return null;
  return { input, value, current, previous };
}
function cumulativeInput(rule, observation, asOf, monthly) {
  const input = observation.scoringInputs?.yearToDateMoreIncrease;
  const definition = definitions[rule.id];
  if (!inputRecord(input, observation, asOf, definition, LOAN_YTD_BASIS)
    || input.key !== undefined && input.key !== "yearToDateMoreIncrease"
    || input.periodScope !== ytdScope(input.period)) return null;
  const raw = input.rawEvidence;
  if (raw?.kind !== "loan-year-to-date-amount-difference") return null;
  const { current, previous } = raw;
  if (![current, previous].every((item) => amount(item, input, asOf, definition))
    || !comparable(raw, [current, previous]) || current.period !== observation.period
    || month(current.period) - month(previous.period) !== 12
    || !sameEndpoint(current, monthly.current) || !sameEndpoint(previous, monthly.previous)) return null;
  const value = current.value - previous.value;
  const roundingErrorBound = (current.roundingUnit + previous.roundingUnit) / 2;
  return same(input.value, value) && same(input.roundingErrorBound, roundingErrorBound) ? value : null;
}
/** Missing, mismatched or differently scoped endpoints invalidate both scores. */
export function validateLoanDualBasisComponent(rule, observation, component, asOf) {
  if (!validateLoanDualBasisObservation(rule, observation, asOf)
    || !rule.scoring.components.includes(component)) return null;
  const monthly = monthlyInput(rule, observation, asOf);
  if (!monthly) return null;
  const cumulative = cumulativeInput(rule, observation, asOf, monthly);
  if (cumulative === null) return null;
  return component.key === "yearToDateMoreIncrease" ? cumulative : monthly.value;
}
export function loanDualBasisScoreInput(observation, component, value) {
  if (!finite(value)) return null;
  return component.key === "yearToDateMoreIncrease" && component.scoreTransform === "calendar-month-average"
    && month(observation.period) !== null ? value / Number(observation.period.slice(5)) : value;
}

/** Frozen finite-sample trial scales; never recenter a period of contraction to 3. */
export const LOAN_TRIAL_SCALES = Object.freeze({
  F01: Object.freeze({ latestMonth: Object.freeze({ inner: 800, outer: 2800 }),
    cumulativeMonthAverage: Object.freeze({ inner: 300, outer: 800 }) }),
  F02: Object.freeze({ latestMonth: Object.freeze({ inner: 1500, outer: 3800 }),
    cumulativeMonthAverage: Object.freeze({ inner: 1600, outer: 2100 }) }),
});
export const loanTrialAnchors = (scale) => [[-scale.outer, 1], [-scale.inner, 2], [0, 3],
  [scale.inner, 4], [scale.outer, 5]];
const quantile = (values, probability) => {
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * probability;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};
/** Reproducible distribution diagnostics, not a forecast or return backtest. */
export function buildLoanDualBasisScaleDiagnostics(rows) {
  if (!Array.isArray(rows) || new Set(rows.map((row) => row?.period)).size !== rows.length) return null;
  const byMonth = new Map(rows.map((row) => [row.period, row]));
  const endpoints = (period, series) => {
    const item = byMonth.get(period);
    return item && item.reportedBasis === "ytd" && officialUrl(item.url) && finite(item[`${series}Ytd`])
      ? { period, value: item[`${series}Ytd`], sourceUrl: item.url,
        unit: "亿元", basis: LOAN_AMOUNT_BASIS, originalPublisher: "中国人民银行", series } : null;
  };
  const comparison = (period, series) => {
    const year = Number(period.slice(0, 4)), m = Number(period.slice(5));
    const current = endpoints(period, series), previous = endpoints(`${year - 1}${period.slice(4)}`, series);
    const precedingPeriod = `${year}-${String(m - 1).padStart(2, "0")}`;
    const currentPreceding = m === 1 ? null : endpoints(precedingPeriod, series);
    const previousPreceding = m === 1 ? null : endpoints(`${year - 1}${precedingPeriod.slice(4)}`, series);
    if (!current || !previous || m !== 1 && (!currentPreceding || !previousPreceding)) return null;
    const currentMonthAmount = current.value - (currentPreceding?.value ?? 0);
    const previousMonthAmount = previous.value - (previousPreceding?.value ?? 0);
    const yearToDateMoreIncrease = current.value - previous.value;
    return { period, current, previous, ...(m !== 1 ? { currentPreceding, previousPreceding } : {}),
      januaryNote: m === 1 ? "历史尺度诊断中1月累计即1月；实时四端点契约暂不支持1月。" : undefined,
      currentMonthAmount, previousMonthAmount, latestMonthMoreIncrease: currentMonthAmount - previousMonthAmount,
      yearToDateMoreIncrease, cumulativeMonthAverage: yearToDateMoreIncrease / m };
  };
  const result = {};
  for (const [id, series] of Object.entries(definitions)) {
    const training = Array.from({ length: 12 }, (_, index) => comparison(`2025-${String(index + 1).padStart(2, "0")}`, series));
    const holdout = rows.filter((row) => row.period >= "2026-01" && row.period <= "2026-08")
      .map((row) => comparison(row.period, series));
    if (training.some((item) => !item) || holdout.some((item) => !item)) return null;
    const statistics = (key) => {
      const values = training.map((item) => item[key]), absolute = values.map(Math.abs);
      return { n: values.length, minimum: Math.min(...values), maximum: Math.max(...values),
        negativeCount: values.filter((value) => value < 0).length,
        absoluteP50: quantile(absolute, .5), absoluteP90: quantile(absolute, .9),
        roundedInner: Math.round(quantile(absolute, .5) / 100) * 100,
        roundedOuter: Math.round(quantile(absolute, .9) / 100) * 100 };
    };
    result[id] = { series, training, holdout,
      latestMonth: statistics("latestMonthMoreIncrease"),
      cumulativeMonthAverage: statistics("cumulativeMonthAverage"), fixedTrialScales: LOAN_TRIAL_SCALES[id] };
  }
  return result;
}
