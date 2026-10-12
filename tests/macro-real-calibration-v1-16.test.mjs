import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { interpolateScore } from "../lib/macro-scoring-continuous.mjs";
const load = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const baseline = async () => { try { return await load("deliverables/macro-rating-framework-before-v1-16-2026-10-11.json"); } catch(error) { if(error.code!=="ENOENT")throw error; return load("app/data/macro-rating-v1.json"); } };
const [calibration, framework] = await Promise.all([load("deliverables/macro-v1-16-real-calibration.json"), baseline()]);
function score(scoring,row) {
  if(scoring.method==="piecewise-linear")return interpolateScore(row.value,scoring.anchors);
  return scoring.components.reduce((sum,c)=>sum+c.weight*interpolateScore(c.input==="observation.value"?row.value:row.inputs[c.key],c.anchors),0);
}
test("all21 real-economy indicators have3 fixed candidates and finite sourced data",()=>{
  assert.equal(calibration.rules.length,21);
  assert.equal(new Set(calibration.rules.map((r)=>r.id)).size,21);
  for(const r of calibration.rules) {
    assert.equal(r.candidates.length,3);
    for(const row of r.data.rows){assert.ok(Number.isFinite(row.value));assert.match(row.sourceUrl,/^https?:\/\//);}
    const chosen=r.candidates.find((c)=>c.key===r.selectedCandidate);
    assert.deepEqual(r.scoring,chosen.scoring);
  }
});
test("diagnostic mean and full sample sizes recompute from source values and fixed components",()=>{
  for(const r of calibration.rules) for(const c of r.candidates) {
    const actual=r.data.rows.map((row)=>score(c.scoring,row));
    const diag=c.diagnostics[0];
    assert.equal(diag.n,actual.length,r.id);
    assert.ok(Math.abs(diag.scoreMean-actual.reduce((a,b)=>a+b,0)/actual.length)<1e-7,`${r.id}/${c.key}`);
  }
});
test("GDP keeps4.5 neutral and20% trend curve;4.3 uses continuous2.54 composite",()=>{
  const r=calibration.rules.find((r)=>r.id==="E01");
  assert.equal(interpolateScore(4.5,r.scoring.components[0].anchors),3);
  assert.equal(interpolateScore(3.5,r.scoring.components[0].anchors),1.5);
  assert.ok(Math.abs(score(r.scoring,{value:4.3,inputs:{quarterYoyChange:-.7}})-2.54)<1e-10);
  const prior=framework.indicators.find((r)=>r.id==="E01");
  assert.deepEqual(r.scoring.components[1],prior.scoring.components[1]);
});
test("dual-sided price penalties and original peak regions survive local scale calibration",()=>{
  for(const id of ["E02","E03","E04","E07"]){
    const r=calibration.rules.find((r)=>r.id===id), prior=framework.indicators.find((r)=>r.id===id);
    assert.deepEqual(r.scoring.anchors.filter(([,s])=>s===5),prior.scoring.anchors.filter(([,s])=>s===5));
    assert.equal(r.scoring.anchors[0][1],1);assert.equal(r.scoring.anchors.at(-1)[1],1);
  }
});
test("allshort-sample growth indicators retain baseline rather than select a volatile narrow curve",()=>{
  for(const r of calibration.rules.filter((r)=>r.id.startsWith("G"))){
    assert.equal(r.decision,"保留");
    assert.deepEqual(r.scoring,framework.indicators.find((x)=>x.id===r.id).scoring);
    assert.ok(r.data.rows.length<30);assert.ok(r.limitations.some((l)=>l.includes("样本")));
  }
});
test("pandemic/base-effect observations are reported separately without being silently removed",()=>{
  for(const r of calibration.rules.filter((r)=>["E01","E02","E03","E04","E05","E07","E08","E09"].includes(r.id))){
    for(const c of r.candidates){
      const pandemic=c.diagnostics.find((d)=>d.window==="pandemic and base effects 2020-2022");
      assert.ok(pandemic.n>0,r.id);
      assert.equal(c.diagnostics[0].n,c.diagnostics.slice(1).reduce((s,d)=>s+d.n,0));
    }
  }
});
