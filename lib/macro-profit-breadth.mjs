export const PROFIT_BREADTH_KEY = "industryProfitImprovementBreadth";
export const PROFIT_BREADTH_BASIS = "年初累计分行业利润改善广度";
export const PROFIT_BREADTH_SCOPE = "全国规模以上工业企业可比范围";

// Fixed GB/T 4754-2017 industrial major groups: never select only favorable rows.
export const PROFIT_BREADTH_INDUSTRIES = Object.freeze([
  "煤炭开采和洗选业", "石油和天然气开采业", "黑色金属矿采选业", "有色金属矿采选业",
  "非金属矿采选业", "开采专业及辅助性活动", "其他采矿业", "农副食品加工业",
  "食品制造业", "酒、饮料和精制茶制造业", "烟草制品业", "纺织业", "纺织服装、服饰业",
  "皮革、毛皮、羽毛及其制品和制鞋业", "木材加工和木、竹、藤、棕、草制品业", "家具制造业",
  "造纸和纸制品业", "印刷和记录媒介复制业", "文教、工美、体育和娱乐用品制造业",
  "石油、煤炭及其他燃料加工业", "化学原料和化学制品制造业", "医药制造业", "化学纤维制造业",
  "橡胶和塑料制品业", "非金属矿物制品业", "黑色金属冶炼和压延加工业",
  "有色金属冶炼和压延加工业", "金属制品业", "通用设备制造业", "专用设备制造业",
  "汽车制造业", "铁路、船舶、航空航天和其他运输设备制造业", "电气机械和器材制造业",
  "计算机、通信和其他电子设备制造业", "仪器仪表制造业", "其他制造业", "废弃资源综合利用业",
  "金属制品、机械和设备修理业", "电力、热力生产和供应业", "燃气生产和供应业", "水的生产和供应业",
]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const same = (a, b, tolerance = 1e-6) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const date = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const periodEnd = (period) => {
  if (!/^\d{4}-(0[2-9]|1[0-2])$/.test(period || "")) return null;
  return new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0)).toISOString().slice(0, 10);
};

function publicationId(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password
      || !(url.hostname === "stats.gov.cn" || url.hostname.endsWith(".stats.gov.cn"))
      || !/^\/(?:sj\/(?:zxfbhjd|zxfb)|xxgk\/sjfb\/zxfb2020|zwfwck\/sjfb)\/\d{6}\/t\d{8}_\d+\.html$/.test(url.pathname)) return null;
    return url.pathname.split("/").at(-1);
  } catch { return null; }
}

function metadataValid(item, asOf) {
  const end = periodEnd(item?.period);
  return item?.verified === true && item.originalPublisher === "国家统计局" && end !== null
    && item.latestAvailablePeriod === item.period && date(asOf) && date(item.releaseDate) && date(item.verifiedAt)
    && end <= item.releaseDate && item.releaseDate <= item.verifiedAt && item.verifiedAt <= asOf
    && publicationId(item.sourceUrl) !== null;
}

const numericToken = (token) => typeof token === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(token)
  ? Number(token) : null;

// Derive direction from the published comparable rate or an explicit special fact,
// not a client-supplied "improving" flag. Retained table tokens make transcription
// consistency auditable; source authenticity still requires original-page review.
function rowDirection(row) {
  if (!finite(row.profit) || row.profitUnit !== "亿元" || !Object.hasOwn(row, "officialYoyPct")
    || ["status", "direction", "improvementStatus", "classification", "state"].some((key) => Object.hasOwn(row, key))) return null;
  const table = row.sourceTableRow;
  if (!table || table.name !== row.name || !same(numericToken(table.profit), row.profit, 1e-9)) return null;

  if (finite(row.officialYoyPct)) {
    if (row.officialSpecialChange !== null || row.priorProfitSign !== "positive"
      || !same(numericToken(table.profitYoy), row.officialYoyPct, 1e-9)) return null;
    // Official numeric rates have a positive comparable base. A fall exceeding
    // 100% means current loss; zero/negative-base percentages must not be invented.
    if (row.officialYoyPct > -100 && row.profit <= 0
      || row.officialYoyPct === -100 && row.profit !== 0
      || row.officialYoyPct < -100 && row.profit >= 0) return null;
    return row.officialYoyPct > 0 ? 1 : row.officialYoyPct < 0 ? -1 : 0;
  }

  const special = row.officialSpecialChange;
  if (row.officialYoyPct !== null || !special || !/^[（(]注\d+[）)]$/.test(table.profitYoy || "")
    || !nonempty(special.originalText) || !special.originalText.includes(row.name)
    || /(?:未|没有|不(?:是|再)?)[^，。；]{0,8}(?:由亏转盈|扭亏为盈|减亏|增亏|由盈转亏)/.test(special.originalText)
    || special.sourceUrl !== row.sourceUrl || special.releaseDate !== row.releaseDate
    || special.period !== row.period) return null;
  if (special.type === "turnaround") {
    return row.priorProfitSign === "negative" && row.profit > 0
      && /由亏转盈|扭亏为盈/.test(special.originalText) ? 1 : null;
  }
  if (special.type === "lossReduction") {
    return row.priorProfitSign === "negative" && row.profit < 0
      && /减亏|亏损(?:额|总额)?(?:同比)?(?:减少|收窄)/.test(special.originalText) ? 1 : null;
  }
  if (special.type === "lossIncrease") {
    return row.priorProfitSign === "negative" && row.profit < 0
      && /增亏|亏损(?:额|总额)?(?:同比)?(?:增加|扩大)/.test(special.originalText) ? -1 : null;
  }
  if (special.type === "turnToLoss") {
    return row.priorProfitSign === "positive" && row.profit < 0
      && /由盈转亏/.test(special.originalText) ? -1 : null;
  }
  return null;
}

// The table gate is identical for a historical G02 component and standalone G19.
// Splitting its score weight must never relax the original 41-industry evidence.
function validatedBreadthTable(item, asOf) {
  if (!metadataValid(item, asOf) || item.unit !== "%" || item.basis !== PROFIT_BREADTH_BASIS
    || item.scope !== PROFIT_BREADTH_SCOPE || !finite(item.value) || item.value < 0 || item.value > 100) return null;
  const raw = item.rawEvidence;
  if (!raw || raw.classification !== "GB/T 4754-2017" || raw.expectedIndustryCount !== 41
    || raw.aggregation !== `1—${Number(item.period.slice(5))}月累计`
    || raw.notDerivedFromPublishedAmounts !== true || !nonempty(raw.comparability)
    || !Array.isArray(raw.industries) || raw.industries.length !== 41) return null;
  const seen = new Set();
  let improving = 0, flat = 0;
  for (const row of raw.industries) {
    if (!row || !PROFIT_BREADTH_INDUSTRIES.includes(row.name) || seen.has(row.name)
      || !metadataValid(row, asOf) || row.period !== item.period || row.releaseDate !== item.releaseDate
      || row.sourceUrl !== item.sourceUrl || row.scope !== PROFIT_BREADTH_SCOPE
      || row.basis !== "年初累计行业利润可比同比") return null;
    seen.add(row.name);
    const direction = rowDirection(row);
    if (direction === null) return null;
    improving += direction === 1 ? 1 : 0;
    flat += direction === 0 ? 1 : 0;
  }
  if (seen.size !== PROFIT_BREADTH_INDUSTRIES.length) return null;
  const calculated = (improving + .5 * flat) / PROFIT_BREADTH_INDUSTRIES.length * 100;
  return same(item.value, calculated) ? calculated : null;
}

/**
 * Preserve the frozen G02 five-component contract for historical recomputation.
 * All 41 fixed groups must be present; missing rows never shrink the denominator.
 */
export function validateProfitBreadthInput(item, observation, asOf) {
  if (!metadataValid(observation, asOf) || item?.key !== PROFIT_BREADTH_KEY
    || !finite(observation.value) || observation.unit !== "%" || observation.basis !== "年初累计可比同比"
    || observation.profitQuality?.sameScope !== true || observation.profitQuality.period !== observation.period
    || item.period !== observation.period || item.releaseDate !== observation.releaseDate
    || publicationId(item.sourceUrl) !== publicationId(observation.sourceUrl)) return null;
  return validatedBreadthTable(item, asOf);
}

/**
 * G19 uses its own breadth observation and raw table, not a G02 loaned value,
 * synthetic profit-growth percentage, or a scoringInputs wrapper. Returning a
 * value certifies documented metadata/table consistency, not live authenticity
 * or the economic optimality of the linear research score.
 */
export function validateStandaloneProfitBreadthObservation(observation, asOf) {
  return observation?.indicatorId === "G19" ? validatedBreadthTable(observation, asOf) : null;
}
