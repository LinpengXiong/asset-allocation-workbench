import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scoreLeverageMatrix } from "../lib/macro-leverage-scoring.mjs";

const candidate = JSON.parse(await readFile(new URL("../deliverables/macro-v1-15-credit-implementation.json", import.meta.url), "utf8"));
const clone = (x) => structuredClone(x);
const cutoff = "2026-10-11";
const rule = (id) => candidate.rules.find((r) => r.id === id);
const fixture = (id = "F09") => clone(candidate.observations[id]);
const score = (id, o, day = cutoff) => scoreLeverageMatrix(rule(id), o, day);
const records = (m) => [...m.incomeOrProfit.evidence, ...m.servicing.evidence, ...m.pressure.evidence];
const syncCounter = (m) => {
  for (const side of ["positive", "negative"]) m.counterEvidence[side] = m.counterEvidence[side].map((r) => clone(records(m).find((x) => x.id === r.id)));
  m.counterEvidence.positive = m.counterEvidence.positive.filter((r) => r.id.includes("RateChange") ? r.value <= 0 : r.value > 0);
  m.counterEvidence.negative = m.counterEvidence.negative.filter((r) => r.id === "housingWealthPressure"
    ? ["不利", "混合"].includes(r.direction) : ["collectionDaysChange", "inventoryDaysChange"].includes(r.id) ? r.value > 0 : r.value < 0);
};
const expectState = (o, value, state) => {
  o.value = value; o.scoringMatrix.computedScore = value; o.scoringMatrix.matchedState = state;
};

test("current seven patches preserve identities; five curves and two auditable half-step matrices", () => {
  assert.equal(candidate.rules.length, 7);
  assert.deepEqual(candidate.rules.map((r) => r.id).sort(), ["F01", "F02", "F05", "F07", "F08", "F09", "F10"]);
  for (const id of ["F09", "F10"]) {
    assert.equal(score(id, fixture(id)), 2.5);
    assert.deepEqual(rule(id).scoring.states.map((s) => s.score), [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    assert.ok(rule(id).scoring.states.every((s) => s.label && s.description));
  }
  assert.equal(fixture().scoringMatrix.domestic.debtGrowth.value, -1.3);
});

for (const id of ["F09", "F10"]) {
  for (const key of ["domestic", "international", "incomeOrProfit", "servicing", "pressure", "counterEvidence"]) {
    test(`${id} missing ${key} is null, never an automatic neutral score`, () => {
      const o = fixture(id); delete o.scoringMatrix[key]; assert.equal(score(id, o), null);
    });
  }
  test(`${id} arbitrary score and matched state cannot override facts`, () => {
    const o = fixture(id); expectState(o, 3, "mixed-evidence"); assert.equal(score(id, o), null);
    expectState(o, 4.5, "durable-constraint-relief"); assert.equal(score(id, o), null);
  });
  test(`${id} no counter-evidence, blank limitation, or falsified counter record fails`, () => {
    let o = fixture(id); o.scoringMatrix.counterEvidence.negative = []; assert.equal(score(id, o), null);
    o = fixture(id); o.scoringMatrix.servicing.limitations = ""; assert.equal(score(id, o), null);
    o = fixture(id); o.scoringMatrix.counterEvidence.positive[0].value = 100; assert.equal(score(id, o), null);
  });
  test(`${id} future release/verification and stale review fail`, () => {
    let o = fixture(id); o.scoringMatrix.incomeOrProfit.evidence[0].releaseDate = "2026-12-01"; assert.equal(score(id, o), null);
    o = fixture(id); o.scoringMatrix.international.peers[0].verifiedAt = "2026-12-01"; assert.equal(score(id, o), null);
    o = fixture(id); o.scoringMatrix.reviewDate = "2026-09-30"; assert.equal(score(id, o), null);
    assert.equal(score(id, fixture(id), "2027-05-01"), null);
  });
  test(`${id} domestic sector, prior quarter and nominal GDP versions are independently checked`, () => {
    let o = fixture(id); o.scoringMatrix.domestic.current.series = id === "F09" ? "corporateLeverage" : "householdLeverage"; assert.equal(score(id, o), null);
    o = fixture(id); o.scoringMatrix.domestic.yearAgo.period = "2025-Q1"; assert.equal(score(id, o), null);
    o = fixture(id); o.scoringMatrix.domestic.quarterAgo.value += 1; assert.equal(score(id, o), null);
    o = fixture(id); o.scoringMatrix.domestic.nominalGdpEffect.denominatorEvidence.components[0].revisionVersion = "different-vintage"; assert.equal(score(id, o), null);
    o = fixture(id); o.scoringMatrix.domestic.nominalGdpEffect.denominatorEvidence.priorTtm += 1; assert.equal(score(id, o), null);
  });
}

test("international primary reference is the complete 15 emerging economy sample excluding China", () => {
  for (const mutate of [
    (x) => { x.peers[0].country = "CN"; },
    (x) => { x.peers.pop(); },
    (x) => { x.peers[1] = clone(x.peers[0]); },
    (x) => { x.classification.countries[0] = "US"; },
    (x) => { x.benchmark.median += 1; },
    (x) => { x.benchmark.percentile = 100; },
    (x) => { x.notSafetyThreshold = false; },
    (x) => { x.latestAvailablePeriod = "2026-Q2"; },
  ]) {
    const o = fixture(); mutate(o.scoringMatrix.international); assert.equal(score("F09", o), null);
  }
});

test("international values cannot mix quarters, sector, provider, flow, unit, basis or release", () => {
  for (const [field, value] of [["period", "2026-Q2"], ["sector", "N"], ["unit", "倍"], ["basis", "CNBS部门杠杆"],
    ["sourceUrl", "https://example.com/a"], ["flow", "WS_DSR"], ["queryKey", "Q.CN.P"],
    ["releaseDate", "2026-09-15"], ["originalPublisher", "国家统计局"]]) {
    const o = fixture(); o.scoringMatrix.international.peers[0][field] = value; assert.equal(score("F09", o), null);
  }
});

test("a high international percentile alone does not lower a fully evidenced neutral case", () => {
  // Synthetic validation-only scenario: never written to current observations.
  const o = fixture(), m = o.scoringMatrix;
  m.pressure.evidence.find((x) => x.id === "nonMortgageConsumerCreditGrowth").value = 1;
  m.pressure.evidence.find((x) => x.id === "mortgageCreditGrowth").value = 1;
  m.pressure.evidence.find((x) => x.id === "housingWealthPressure").direction = "混合";
  syncCounter(m); expectState(o, 3, "mixed-evidence");
  assert.equal(score("F09", o), 3);
  expectState(o, 2.5, "constraints-partly-mitigated"); assert.equal(score("F09", o), null);
});

test("material constraints and negative income distinguish 2 from buffered 2.5, without requiring a crisis", () => {
  for (const id of ["F09", "F10"]) {
    const o = fixture(id), m = o.scoringMatrix;
    for (const x of m.incomeOrProfit.evidence) if (["nominalIncomeGrowth", "medianIncomeGrowth", "industrialProfitGrowth", "profitMarginChange"].includes(x.id)) x.value = -1;
    syncCounter(m); expectState(o, 2, "material-constraints"); assert.equal(score(id, o), 2);
    expectState(o, 2.5, "constraints-partly-mitigated"); assert.equal(score(id, o), null);
  }
});

test("mixed/zero income is not silently treated as proven negative income", () => {
  const o = fixture(), m = o.scoringMatrix;
  m.incomeOrProfit.evidence.find((x) => x.id === "nominalIncomeGrowth").value = 0;
  m.incomeOrProfit.evidence.find((x) => x.id === "medianIncomeGrowth").value = 0;
  syncCounter(m); expectState(o, 3, "mixed-evidence"); assert.equal(score("F09", o), 3);
});

test("negative income cannot masquerade as positive counter-evidence", () => {
  const o = fixture(), m = o.scoringMatrix;
  m.incomeOrProfit.evidence.find((x) => x.id === "nominalIncomeGrowth").value = -1;
  m.counterEvidence.positive[0].value = -1;
  assert.equal(score("F09", o), null);
});

test("China's aggregate BIS DSR cannot be assigned to households or corporations", () => {
  for (const id of ["F09", "F10"]) {
    const o = fixture(id), s = o.scoringMatrix.servicing;
    s.sectorDsr = { ...clone(s.evidence[0]), id: "sectorDebtService", metric: "私人非金融合计DSR", value: 19.1,
      sector: "P", scope: "私人非金融合计", basis: "BIS私人非金融合计还本付息/GDP", originalPublisher: "Bank for International Settlements",
      sourceUrl: "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_DSR/1.0/Q.CN.P?format=csv", queryKey: "Q.CN.P" };
    s.proxyOnly = false; s.directSectorData = true;
    assert.equal(score(id, o), null);
    // Merely relabelling the record does not change the original query's borrower sector.
    s.sectorDsr.sector = id === "F09" ? "H" : "N";
    s.sectorDsr.scope = id === "F09" ? "居民与NPISH" : "全部非金融公司";
    s.sectorDsr.basis = "同部门实际还本付息/同部门收入";
    assert.equal(score(id, o), null);
  }
});

test("2019 household debt-service survey cannot fill a current quarter direct observation", () => {
  const o = fixture(), s = o.scoringMatrix.servicing;
  s.proxyOnly = false; s.directSectorData = true;
  s.sectorDsr = { ...clone(s.evidence[0]), id: "oldMicroDsr", metric: "2019年城镇家庭调查", value: 18.4, period: "2019-Q4",
    sector: "H", scope: "居民与NPISH", basis: "同部门实际还本付息/同部门收入", originalPublisher: "International Monetary Fund",
    sourceUrl: "https://www.imf.org/reports/synthetic-only.pdf" };
  assert.equal(score("F09", o), null);
});

test("proxy pathway cannot generate improvement scores, and new-loan pricing is not debt service", () => {
  const o = fixture(); expectState(o, 3.5, "capacity-improving"); assert.equal(score("F09", o), null);
  o.scoringMatrix.servicing.sectorDsr = clone(o.scoringMatrix.servicing.evidence[0]);
  assert.equal(score("F09", o), null);
});

test("different institution/industrial scope or month-to-quarter remapping is rejected", () => {
  let o = fixture("F10"); o.scoringMatrix.incomeOrProfit.evidence[0].scope = "全部上市公司"; assert.equal(score("F10", o), null);
  o = fixture("F10"); o.scoringMatrix.pressure.evidence[0].period = "2026-06"; assert.equal(score("F10", o), null);
  o = fixture(); o.scoringMatrix.incomeOrProfit.evidence[0].frequency = "月度"; assert.equal(score("F09", o), null);
  o = fixture(); o.scoringMatrix.pressure.evidence[0].scope = "企业部门"; assert.equal(score("F09", o), null);
});

test("malformed nested input rejects safely without throwing", () => {
  for (const mutate of [
    (m) => { m.incomeOrProfit.evidence = [null]; },
    (m) => { m.international.peers[0] = null; },
    (m) => { m.domestic.current = null; },
    (m) => { m.counterEvidence.negative = [null]; },
    (m) => { m.domestic.nominalGdpEffect.denominatorEvidence.components[0] = null; },
  ]) {
    const o = fixture(); mutate(o.scoringMatrix);
    assert.doesNotThrow(() => score("F09", o)); assert.equal(score("F09", o), null);
  }
});
