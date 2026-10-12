/**
 * Evidence contracts for cumulative-YTD / latest-single-month score components.
 * This module interpolates no statistical observations and never replaces a
 * published main value with a derived value. Earlier piecewise rules do not use
 * this contract, so frozen historical releases retain their original semantics.
 */
export const DUAL_BASIS_RULE_IDS = Object.freeze(["G01", "G17", "G10", "P01E", "P01F"]);
export const FISCAL_MONTHLY_BASIS = "全国当月支出金额同比";
export const FISCAL_AMOUNT_BASIS = "年初累计支出金额";

const definitions = Object.freeze({
  G01: { publisher: "国家统计局", domain: "stats.gov.cn", series: "industrialValueAdded",
    mainKey: "latestMonthGrowth", mainBasis: "当月实际同比", cumulativeBasis: "年初累计实际同比" },
  G17: { publisher: "国家统计局", domain: "stats.gov.cn", series: "goodsRetailSales",
    mainKey: "latestMonthGrowth", mainBasis: "当月名义同比", cumulativeBasis: "年初累计名义同比" },
  G10: { publisher: "海关总署", domain: "customs.gov.cn", series: "goodsExportsUsd",
    mainKey: "latestMonthGrowth", mainBasis: "当月美元金额同比", cumulativeBasis: "年初累计美元金额同比" },
  P01E: { publisher: "财政部", domain: "mof.gov.cn", series: "全国一般公共预算支出",
    fiscalSeries: "generalBudgetExpenditure", mainKey: "yearToDateGrowth",
    mainBasis: "全国年初累计支出可比同比", cumulativeBasis: "全国年初累计支出可比同比" },
  P01F: { publisher: "财政部", domain: "mof.gov.cn", series: "全国政府性基金预算支出",
    fiscalSeries: "governmentFundExpenditure", mainKey: "yearToDateGrowth",
    mainBasis: "全国年初累计支出可比同比", cumulativeBasis: "全国年初累计支出可比同比" },
});
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
  : new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0)).toISOString().slice(0, 10);
const cumulativeScope = (period) => `${period.slice(0, 4)}-01—${period}`;
const officialUrl = (value, definition) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || definition.domain === "customs.gov.cn" && url.protocol === "http:")
      && !url.username && !url.password && !url.port
      && (url.hostname === definition.domain || url.hostname.endsWith(`.${definition.domain}`));
  } catch { return false; }
};
function verifiedRecord(item, asOf, definition, requireLatest = true) {
  const end = monthEnd(item?.period);
  return Boolean(item && finite(item.value) && item.verified === true
    && item.originalPublisher === definition.publisher && officialUrl(item.sourceUrl, definition)
    && validDate(asOf) && end !== null && validDate(item.releaseDate) && validDate(item.verifiedAt)
    && end <= item.releaseDate && item.releaseDate <= item.verifiedAt && item.verifiedAt <= asOf
    && (requireLatest ? item.latestAvailablePeriod === item.period
      : !Object.hasOwn(item, "latestAvailablePeriod") || item.latestAvailablePeriod === item.period));
}
export function isDualBasisRule(rule) {
  return DUAL_BASIS_RULE_IDS.includes(rule?.id) && rule.scoring?.method === "weighted-components"
    && rule.scoring.dualBasis === "year-to-date-and-latest-month";
}

/** Only this explicitly versioned two-component shape enables the new contract. */
export function validateDualBasisObservation(rule, observation, asOf) {
  const definition = definitions[rule?.id];
  if (!isDualBasisRule(rule) || !definition || rule.unit !== "%"
    || rule.measurementBasis !== definition.mainBasis
    || !verifiedRecord(observation, asOf, definition)
    || observation.unit !== "%" || observation.basis !== definition.mainBasis) return false;
  const components = rule.scoring.components;
  if (!Array.isArray(components) || components.length !== 2
    || new Set(components.map((part) => part?.key)).size !== 2
    || components.some((part) => !part || !["yearToDateGrowth", "latestMonthGrowth"].includes(part.key)
      || !nonempty(part.label) || !finite(part.weight) || part.weight <= 0 || part.unit !== "%"
      || part.input !== (part.key === definition.mainKey ? "observation.value"
        : `observation.scoringInputs.${part.key}`)
      || part.basis !== (part.key === "yearToDateGrowth" ? definition.cumulativeBasis
        : definition.fiscalSeries ? FISCAL_MONTHLY_BASIS : definition.mainBasis))
    || !same(components.reduce((sum, part) => sum + part.weight, 0), 1, 1e-9)) return false;
  if (["G01", "G17"].includes(rule.id)) {
    if (observation.period.endsWith("-01")
      || observation.period.endsWith("-02") && observation.periodScope !== "1—2月合并") return false;
  }
  if (definition.fiscalSeries) {
    const fiscal = observation.fiscalExpenditure;
    if (!fiscal || fiscal.series !== definition.fiscalSeries || fiscal.scope !== "全国"
      || fiscal.period !== observation.period || fiscal.unit !== "亿元"
      || fiscal.basis !== "年初累计可比同比" || !finite(fiscal.cumulativeExpenditure)
      || fiscal.cumulativeExpenditure < 0 || !same(fiscal.reportedYoyPct, observation.value)
      || fiscal.originalPublisher !== "财政部" || fiscal.sourceUrl !== observation.sourceUrl
      || fiscal.releaseDate !== observation.releaseDate) return false;
  }
  return true;
}

function cumulativeInput(input, observation, asOf, definition) {
  if (!verifiedRecord(input, asOf, definition) || input.period !== observation.period
    || input.unit !== "%" || input.basis !== definition.cumulativeBasis
    || input.series !== definition.series || input.scope !== "全国"
    || input.periodScope !== cumulativeScope(input.period)
    || input.releaseDate !== observation.releaseDate
    || input.currency !== undefined && (definition.domain !== "customs.gov.cn" || input.currency !== "USD")) return null;
  if (input.period.endsWith("-02") && ["industrialValueAdded", "goodsRetailSales"].includes(definition.series)
    && input.monthlyPeriodScope !== "1—2月合并") return null;
  const raw = input.rawEvidence;
  if (!raw || raw.kind !== "official-dual-yoy-row"
    || !same(raw.reportedMonthlyYoyPct, observation.value)
    || !same(raw.reportedCumulativeYoyPct, input.value)
    || raw.notDerivedFromPublishedAmounts === false) return null;
  // Customs' original monthly table carries a release-vintage identifier. A
  // different vintage cannot be silently attached as the paired cumulative row.
  if (nonempty(observation.revisionVersion)
    && input.revisionVersion !== observation.revisionVersion) return null;
  return input.value;
}

function fiscalAmount(item, asOf, definition) {
  return verifiedRecord(item, asOf, definition, false) && item.value >= 0
    && item.unit === "亿元" && item.basis === FISCAL_AMOUNT_BASIS
    && item.series === definition.series && item.scope === "全国"
    && item.periodScope === cumulativeScope(item.period) && finite(item.reportedYoyPct);
}
function monthlyFiscalInput(input, observation, asOf, definition) {
  if (!verifiedRecord(input, asOf, definition) || input.period !== observation.period
    || input.unit !== "%" || input.basis !== FISCAL_MONTHLY_BASIS
    || input.series !== definition.series || input.scope !== "全国"
    || input.sourceUrl !== observation.sourceUrl || input.releaseDate !== observation.releaseDate
    || !nonempty(input.comparabilityNote)) return null;
  const raw = input.rawEvidence;
  if (!raw || raw.kind !== "single-month-cumulative-amounts"
    || raw.comparability?.sameScope !== true || !nonempty(raw.comparability?.revisionNote)) return null;
  const { preceding: currentPreceding, current } = raw.currentYear ?? {};
  const { preceding: previousPreceding, current: previous } = raw.previousYear ?? {};
  const parts = [currentPreceding, current, previousPreceding, previous];
  if (parts.some((part) => !fiscalAmount(part, asOf, definition)
    || part.releaseDate > input.releaseDate || part.verifiedAt > input.verifiedAt)
    || current.period !== observation.period
    || current.sourceUrl !== observation.sourceUrl || current.releaseDate !== observation.releaseDate
    || !same(current.value, observation.fiscalExpenditure.cumulativeExpenditure)
    || !same(current.reportedYoyPct, observation.value)) return null;
  // A merged January–February publication is not split into invented months;
  // within-year adjacent cumulative AMOUNTS, not cumulative RATES, are required.
  if (Number(current.period.slice(5)) < 3 || Number(previous.period.slice(5)) < 3
    || currentPreceding.period.slice(0, 4) !== current.period.slice(0, 4)
    || previousPreceding.period.slice(0, 4) !== previous.period.slice(0, 4)
    || monthNumber(current.period) - monthNumber(currentPreceding.period) !== 1
    || monthNumber(previous.period) - monthNumber(previousPreceding.period) !== 1
    || monthNumber(current.period) - monthNumber(previous.period) !== 12
    || monthNumber(currentPreceding.period) - monthNumber(previousPreceding.period) !== 12) return null;
  const currentMonthlyAmount = current.value - currentPreceding.value;
  const previousMonthlyAmount = previous.value - previousPreceding.value;
  if (currentMonthlyAmount <= 0 || previousMonthlyAmount <= 0
    || previous.value <= 0 || previousPreceding.value <= 0) return null;
  // Consistency with both currently published cumulative YoYs is a necessary
  // comparability screen, NOT proof that the four reports share a revision.
  if (!same((current.value / previous.value - 1) * 100, current.reportedYoyPct, .06)
    || !same((currentPreceding.value / previousPreceding.value - 1) * 100,
      currentPreceding.reportedYoyPct, .06)) return null;
  const revisions = parts.map((part) => part.revisionVersion);
  if (revisions.some((value) => value !== undefined)
    && (revisions.some((value) => !nonempty(value)) || new Set(revisions).size !== 1)) return null;
  if (raw.comparability.sameRevisionVersion === true && !revisions.every(nonempty)) return null;
  const calculated = (currentMonthlyAmount / previousMonthlyAmount - 1) * 100;
  return same(input.value, calculated) ? calculated : null;
}

/** null on any evidence gap; never redistribute the remaining component weight. */
export function validateDualBasisComponent(rule, observation, component, asOf) {
  if (!validateDualBasisObservation(rule, observation, asOf)
    || !rule.scoring.components.includes(component)) return null;
  const definition = definitions[rule.id];
  if (component.key === definition.mainKey) {
    const duplicate = observation.scoringInputs?.[component.key];
    if (duplicate && (!verifiedRecord(duplicate, asOf, definition)
      || duplicate.period !== observation.period || duplicate.unit !== "%"
      || duplicate.basis !== definition.mainBasis || !same(duplicate.value, observation.value))) return null;
    return observation.value;
  }
  const input = observation.scoringInputs?.[component.key];
  if (input?.key !== undefined && input.key !== component.key) return null;
  return definition.fiscalSeries ? monthlyFiscalInput(input, observation, asOf, definition)
    : cumulativeInput(input, observation, asOf, definition);
}
