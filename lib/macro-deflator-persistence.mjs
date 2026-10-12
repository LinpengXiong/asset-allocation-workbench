const BASIS = "GDP平减指数单季同比派生";
const INDEX_BASIS = "单季实际GDP同比指数，上年同季=100";
const SDDS_PATH = "/english/Statisticaldata/nsdp/201508/t20150831_1238096.html";
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const close = (left, right, tolerance = 1e-6) => finite(left) && finite(right)
  && Math.abs(left - right) <= tolerance;
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const quarterNumber = (value) => typeof value === "string" && /^\d{4}-Q[1-4]$/.test(value)
  ? Number(value.slice(0, 4)) * 4 + Number(value.slice(-1)) : null;
const quarterEnd = (period) => {
  if (quarterNumber(period) === null) return null;
  return new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(-1)) * 3, 0))
    .toISOString().slice(0, 10);
};
const officialUrl = (value) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && (url.hostname === "stats.gov.cn" || url.hostname.endsWith(".stats.gov.cn"))
      && url.pathname === SDDS_PATH && !url.search && !url.hash;
  } catch { return false; }
};

function verifiedObservation(item, asOf) {
  return Boolean(item && finite(item.value) && item.verified === true
    && item.unit === "%" && item.basis === BASIS && item.originalPublisher === "国家统计局"
    && officialUrl(item.sourceUrl) && validDate(asOf) && validDate(item.releaseDate)
    && validDate(item.verifiedAt) && item.releaseDate <= item.verifiedAt && item.verifiedAt <= asOf
    && quarterNumber(item.period) !== null && item.latestAvailablePeriod === item.period
    && item.releaseDate >= quarterEnd(item.period)
    && item.revisionVersion === `${item.releaseDate}-SDDS`);
}

// Original currentNominal/priorNominal/realGrowth evidence predates per-part verifiedAt.
// Preserve those raw records: the containing observation supplies the verified cutoff.
function verifiedRawPart(part, item, asOf) {
  if (!part || !finite(part.value) || quarterNumber(part.period) === null
    || part.originalPublisher !== "国家统计局" || !officialUrl(part.sourceUrl)
    || part.sourceUrl !== item.sourceUrl || part.revisionVersion !== item.revisionVersion
    || !validDate(part.releaseDate) || part.releaseDate !== item.releaseDate
    || part.releaseDate < quarterEnd(part.period)) return false;
  if (Object.hasOwn(part, "verified") && part.verified !== true) return false;
  if (Object.hasOwn(part, "verifiedAt") && (!validDate(part.verifiedAt)
    || part.releaseDate > part.verifiedAt || part.verifiedAt > item.verifiedAt
    || part.verifiedAt > asOf)) return false;
  return true;
}

function derivedDeflatorValue(item, asOf) {
  if (!verifiedObservation(item, asOf)) return null;
  const evidence = item.gdpDeflatorEvidence;
  if (!evidence || evidence.period !== item.period || evidence.revisionVersion !== item.revisionVersion) return null;
  const { currentNominal: current, priorNominal: prior, realGrowth: real, realYoyIndex: index } = evidence;
  if ([current, prior, real, index].some((part) => !verifiedRawPart(part, item, asOf))
    || current.period !== item.period || real.period !== item.period || index.period !== item.period
    || quarterNumber(current.period) - quarterNumber(prior.period) !== 4
    || [current, prior].some((part) => part.unit !== "亿元" || part.basis !== "单季现价GDP" || part.value <= 0)
    || real.unit !== "%" || real.basis !== "单季实际同比" || real.value <= -100
    || index.unit !== "指数点" || index.basis !== INDEX_BASIS || index.value <= 0
    || !close(index.value, 100 + real.value, 1e-9)) return null;
  // Keep the existing GDP derivation, with the original official index as a cross-check.
  const calculated = (current.value / prior.value / (1 + real.value / 100) - 1) * 100;
  const fromIndex = (current.value / prior.value / (index.value / 100) - 1) * 100;
  return close(calculated, fromIndex, 1e-9) && close(item.value, calculated) ? calculated : null;
}

/**
 * Validate one GDP-deflator price-level component without scoring or mutating records.
 * lagQuarters is 0 (observation.value), 1 or 2; each supplied point must have the
 * same SDDS revision/date/source as the latest observation, and a complete raw
 * nominal/current-year-ago/real-GDP triple plus its original real GDP index.
 * Metadata and arithmetic consistency are checked, not independent authenticity
 * of a self-consistently falsified source record; official extraction remains required.
 * The shared scorer must require all three successful calls and must not reweight gaps.
 */
export function validateDeflatorPersistenceInput(item, observation, asOf, lagQuarters) {
  if (!Number.isInteger(lagQuarters) || lagQuarters < 0 || lagQuarters > 2
    || derivedDeflatorValue(observation, asOf) === null || derivedDeflatorValue(item, asOf) === null
    || quarterNumber(observation.period) - quarterNumber(item.period) !== lagQuarters
    || item.revisionVersion !== observation.revisionVersion || item.sourceUrl !== observation.sourceUrl
    || item.releaseDate !== observation.releaseDate
    || lagQuarters === 0 && !close(item.value, observation.value)) return null;
  // Return the saved single-quarter value (including its original precision),
  // never a moving-average value presented as an official statistical observation.
  return item.value;
}
