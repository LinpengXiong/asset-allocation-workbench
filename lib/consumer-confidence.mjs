const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export function normalizePeriod(raw) {
  if (typeof raw !== "string") return null;
  const match = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : null;
}

export function parseOfficialLevel(text, period) {
  if (!MONTH_PATTERN.test(period) || typeof text !== "string") return null;
  const [year, month] = period.split("-");
  const arabicMonth = String(Number(month));
  const periodMention = new RegExp(`${year}年\\s*${arabicMonth}月(?:份)?`).test(text)
    || new RegExp(`${arabicMonth}月份`).test(text);
  if (!periodMention) return null;
  const patterns = [
    /消费者信心指数(?:为|是|达到|回升至|降至)\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*(?:点)?/g,
    /([0-9]{1,3}(?:\.[0-9]+)?)\s*点的消费者信心指数/g,
  ];
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 1) {
      const value = Number(matches[0][1]);
      if (value >= 0 && value <= 200) return value;
    }
  }
  return null;
}

export function normalizeObservations(observations, provenance) {
  if (!Array.isArray(observations)) throw new Error("消费者信心序列观测值必须为数组");
  const rows = new Map();
  for (const observation of observations) {
    const period = normalizePeriod(observation.period ?? observation.date);
    const value = observation.value;
    if (!period || (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 200))) continue;
    if (value === null) continue;
    if (rows.has(period) && rows.get(period).value !== value) throw new Error(`消费者信心序列 ${period} 出现重复冲突值`);
    rows.set(period, { ...provenance, ...observation, period, value,
      sourceUrl: observation.sourceUrl ?? provenance.sourceUrl ?? null });
  }
  return [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function mergeBySourcePriority(...sources) {
  const merged = new Map();
  for (const rows of sources) {
    for (const row of rows) {
      if (!merged.has(row.period)) merged.set(row.period, row);
    }
  }
  return [...merged.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function expectedPeriods(start, end) {
  if (!MONTH_PATTERN.test(start) || !MONTH_PATTERN.test(end) || start > end) throw new Error("月份范围必须为 YYYY-MM 且起点不晚于终点");
  const periods = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    periods.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return periods;
}

export function coverage(rows, start, end) {
  const present = new Set(rows.map((row) => row.period));
  const expected = expectedPeriods(start, end);
  return { expected: expected.length, found: expected.filter((period) => present.has(period)).length,
    missing: expected.filter((period) => !present.has(period)) };
}
