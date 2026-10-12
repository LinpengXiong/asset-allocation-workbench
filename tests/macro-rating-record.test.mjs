import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { createMacroRatingRecord, appendMacroRatingRecord } from "../lib/macro-rating-record.mjs";
import { evaluateMacroRating, scoreIndicator } from "../lib/macro-rating.mjs";

const framework = JSON.parse(await readFile(new URL("../app/data/macro-rating-v1.json", import.meta.url), "utf8"));
const legacyFramework = JSON.parse(await readFile(new URL("../deliverables/macro-rating-framework-before-v1-15-2026-10-11.json", import.meta.url), "utf8"));
const economicArchive = JSON.parse(await readFile(new URL("../deliverables/macro-economic-current-candidates.json", import.meta.url), "utf8"));
// Preserve archived hard-band fixtures; current live records are checked independently below.
const economic = { ...economicArchive, version: legacyFramework.version };

test("current original economic releases pass all eight gates without substituting cumulative or single-month PMI", () => {
  const record = createMacroRatingRecord(legacyFramework, economic);
  assert.deepEqual(record.rows.filter((row) => row.pillar === "经济运行").map((row) => [row.id, row.points]),
    [["E01", 3], ["E02", 3], ["E03", 4], ["E04", 4], ["E05", 3], ["E07", 5], ["E08", 2], ["E09", 2]]);
  assert.equal(record.economic, 3.333333);
});

test("an evidence record preserves gaps and never invents a formal total", () => {
  const record = createMacroRatingRecord(legacyFramework, economic);
  assert.equal(record.type, "核验记录");
  assert.equal(record.score, null);
  assert.equal(record.grade, "未发布正式档位");
  assert.equal(record.coverage, .3);
  assert.equal(record.growth, null);
  assert.equal(record.rows.length, 37);
  assert.equal(record.rows.filter((row) => row.points === null).length, 29);
  assert.ok(record.rows.filter((row) => row.points === null).every((row) => row.gap));
});

test("archived observations, sources, thresholds and weights are frozen independently of later inputs", () => {
  const input = structuredClone(economic), rules = structuredClone(legacyFramework);
  const record = createMacroRatingRecord(rules, input);
  input.observations.E01.value = -100;
  rules.indicators[0].weight = 1;
  assert.equal(record.rows[0].observation.value, 4.3);
  assert.equal(record.framework.indicators[0].weight, .09);
  assert.ok(Math.abs(evaluateMacroRating(record.framework, { asOf: record.asOf, observations: Object.fromEntries(record.rows.map((row) => [row.id, row.observation])) }).coverage - .3) < 1e-9);
});

test("record creation requires matching versions and never silently overwrites an archived cutoff", () => {
  assert.throws(() => createMacroRatingRecord(legacyFramework, { ...economic, version: "V1.0" }), /versions differ/);
  assert.throws(() => createMacroRatingRecord(legacyFramework, { ...economic, asOf: null }), /cutoff/);
  const record = createMacroRatingRecord(legacyFramework, economic);
  const history = appendMacroRatingRecord({ snapshots: [] }, record);
  assert.equal(history.snapshots.length, 1);
  assert.throws(() => appendMacroRatingRecord(history, record), /already archived/);
  assert.equal(history.snapshots.length, 1);
});

test("formal records freeze the verified RRR action ledger without substituting or duplicating a research judgment", async () => {
  const current = JSON.parse(await readFile(new URL("../app/data/macro-rating-current.json", import.meta.url), "utf8"));
  const input = structuredClone(current), rules = structuredClone(framework);
  const record = createMacroRatingRecord(rules, input);
  assert.equal(record.type, "正式评级");
  assert.equal(record.grade, "III档 条件中性");
  assert.equal(record.coverage, 1);
  assert.equal(record.research.count, 0);
  assert.equal(record.research.countTotal, 38);
  assert.equal(record.research.coverage, 1);
  const expected = Number(framework.indicators.reduce((sum, rule) => {
    const points = scoreIndicator(rule, current.observations[rule.id], current.asOf, framework.freshness);
    assert.notEqual(points, null, rule.id);
    return sum + rule.weight * points;
  }, 0).toFixed(6));
  assert.equal(record.score, expected);
  assert.equal(record.research.score, null);
  assert.equal(record.research.grade, null);
  assert.deepEqual(record.researchEvidence, current.researchAssessments);
  assert.deepEqual(record.researchEvidence, {});
  assert.equal(record.rows.some((row) => ["P01A", "P02B"].includes(row.id)), false);
  const row = record.rows.find((item) => item.id === "P02E");
  assert.equal(row.points, 3);
  assert.equal(row.contribution, .015);
  assert.equal(row.observation.value, 0);
  assert.equal(row.researchPoints, null);
  assert.equal(row.researchAssessment, null);
  assert.equal(row.gap, null);
  const ledger = structuredClone(current.observations.P02E.rrrActionLedger);
  assert.deepEqual(row.observation.rrrActionLedger, ledger);
  assert.equal(ledger.monthlyChecks.length, 12);
  input.observations.P02E.value = -100;
  input.observations.P02E.rrrActionLedger.monthlyChecks[0].sourceUrl = "https://example.com/later-replacement";
  input.observations.P02E.rrrActionLedger.crossChecks.length = 0;
  rules.indicators.find((item) => item.id === "P02E").weight = .9;
  assert.equal(row.observation.value, 0);
  assert.deepEqual(row.observation.rrrActionLedger, ledger);
  assert.equal(record.framework.indicators.find((item) => item.id === "P02E").weight, .005);
});

test("new releases append while previously authorized deleted snapshots stay only in their unchanged backup", async () => {
  const [current, history, backup] = await Promise.all([
    readFile(new URL("../app/data/macro-rating-current.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/macro-rating-history.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../deliverables/macro-rating-history-before-v1-14-2026-10-11.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const older = backup.snapshots;
  assert.deepEqual(older.map((item) => item.version), ["V1.11", "V1.12", "V1.13"]);
  const frozenHashes = {
    "V1.11": "2c33018030817dc69eea6e1036eda27b04230f034e57e1200004d3019ef0185b",
    "V1.12": "d09cb4ff85adb74cd6ceca279393952ac295247a26398caa1a4bda1abdcd4209",
    "V1.13": "d3b3859f3cb0ece46e19dd58ec368623a9a0e36e519bf77e838f73c28cbb580f",
  };
  for (const legacy of older) assert.equal(createHash("sha256").update(JSON.stringify(legacy)).digest("hex"),
    frozenHashes[legacy.version], `${legacy.version}: archived content must remain byte-for-byte equivalent`);
  const before = JSON.stringify(older);
  const record = createMacroRatingRecord(framework, current);
  const appended = appendMacroRatingRecord({ snapshots: [] }, record);
  assert.equal(appended.snapshots.length, 1);
  assert.equal(JSON.stringify(backup.snapshots), before);
  for (const legacy of older.filter((item) => item.version !== "V1.13")) {
    assert.equal(legacy.framework.version, legacy.version);
    assert.equal(legacy.rows.length, 38);
    assert.equal(legacy.framework.indicators.length, 38);
    assert.equal(legacy.framework.indicators.find((rule) => rule.id === "P01A").weight, .025);
    assert.equal(legacy.rows.find((row) => row.id === "P01A").weight, .025);
    assert.equal(legacy.score, null);
    assert.equal(legacy.coverage, .965);
    for (const id of ["P01A", "P02B"]) {
      const row = legacy.rows.find((item) => item.id === id);
      assert.equal(row.observation, null);
      assert.equal(row.points, null);
      if (legacy.version === "V1.11") assert.equal(row.researchAssessment, undefined);
      else assert.deepEqual(row.researchAssessment, legacy.researchEvidence[id]);
    }
    if (legacy.version === "V1.11") {
      assert.equal(legacy.type, "暂定观察");
      assert.equal(legacy.research, undefined);
      assert.equal(legacy.researchEvidence, undefined);
    } else {
      assert.equal(legacy.type, "研究观察");
      assert.equal(legacy.research.count, 2);
      assert.equal(legacy.research.countTotal, 38);
      assert.equal(legacy.research.score, 2.905);
      assert.deepEqual(Object.keys(legacy.researchEvidence).sort(), ["P01A", "P02B"]);
    }
  }
  const previous = older.find((item) => item.version === "V1.13");
  assert.equal(previous.rows.length, 37);
  assert.equal(previous.coverage, .99);
  assert.equal(previous.score, null);
  assert.equal(previous.research.count, 1);
  assert.equal(previous.research.score, 2.91);
  assert.deepEqual(Object.keys(previous.researchEvidence), ["P02B"]);
  assert.equal(previous.rows.find((item) => item.id === "P02B").observation, null);
  assert.equal(record.version, "V1.21");
  assert.equal(record.rows.length, 38);
  assert.equal(record.framework.indicators.find((rule) => rule.id === "P01A"), undefined);
  assert.equal(record.framework.indicators.find((rule) => rule.id === "P02B"), undefined);
  assert.equal(record.rows.find((row) => row.id === "P02E").points, 3);
  assert.equal(record.rows.find((row) => row.id === "P01E").weight, .035);
  assert.equal(record.rows.find((row) => row.id === "P01F").weight, .015);
  assert.deepEqual(history.snapshots.at(-1), record);
  assert.deepEqual(history.snapshots.map((item) => item.version), ["V1.18", "V1.19", "V1.20", "V1.21"]);
  assert.throws(() => appendMacroRatingRecord(appended, record), /already archived/);
  assert.equal(appended.snapshots.length, 1);
});
