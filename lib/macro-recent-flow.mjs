export const RECENT_FISCAL_KEY = "recentThreeMonthExpenditureGrowth";
export const RECENT_FISCAL_BASIS = "近3月全国预算支出金额合计同比";
export const RECENT_PROFIT_KEY = "officialThreeMonthProfitGrowthMean";
export const RECENT_PROFIT_BASIS = "近3月官方单月利润可比同比均值";
export const RECENT_PROFIT_SCOPE = "全国规模以上工业企业可比范围";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const same = (left, right, tolerance = 1e-6) => finite(left) && finite(right)
  && Math.abs(left - right) <= tolerance;
const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const monthNumber = (value) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
  ? Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) : null;
const monthEnd = (period) => monthNumber(period) === null ? null
  : new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0))
    .toISOString().slice(0, 10);
const officialUrl = (value, domain) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
};

function verifiedRecord(item, asOf, publisher, domain, requireLatest = true) {
  const end = monthEnd(item?.period);
  return Boolean(item && finite(item.value) && item.verified === true
    && item.originalPublisher === publisher && officialUrl(item.sourceUrl, domain)
    && validDate(asOf) && end !== null && validDate(item.releaseDate) && validDate(item.verifiedAt)
    && end <= item.releaseDate && item.releaseDate <= item.verifiedAt && item.verifiedAt <= asOf
    && (requireLatest ? item.latestAvailablePeriod === item.period
      : !Object.hasOwn(item, "latestAvailablePeriod") || item.latestAvailablePeriod === item.period));
}

function fiscalAmountRecord(item, asOf, series) {
  return verifiedRecord(item, asOf, "财政部", "mof.gov.cn", false)
    && item.value >= 0 && item.unit === "亿元" && item.basis === "年初累计支出金额"
    && item.series === series && item.scope === "全国";
}

/**
 * Check a rolling three-month fiscal amount comparison without altering the saved
 * official cumulative growth rate. Differences are formed from four independently
 * sourced cumulative AMOUNTS, never by subtracting cumulative percentages.
 * January/February are not synthesized from combined 1–2 month publications;
 * the earliest complete within-year three-month window is March–May.
 * This validates documentary/arithmetical consistency, not source authenticity or
 * economic optimality. Original publication review remains a separate obligation.
 */
export function validateRecentFiscalInput(input, observation, asOf, series) {
  if (!["generalBudgetExpenditure", "governmentFundExpenditure"].includes(series)
    || !verifiedRecord(observation, asOf, "财政部", "mof.gov.cn")
    || observation.unit !== "%" || observation.basis !== "全国年初累计支出可比同比"
    || !verifiedRecord(input, asOf, "财政部", "mof.gov.cn")
    || input.unit !== "%" || input.basis !== RECENT_FISCAL_BASIS
    || Object.hasOwn(input, "key") && input.key !== RECENT_FISCAL_KEY
    || input.period !== observation.period) return null;
  const cumulative = observation.fiscalExpenditure;
  if (!cumulative || cumulative.series !== series || cumulative.scope !== "全国"
    || cumulative.period !== observation.period || cumulative.unit !== "亿元"
    || cumulative.basis !== "年初累计可比同比" || !finite(cumulative.cumulativeExpenditure)
    || cumulative.cumulativeExpenditure < 0 || !same(cumulative.reportedYoyPct, observation.value)) return null;
  const raw = input.rawEvidence;
  if (!raw || raw.kind !== "rolling-three-month-cumulative-amounts"
    || raw.comparability?.sameScope !== true || !nonempty(raw.comparability?.revisionNote)) return null;
  const { start: startCurrent, end: endCurrent } = raw.current ?? {};
  const { start: startPrior, end: endPrior } = raw.yearAgo ?? {};
  const parts = [startCurrent, endCurrent, startPrior, endPrior];
  if (parts.some((part) => !fiscalAmountRecord(part, asOf, series))) return null;
  // A release is only used after the corresponding statistical month has ended.
  // A derived record cannot predate any of the underlying publications.
  if (parts.some((part) => part.releaseDate > input.releaseDate || part.verifiedAt > input.verifiedAt)
    || endCurrent.period !== observation.period
    || endCurrent.sourceUrl !== observation.sourceUrl || endCurrent.releaseDate !== observation.releaseDate
    || input.sourceUrl !== endCurrent.sourceUrl || input.releaseDate !== endCurrent.releaseDate
    || !same(endCurrent.value, cumulative.cumulativeExpenditure)) return null;
  if (startCurrent.period.slice(0, 4) !== endCurrent.period.slice(0, 4)
    || startPrior.period.slice(0, 4) !== endPrior.period.slice(0, 4)
    || Number(startCurrent.period.slice(5)) < 2 || Number(startPrior.period.slice(5)) < 2
    || monthNumber(endCurrent.period) - monthNumber(startCurrent.period) !== 3
    || monthNumber(endPrior.period) - monthNumber(startPrior.period) !== 3
    || monthNumber(startCurrent.period) - monthNumber(startPrior.period) !== 12
    || monthNumber(endCurrent.period) - monthNumber(endPrior.period) !== 12) return null;
  const currentAmount = endCurrent.value - startCurrent.value;
  const priorAmount = endPrior.value - startPrior.value;
  if (currentAmount <= 0 || priorAmount <= 0) return null;
  const calculated = (currentAmount / priorAmount - 1) * 100;
  return same(input.value, calculated) ? calculated : null;
}

function officialMonthlyProfitRecord(item, asOf, requireLatest = false) {
  if (!verifiedRecord(item, asOf, "国家统计局", "stats.gov.cn", requireLatest)
    || item.unit !== "%" || item.basis !== "当月可比同比" || item.scope !== RECENT_PROFIT_SCOPE
    || ["01", "02"].includes(item.period.slice(5))) return false;
  const raw = item.rawEvidence;
  return Boolean(raw && same(raw.reportedYoyPct, item.value)
    && raw.notDerivedFromPublishedAmounts === true
    && raw.aggregation === `${Number(item.period.slice(5))}月单月`);
}

/**
 * Validate the arithmetic MEAN of three explicitly published monthly comparable
 * profit rates. It is not the YoY of a three-month sum of published profit amounts:
 * annual sample/base revisions make those quantities non-interchangeable.
 * Missing monthly publications (including combined January–February data) never
 * become zero, estimates, or redistributed weights. Returns null on any gap.
 */
export function validateRecentProfitInput(input, observation, asOf) {
  if (!verifiedRecord(observation, asOf, "国家统计局", "stats.gov.cn")
    || observation.unit !== "%" || observation.basis !== "年初累计可比同比"
    || observation.profitQuality?.sameScope !== true || observation.profitQuality.period !== observation.period
    || !verifiedRecord(input, asOf, "国家统计局", "stats.gov.cn")
    || input.unit !== "%" || input.basis !== RECENT_PROFIT_BASIS
    || input.scope !== RECENT_PROFIT_SCOPE || input.period !== observation.period
    || Object.hasOwn(input, "key") && input.key !== RECENT_PROFIT_KEY
    || Object.hasOwn(input, "label") && (!nonempty(input.label) || !/均值|平均/.test(input.label)
      || /金额|合计/.test(input.label))) return null;
  const raw = input.rawEvidence;
  if (!raw || raw.kind !== "official-monthly-yoy-mean" || !Array.isArray(raw.components)
    || raw.components.length !== 3) return null;
  const parts = raw.components;
  if (parts.some((part, index) => !officialMonthlyProfitRecord(part, asOf)
    || part.releaseDate > input.releaseDate || part.verifiedAt > input.verifiedAt
    || index > 0 && monthNumber(part.period) - monthNumber(parts[index - 1].period) !== 1)
    || parts.at(-1).period !== observation.period || parts.at(-1).sourceUrl !== observation.sourceUrl
    || parts.at(-1).releaseDate !== observation.releaseDate
    || input.sourceUrl !== parts.at(-1).sourceUrl || input.releaseDate !== parts.at(-1).releaseDate) return null;
  // Retain consistency with the separately saved latest monthly observation, if
  // present. An older snapshot without that duplicate does not acquire new data.
  const latestMonthly = observation.scoringInputs?.officialCurrentMonthComparableProfitGrowth;
  if (latestMonthly && (!officialMonthlyProfitRecord(latestMonthly, asOf, true)
    || latestMonthly.period !== observation.period || !same(latestMonthly.value, parts.at(-1).value)
    || latestMonthly.sourceUrl !== parts.at(-1).sourceUrl
    || latestMonthly.releaseDate !== parts.at(-1).releaseDate)) return null;
  const calculated = parts.reduce((sum, part) => sum + part.value, 0) / 3;
  return same(input.value, calculated) ? calculated : null;
}
