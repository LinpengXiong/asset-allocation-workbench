import assert from "node:assert/strict";
import test from "node:test";
import {
  coverage,
  mergeBySourcePriority,
  normalizeObservations,
  normalizePeriod,
  parseOfficialLevel,
} from "../lib/consumer-confidence.mjs";

test("normalizes monthly dates without silently changing periods", () => {
  assert.equal(normalizePeriod("2020-02-15"), "2020-02");
  assert.equal(normalizePeriod("2020-13-01"), null);
  assert.equal(normalizePeriod("2020-00"), null);
  assert.equal(normalizePeriod("not-a-date"), null);
});

test("accepts an exact official index level but not a month-on-month change", () => {
  assert.equal(parseOfficialLevel("2024年10月份，消费者信心指数为88.4点，比上月回升1.2点。", "2024-10"), 88.4);
  assert.equal(parseOfficialLevel("2024年10月份，消费者信心指数比上月回升1.2点。", "2024-10"), null);
  assert.equal(parseOfficialLevel("2024年9月份，消费者信心指数为88.4点。", "2024-10"), null);
});

test("normalizes provenance and rejects conflicts within one vendor series", () => {
  const rows = normalizeObservations([{ date: "2020-01-01", value: 126.4, sourceUrl: "https://www.stats.gov.cn/x" }], {
    sourceId: "NBS", unit: "点", frequency: "月度",
  });
  assert.deepEqual(rows[0], { sourceId: "NBS", unit: "点", frequency: "月度", date: "2020-01-01", value: 126.4,
    period: "2020-01", sourceUrl: "https://www.stats.gov.cn/x" });
  assert.throws(() => normalizeObservations([
    { date: "2020-01", value: 126 }, { date: "2020-01-15", value: 127 },
  ], {}), /重复冲突值/);
});

test("merges by official, Wind, then Caixin priority and reports missing months", () => {
  const official = [{ period: "2020-01", value: 1, sourceId: "NBS" }];
  const wind = [{ period: "2020-01", value: 2, sourceId: "Wind" }, { period: "2020-02", value: 3, sourceId: "Wind" }];
  const caixin = [{ period: "2020-02", value: 4, sourceId: "Caixin" }, { period: "2020-03", value: 5, sourceId: "Caixin" }];
  const rows = mergeBySourcePriority(official, wind, caixin);
  assert.deepEqual(rows.map((row) => [row.period, row.value, row.sourceId]), [
    ["2020-01", 1, "NBS"], ["2020-02", 3, "Wind"], ["2020-03", 5, "Caixin"],
  ]);
  assert.deepEqual(coverage(rows, "2020-01", "2020-04"), {
    expected: 4, found: 3, missing: ["2020-04"],
  });
});
