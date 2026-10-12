const PEERS = ["AR", "BR", "CL", "CO", "HU", "ID", "IN", "MX", "MY", "PL", "RU", "SA", "TH", "TR", "ZA"];
const BASIS = "部门债务/过去四季名义GDP";
const BIS_BASIS = "BIS同表总信用/过去四季名义GDP，市场价值，断点调整";
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const text = (x) => typeof x === "string" && Boolean(x.trim());
const close = (x, y) => finite(x) && finite(y) && Math.abs(x - y) <= 1e-6;
const date = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || "")
  && Number.isFinite(Date.parse(x + "T00:00:00Z"))
  && new Date(x + "T00:00:00Z").toISOString().slice(0, 10) === x;
const quarter = (x) => {
  const m = /^(\d{4})-Q([1-4])$/.exec(x || "");
  return m ? +m[1] * 4 + +m[2] : null;
};
const periodEnd = (x) => {
  const q = /^(\d{4})-Q([1-4])$/.exec(x || "");
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(x || "");
  const h = /^(\d{4})-H([12])$/.exec(x || "");
  const parts = q ? [+q[1], +q[2] * 3] : m ? [+m[1], +m[2]] : h ? [+h[1], +h[2] * 6] : null;
  return parts ? new Date(Date.UTC(parts[0], parts[1], 0)).toISOString().slice(0, 10) : null;
};
const ageMonths = (x, asOf) => {
  const end = periodEnd(x);
  if (!end || end > asOf) return Infinity;
  return (+asOf.slice(0, 4) - +end.slice(0, 4)) * 12 + +asOf.slice(5, 7) - +end.slice(5, 7)
    + (+asOf.slice(8) > +end.slice(8) ? 1 : 0);
};
const host = (url, domain) => {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:" && domain === "nifd.cn")
      && (u.hostname === domain || u.hostname.endsWith("." + domain));
  } catch { return false; }
};
const publishers = {
  "国家资产负债表研究中心": ["nifd.cn", "cnbs.org.cn"],
  "国家统计局": ["stats.gov.cn"],
  "中国人民银行": ["pbc.gov.cn"],
  "Bank for International Settlements": ["bis.org"],
  "International Monetary Fund": ["imf.org"],
};
const source = (x, asOf) => x && publishers[x.originalPublisher]?.some((domain) => host(x.sourceUrl, domain))
  && date(x.releaseDate) && date(x.verifiedAt) && x.releaseDate <= x.verifiedAt && x.verifiedAt <= asOf;
const record = (x, asOf, options = {}) => {
  const end = periodEnd(x?.period);
  return Boolean(x && text(x.id) && text(x.metric) && text(x.basis) && text(x.unit)
    && (finite(x.value) || text(x.finding)) && source(x, asOf) && end && end <= x.releaseDate
    && (!options.publisher || x.originalPublisher === options.publisher)
    && (!options.unit || x.unit === options.unit)
    && (!options.period || x.period === options.period)
    && (!options.maxAge || ageMonths(x.period, asOf) <= options.maxAge));
};
const section = (x, asOf) => text(x?.limitations) && Array.isArray(x.evidence) && x.evidence.length > 0
  && new Set(x.evidence.map((v) => v?.id)).size === x.evidence.length
  && x.evidence.every((v) => ["月度", "季度"].includes(v?.frequency)
    && record(v, asOf, { maxAge: v.frequency === "月度" ? 3 : 6 }));
const get = (x, id) => x?.evidence?.find((v) => v.id === id);
const numeric = (x, id, unit, publisher, asOf) => {
  const item = get(x, id);
  return record(item, asOf, { unit, publisher, maxAge: item?.frequency === "月度" ? 3 : 6 }) && finite(item.value) ? item.value : null;
};
const sameRecord = (a, b) => a && b && ["id", "metric", "value", "finding", "unit", "period", "basis", "sourceUrl", "releaseDate", "originalPublisher", "scope", "direction"]
  .every((key) => a[key] === b[key]);
const internationalValid = (x, sector, asOf) => {
  if (!x || x.sector !== sector || x.basis !== BIS_BASIS || x.notSafetyThreshold !== true
    || !text(x.limitations) || quarter(x.period) === null || x.latestAvailablePeriod !== x.period
    || ageMonths(x.period, asOf) > 12 || !Array.isArray(x.peers) || x.peers.length !== PEERS.length
    || !source(x.classification, asOf) || x.classification.originalPublisher !== "Bank for International Settlements"
    || !Array.isArray(x.classification.countries) || [...x.classification.countries].sort().join() !== [...PEERS].sort().join()
    || [...x.peers.map((p) => p?.country)].sort().join() !== [...PEERS].sort().join()) return false;
  const all = [x.china, ...x.peers];
  if (x.china?.country !== "CN" || all.some((item) => !record(item, asOf, {
    period: x.period, unit: "%", publisher: "Bank for International Settlements",
  }) || !finite(item.value) || item.value < 0 || item.sector !== sector || item.basis !== BIS_BASIS
    || item.sourceUrl !== x.china.sourceUrl || item.releaseDate !== x.china.releaseDate
    || item.queryKey !== "Q..H+N.A.M.770.A" || item.flow !== "WS_TC" || item.version !== "2.0")) return false;
  try {
    const url = new URL(x.china.sourceUrl);
    if (!url.pathname.includes("/BIS/WS_TC/2.0/Q..H+N.A.M.770.A") || url.searchParams.get("format") !== "csv") return false;
  } catch { return false; }
  const values = x.peers.map((p) => p.value).sort((a, b) => a - b);
  const median = values[7];
  const percentile = 100 * (values.filter((v) => v < x.china.value).length + .5 * values.filter((v) => v === x.china.value).length) / values.length;
  return x.benchmark?.n === values.length && close(x.benchmark.median, median) && close(x.benchmark.percentile, percentile);
};
const gdpValid = (x, domestic, asOf) => {
  const denominator = x?.denominatorEvidence;
  const parts = denominator?.components;
  if (!x || !text(x.summary) || !text(x.revisionVersion) || !text(denominator?.limitation)
    || !Array.isArray(parts) || parts.length !== 8 || parts.some((p) => !record(p, asOf, { publisher: "国家统计局", unit: "亿元" })
      || !finite(p.value) || p.value <= 0 || p.basis !== "单季现价，非不变价GDP" || !text(p.revisionVersion)
      || p.revisionVersion !== parts[0].revisionVersion || p.sourceUrl !== parts[0].sourceUrl || p.releaseDate !== parts[0].releaseDate)
    || parts.some((p, i) => quarter(p.period) === null || i && quarter(p.period) !== quarter(parts[i - 1].period) + 1)
    || parts[7].period !== domestic.period) return false;
  const prior = parts.slice(0, 4).reduce((n, p) => n + p.value, 0);
  const current = parts.slice(4).reduce((n, p) => n + p.value, 0);
  const growth = (current / prior - 1) * 100;
  return close(denominator.priorTtm, prior) && close(denominator.currentTtm, current)
    && close(denominator.nominalGdpGrowthPct, Math.round(growth * 1e6) / 1e6)
    && close(x.nominalGdpGrowthPct, denominator.nominalGdpGrowthPct) && close(x.debtGrowthPct, domestic.debtGrowth.value);
};
const domesticValid = (x, observation, asOf, household) => {
  if (!x || x.period !== observation.period || quarter(x.period) === null || ageMonths(x.period, asOf) > 6
    || x.basis !== BASIS || !text(x.vintageLimitation)) return false;
  const current = x.current, prior = x.yearAgo, last = x.quarterAgo;
  if ([current, prior, last].some((v) => !record(v, asOf, { unit: "%", publisher: "国家资产负债表研究中心" })
    || !finite(v.value) || v.value < 0 || v.basis !== BASIS
    || v.series !== (household ? "householdLeverage" : "corporateLeverage"))
    || current.period !== x.period || quarter(current.period) - quarter(prior.period) !== 4
    || quarter(current.period) - quarter(last.period) !== 1 || current.latestAvailablePeriod !== current.period
    || !close(current.value, observation.leverageRatio) || !close(prior.value, observation.yearAgoLeverageRatio)
    || !close(x.yearOnYearChangePp, current.value - prior.value) || !close(x.quarterOnQuarterChangePp, current.value - last.value)
    || !record(x.debtGrowth, asOf, { period: current.period, unit: "%", publisher: "国家资产负债表研究中心" })
    || !finite(x.debtGrowth.value) || x.debtGrowth.sourceUrl !== current.sourceUrl || x.debtGrowth.releaseDate !== current.releaseDate
    || x.debtGrowth.series !== (household ? "householdDebtGrowth" : "corporateDebtGrowth")
    || ![observation.sourceUrl, observation.sourceDocumentUrl].includes(current.sourceUrl)) return false;
  return gdpValid(x.nominalGdpEffect, x, asOf);
};
const dsrValid = (x, sector, asOf) => {
  if (x.proxyOnly === true) return x.directSectorData === false && x.sectorDsr === null && text(x.unavailabilityReason);
  const dsr = x.sectorDsr;
  if (x.proxyOnly !== false || x.directSectorData !== true || !record(dsr, asOf, { unit: "%", maxAge: 6 })
    || !finite(dsr.value) || dsr.value < 0 || dsr.sector !== sector
    || dsr.scope !== (sector === "H" ? "居民与NPISH" : "全部非金融公司")
    || dsr.basis !== "同部门实际还本付息/同部门收入") return false;
  if (dsr.originalPublisher === "Bank for International Settlements") {
    try { if (!new URL(dsr.sourceUrl).pathname.includes("/BIS/WS_DSR/") || !dsr.queryKey?.endsWith("." + sector)) return false; }
    catch { return false; }
  }
  return true;
};
const deriveState = (matrix, asOf) => {
  const household = matrix.sector === "households";
  const sector = household ? "H" : "N";
  const income = matrix.incomeOrProfit, cash = matrix.servicing, pressure = matrix.pressure;
  const value = (s, id, unit, publisher) => numeric(s, id, unit, publisher, asOf);
  const relative = matrix.international.benchmark.percentile >= 75 && matrix.international.china.value > matrix.international.benchmark.median;
  const incomeValue = value(income, household ? "nominalIncomeGrowth" : "industrialProfitGrowth", "%", "国家统计局");
  const incomeOther = value(income, household ? "medianIncomeGrowth" : "profitMarginChange", household ? "%" : "百分点", "国家统计局");
  const rate = value(cash, household ? "newMortgageRate" : "newEnterpriseRate", "%", "中国人民银行");
  const rateChange = value(cash, household ? "newMortgageRateChange" : "newEnterpriseRateChange", "百分点", "中国人民银行");
  if ([incomeValue, incomeOther, rate, rateChange].some((x) => x === null) || rate < 0) return null;
  const requiredScope = household ? "全国居民" : "规模以上工业企业";
  if (income.evidence.some((x) => x.scope !== requiredScope || x.frequency !== (household ? "季度" : "月度"))
    || household && income.evidence.some((x) => x.period !== matrix.domestic.period)
    || periodEnd(get(cash, household ? "newMortgageRate" : "newEnterpriseRate")?.period) !== periodEnd(matrix.domestic.period)) return null;
  let pressureCount = 0, localConstraint = false;
  if (household) {
    const consumer = value(pressure, "nonMortgageConsumerCreditGrowth", "%", "中国人民银行");
    const mortgage = value(pressure, "mortgageCreditGrowth", "%", "中国人民银行");
    const wealth = get(pressure, "housingWealthPressure");
    if (pressure.evidence.some((x) => x.period !== matrix.domestic.period || x.frequency !== "季度" || x.scope !== "居民部门")
      || consumer === null || mortgage === null || !record(wealth, asOf, { publisher: "国家资产负债表研究中心", maxAge: 6 })
      || !text(wealth.finding) || !["不利", "混合", "改善"].includes(wealth.direction) || wealth.scope !== "居民部门") return null;
    pressureCount = Number(consumer < 0) + Number(wealth.direction === "不利");
    localConstraint = matrix.domestic.debtGrowth.value < 0 && consumer < 0 && mortgage < 0 && wealth.direction === "不利";
  } else {
    const collection = value(pressure, "collectionDaysChange", "天", "国家统计局");
    const inventory = value(pressure, "inventoryDaysChange", "天", "国家统计局");
    if (collection === null || inventory === null || pressure.evidence.some((x) => x.scope !== "规模以上工业企业"
      || x.frequency !== "月度" || x.period !== get(income, "industrialProfitGrowth").period)) return null;
    pressureCount = Number(collection > 0) + Number(inventory > 0);
    localConstraint = matrix.domestic.yearOnYearChangePp > 0 && collection > 0 && inventory > 0;
  }
  const support = incomeValue > 0 && incomeOther >= 0;
  // An absent positive signal is not evidence of deterioration: mixed/zero income is not automatically 2.
  const incomeWeak = incomeValue < 0 && incomeOther < 0;
  const constraint = relative && localConstraint;
  const stress = get(cash, "actualRepaymentStress");
  if (stress && (!record(stress, asOf, { maxAge: 6 }) || stress.sector !== sector || !text(stress.finding)
    || stress.coverage !== "全国部门广覆盖" || !text(stress.assessmentBasis)
    || !["广泛严重", "明显但非危机", "未发现广泛压力"].includes(stress.severity))) return null;
  if (stress?.severity === "广泛严重" && incomeWeak && pressureCount >= 2) return [1, "severe-distress"];
  if (stress?.severity === "明显但非危机" && incomeWeak && pressureCount >= 2 && rateChange > 0) return [1.5, "broad-unmitigated-pressure"];
  if ((constraint || localConstraint) && incomeWeak) return [2, "material-constraints"];
  if (constraint && support) return [2.5, "constraints-partly-mitigated"];
  const priorDsr = get(cash, "priorSectorDsr");
  const improving = !cash.proxyOnly && record(priorDsr, asOf, { unit: "%" }) && priorDsr.sector === sector
    && priorDsr.scope === cash.sectorDsr.scope && priorDsr.basis === cash.sectorDsr.basis
    && priorDsr.originalPublisher === cash.sectorDsr.originalPublisher
    && priorDsr.sourceUrl === cash.sectorDsr.sourceUrl && priorDsr.queryKey === cash.sectorDsr.queryKey
    && quarter(cash.sectorDsr.period) - quarter(priorDsr.period) === 4 && cash.sectorDsr.value < priorDsr.value;
  if (improving && support && pressureCount === 0 && matrix.domestic.yearOnYearChangePp <= 0) {
    // Stronger states require independently audited duration, breadth and tail evidence, never low debt alone.
    const sustained = get(cash, "sustainedDebtServiceImprovement");
    if (sustained && record(sustained, asOf, { maxAge: 6 }) && sustained.sector === sector
      && Number.isInteger(sustained.confirmedQuarters) && sustained.confirmedQuarters >= 2 && text(sustained.finding)
      && Array.isArray(sustained.quarters) && sustained.quarters.length === sustained.confirmedQuarters
      && sustained.quarters.every((q, i) => record(q, asOf, { unit: "%" }) && finite(q.value)
        && q.sector === sector && q.basis === cash.sectorDsr.basis && q.scope === cash.sectorDsr.scope
        && q.sourceUrl === cash.sectorDsr.sourceUrl && q.originalPublisher === cash.sectorDsr.originalPublisher
        && (!i || quarter(q.period) === quarter(sustained.quarters[i - 1].period) + 1 && q.value <= sustained.quarters[i - 1].value))
      && sustained.quarters.at(-1).period === cash.sectorDsr.period) {
      const breadth = get(cash, "tailAndBreadthImprovement");
      if (breadth && record(breadth, asOf, { maxAge: 6 }) && breadth.sector === sector
        && breadth.coverage === "尾部及多群体" && text(breadth.finding)) {
        return sustained.confirmedQuarters >= 4 ? [5, "strong-sustainable-capacity"] : [4.5, "durable-constraint-relief"];
      }
      return [4, "verified-capacity-improvement"];
    }
    return [3.5, "capacity-improving"];
  }
  return [3, "mixed-evidence"];
};

/** Strict, versioned analyst-evidence scoring. International ranks describe burden, not a safety/crisis line. */
export function scoreLeverageMatrix(rule, observation, asOf) {
  if (!rule || !["F09", "F10"].includes(rule.id) || rule.scoring?.method !== "evidence-matrix" || rule.scoring.step !== .5
    || rule.scoring.schemaVersion !== 1 || rule.scoring.primaryReference !== "BIS-emerging-ex-China"
    || !observation || !date(asOf) || observation.verified !== true || !date(observation.verifiedAt)
    || observation.verifiedAt > asOf || !source(observation, asOf) || observation.period !== observation.latestAvailablePeriod
    || observation.originalPublisher !== "国家资产负债表研究中心" || observation.unit !== "1—5分"
    || observation.basis !== "季度杠杆约束研判") return null;
  const m = observation.scoringMatrix, household = rule.id === "F09", sector = household ? "H" : "N";
  if (!m || m.schemaVersion !== 1 || m.method !== "evidence-matrix" || m.step !== .5
    || m.sector !== (household ? "households" : "nonFinancialCorporations") || m.primaryReference !== "BIS-emerging-ex-China"
    || !date(m.reviewDate) || m.reviewDate > asOf || m.reviewDate < observation.releaseDate
    || m.reviewDate.slice(0, 7) !== asOf.slice(0, 7) || !text(m.objective) || !text(m.scoreReason)
    || !domesticValid(m.domestic, observation, m.reviewDate, household) || !internationalValid(m.international, sector, m.reviewDate)
    || quarter(m.international.period) > quarter(observation.period) || quarter(observation.period) - quarter(m.international.period) > 2
    || ![m.incomeOrProfit, m.servicing, m.pressure].every((x) => section(x, m.reviewDate)) || !dsrValid(m.servicing, sector, m.reviewDate)) return null;
  const counter = m.counterEvidence;
  if (!counter || !text(counter.limitations) || !Array.isArray(counter.positive) || !counter.positive.length
    || !Array.isArray(counter.negative) || !counter.negative.length) return null;
  const records = [...m.incomeOrProfit.evidence, ...m.servicing.evidence, ...m.pressure.evidence];
  if ([...counter.positive, ...counter.negative].some((x) => !record(x, m.reviewDate)
    || !records.some((original) => sameRecord(original, x)))) return null;
  const pressureId = household ? "housingWealthPressure" : "collectionDaysChange";
  const positiveIds = new Set(["nominalIncomeGrowth", "medianIncomeGrowth", "wageIncomeGrowth", "industrialProfitGrowth", "privateIndustrialProfitGrowth"]);
  const negativeGrowthIds = new Set(["nominalIncomeGrowth", "medianIncomeGrowth", "industrialProfitGrowth", "nonMortgageConsumerCreditGrowth", "mortgageCreditGrowth"]);
  // The same source record cannot be placed in the opposite-sign evidence bucket to manufacture mitigation.
  if (counter.positive.some((x) => positiveIds.has(x.id) ? !(x.value > 0)
    : ["newMortgageRateChange", "newEnterpriseRateChange"].includes(x.id) ? !(x.value <= 0)
      : x.id === "profitMarginChange" ? !(x.value >= 0) : true)
    || counter.negative.some((x) => negativeGrowthIds.has(x.id) ? !(x.value < 0)
      : ["collectionDaysChange", "inventoryDaysChange"].includes(x.id) ? !(x.value > 0)
        : x.id === "housingWealthPressure" ? !["不利", "混合"].includes(x.direction) : true)
    || !counter.negative.some((x) => x.id === pressureId)) return null;
  const state = deriveState(m, m.reviewDate);
  if (!state || !close(observation.value, state[0]) || !close(m.computedScore, state[0]) || m.matchedState !== state[1]) return null;
  return state[0];
}
