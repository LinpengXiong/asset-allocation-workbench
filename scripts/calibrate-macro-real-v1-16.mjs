/** Reproducible scale diagnostics; not a PIT, economic false-positive, or return backtest. */
import { readFile } from "node:fs/promises";
import { interpolateScore } from "../lib/macro-scoring-continuous.mjs";
import assert from "node:assert/strict";

const load = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const frozenBaseline = async (backup, fallback) => {
  try { return await load(backup); }
  catch (error) { if (error.code !== "ENOENT") throw error; return load(fallback); }
};
const [framework, current, prices, gdp, intrayear, additional, priorDiagnostics, housing] = await Promise.all([
  frozenBaseline("deliverables/macro-rating-framework-before-v1-16-2026-10-11.json", "app/data/macro-rating-v1.json"),
  frozenBaseline("deliverables/macro-rating-current-before-v1-16-2026-10-11.json", "app/data/macro-rating-current.json"),
  ...["app/data/macro-price-history.json", "app/data/macro-gdp-deflator-history.json", "app/data/macro-intrayear.json", "app/data/macro-additional.json", "deliverables/macro-v1-15-real-economy-diagnostics.json", "app/data/macro-secondhand-price.json"].map(load),
]);
assert.equal(framework.version, "V1.15", "calibration must retain its frozen V1.15 baseline");
assert.equal(current.version, "V1.15", "calibration must not silently use a changed current scorecard");
const rules = framework.indicators.filter((r) => r.pillar === "经济运行" || r.pillar === "增长动力");
const copy = (o) => JSON.parse(JSON.stringify(o));
const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const round = (v) => Number.isFinite(v) ? Number(v.toFixed(8)) : null;
const qtl = (a, p) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), pos = (b.length - 1) * p, i = Math.floor(pos); return b[i] + (b[Math.min(i + 1, b.length - 1)] - b[i]) * (pos - i); };
const monthIndex = (p) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7));
const quarterIndex = (p) => Number(p.slice(0, 4)) * 4 + Number(p.split("Q")[1]);
const consecutive = (a, b) => a.includes("Q") ? quarterIndex(b) - quarterIndex(a) === 1 : monthIndex(b) - monthIndex(a) === 1;
const sorted = (rows) => rows.filter((r) => Number.isFinite(r.value)).sort((a, b) => a.period.localeCompare(b.period));

// Candidate values are fixed before diagnostics. No search over the current score or future returns.
const explicit = {
  E01: { moderate: [[3,1],[4,2],[4.5,3],[5,4],[7,5]], narrow: [[3.5,1],[4.1,2],[4.5,3],[4.9,4],[6,5]] },
  E02: { moderate: [[-1.5,1],[-.25,2],[.5,3],[1.25,4],[2,5],[2.5,5],[3,4],[4,3],[5,2],[6,1]], narrow: [[-1,1],[0,2],[.5,3],[1,4],[2,5],[2.5,5],[3,4],[4,3],[5,2],[6,1]] },
  E03: { moderate: [[-1,1],[0,2],[.5,3],[1,4],[2,5],[2.5,5],[3,4],[4,2],[5,1]], narrow: [[-.5,1],[.1,2],[.5,3],[.8,4],[2,5],[2.5,5],[3,4],[4,2],[5,1]] },
  E04: { moderate: [[-5,1],[-2.5,2],[-1,3],[.5,4],[2,5],[3,5],[5,4],[8,2],[12,1]], narrow: [[-4,1],[-2,2],[-1,3],[0,4],[2,5],[3,5],[5,4],[8,2],[12,1]] },
  E05: { moderate: [[4.5,5],[4.9,4],[5.2,3],[5.5,2],[6,1]], narrow: [[4.5,5],[5,4],[5.2,3],[5.4,2],[6,1]] },
  E07: { moderate: [[-3,1],[-1,2],[0,3],[.75,4],[2,5],[3,5],[4,4],[6,2],[8,1]], narrow: [[-2,1],[-.5,2],[0,3],[.5,4],[2,5],[3,5],[4,4],[6,2],[8,1]] },
  E08: { moderate: [[47,1],[49,2],[50,3],[51,4],[53,5]], narrow: [[47,1],[49.5,2],[50,3],[50.5,4],[53,5]] },
  E09: { moderate: [[47,1],[49,2],[50,3],[51.5,4],[54,5]], narrow: [[47,1],[49.5,2],[50,3],[51,4],[54,5]] },
};
function contract(anchors, factor) {
  const center = anchors.find(([, s]) => s === 3)?.[0] ?? 0;
  return anchors.map(([x, s]) => [round(center + (x - center) * factor), s]);
}
function candidate(rule, kind) {
  const s = copy(rule.scoring); if (kind === "baseline") return s;
  if (s.method === "weighted-components") {
    // GDP/PMI only change level scale. Fixed 20% trend is not tightened again.
    for (const c of s.components) if (c.key === "level") c.anchors = explicit[rule.id]?.[kind] ?? contract(c.anchors, kind === "moderate" ? .75 : .5);
    if (rule.id === "G02") for (const c of s.components) c.anchors = contract(c.anchors, kind === "moderate" ? .75 : .5);
  } else s.anchors = explicit[rule.id]?.[kind] ?? contract(s.anchors, kind === "moderate" ? .75 : .5);
  return s;
}
function score(s, row, partial = false) {
  if (s.method === "piecewise-linear") return interpolateScore(row.value, s.anchors);
  if (partial) return interpolateScore(row.value, s.components[0].anchors);
  let sum = 0;
  for (const c of s.components) {
    const value = c.input === "observation.value" ? row.value : row.inputs?.[c.key];
    if (!Number.isFinite(value)) return null;
    sum += c.weight * interpolateScore(value, c.anchors);
  }
  return sum;
}
function rollSix(monthly) {
  const d = sorted(monthly), out = [];
  for (let i = 5; i < d.length; i++) {
    const six = d.slice(i - 5, i + 1);
    if (!six.slice(1).every((r, k) => consecutive(six[k].period, r.period))) continue;
    const latest = mean(six.slice(3).map((r) => r.value)), prior = mean(six.slice(0, 3).map((r) => r.value));
    out.push({ period: d[i].period, value: latest, inputs: { nonOverlappingThreeMonthChange: latest - prior }, sourceUrl: d[i].sourceUrl, rawMonths: six });
  }
  return out;
}
function localSeries(metric, sourceKey) {
  const s = intrayear.series.find((r) => r.metric === metric), out = [];
  if (!s) return out;
  for (let i = 0; i < s.periods.length; i++) {
    const p = s.periods[i], m = p.match(/(?:1[—－-])?(\d+)月/);
    if (!m || p === "1—2月" && sourceKey === "activityMonthly") continue; // combined Jan-Feb cannot stand in for February monthly growth
    const period = `2026-${String(m[1]).padStart(2, "0")}`;
    const set = sourceKey === "investment" ? intrayear.investmentStructureSources : intrayear.activitySources;
    out.push({ period, value: s.values[i], sourceUrl: set?.[i]?.url ?? s.url, basis: s.basis });
  }
  return sorted(out);
}
const gdpRows = gdp.rows.filter((r) => r.period >= "2015-Q1" && r.vintage === "2026-09-15-SDDS");
const samples = {};
samples.E01 = { rows: gdpRows.slice(1).map((r, i) => ({ period: r.period, value: r.realGdpIndex - 100,
  inputs: { quarterYoyChange: r.realGdpIndex - gdpRows[i].realGdpIndex }, sourceUrl: r.sourceUrl, vintage: r.vintage,
  raw: { realGdpIndex: r.realGdpIndex, precedingRealGdpIndex: gdpRows[i].realGdpIndex, precedingPeriod: gdpRows[i].period } })), source: "app/data/macro-gdp-deflator-history.json", comparable: "2015年起2026-09-15 SDDS同版单季实际同比指数；相邻季同比差。2012之前另一修订段未混入。" };
for (const [id, field] of [["E02","cpi"],["E03","coreCpi"],["E04","ppi"]]) samples[id] = { rows: sorted(prices.rows.filter((r) => r.period >= (id === "E03" ? "2020-01" : "2015-01")).map((r) => ({ period:r.period, value:r[field], sourceUrl:r[`${field}Url`] }))), source:"app/data/macro-price-history.json", comparable:"逐月官方报告当月同比；2026基期轮换及不同历史发布版本保留为限制，不把定基指数变动替代官方同比。" };
samples.E07 = { rows:gdpRows.map((r) => ({ period:r.period, value:(r.nominalGdp/r.priorYearNominalGdp/(r.realGdpIndex/100)-1)*100, sourceUrl:r.sourceUrl, vintage:r.vintage, raw:{nominalGdp:r.nominalGdp,priorYearNominalGdp:r.priorYearNominalGdp,realGdpIndex:r.realGdpIndex} })), source:"app/data/macro-gdp-deflator-history.json", comparable:"同版现价单季值/上年同季值除以实际同比指数复算；不采用先取整的图示平减指数。" };
for (const id of ["E05","E08","E09"]) {
  const d = priorDiagnostics.officialFreshQuery[id], rows = d.originalMonthlyValues.map((r) => ({...r,sourceUrl:d.sourceUrl}));
  samples[id] = { rows:id === "E05" ? rows : rollSix(rows), source:"deliverables/macro-v1-15-real-economy-diagnostics.json", comparable:id === "E05" ? "国家统计局月度数据库全国城镇调查失业率，未季调；2026-01单月数据库值与合并新闻口径有区别。" : "官方季调月度同序列，连续6个月复算3月均值及不重叠前3月变化；没有补月。", monthly:rows };
}
for (const [id, metric, sourceKey] of [["G01","规模以上工业增加值","activityMonthly"],["G03","新建商品房销售面积","activity"],["G14","房地产开发投资","activity"],["G07","制造业投资","investment"],["G13","基础设施投资","investment"],["G12","服务零售额","activity"]]) samples[id] = { rows:localSeries(metric,sourceKey), source:"app/data/macro-intrayear.json", comparable:`现表${metric}原始同比，只有2026年短样本；累计同比不差分为单月。` };
samples.G02 = { rows:[{period:current.observations.G02.period,value:current.observations.G02.value,inputs:Object.fromEntries(Object.entries(current.observations.G02.scoringInputs).map(([k,v])=>[k,v.value])),sourceUrl:current.observations.G02.sourceUrl}], partialRows:[...localSeries("规模以上工业企业利润","activity"),{period:"2026-08",value:15.7,sourceUrl:current.observations.G02.sourceUrl}], source:"app/data/macro-intrayear.json + app/data/macro-rating-current.json", comparable:"完整四分量只有本期1点，不能把累计利润7点冒充盈利质量完整历史；历年分所有制利润率不代替同口径全国同比变化。" };
for (const id of ["G16","G17"]) samples[id] = { rows:[{period:current.observations[id].period,value:current.observations[id].value,sourceUrl:current.observations[id].sourceUrl}],source:"app/data/macro-rating-current.json",comparable:id === "G16" ? "扣房地产开发民间投资只用官方直接公布值；不可用旧全口径投资补历史。" : "商品零售当月名义同比，只用该指标；社零/限上汽车家电分类不代替。" };
samples.G10 = { rows:additional.goodsTrade.rows.map((r,i)=>({period:`2026-${String(i+1).padStart(2,"0")}`,value:r.exportYoy,sourceUrl:additional.goodsTrade.sourceUrl})), source:"app/data/macro-additional.json",comparable:"海关当月美元出口同比，商务部官方数据原表转载；不使用人民币/累计同比。" };
const newOrders = intrayear.series.find((r)=>r.metric === "制造业 PMI 新订单");
const newOrderMonths = newOrders.values.map((v,i)=>({period:`2026-${String(i+1).padStart(2,"0")}`,value:v,sourceUrl:intrayear.nonManufacturingPmiSources?.[i]?.url ?? newOrders.url}));
newOrderMonths.push({period:"2026-09",value:50.5,sourceUrl:current.observations.G11.sourceUrl});
samples.G11 = { rows:rollSix(newOrderMonths),monthly:newOrderMonths,source:"app/data/macro-intrayear.json + app/data/macro-rating-current.json",comparable:"9个原始月、4个完整六个月窗口；不把制造业PMI总指数作为新订单历史。" };
const priceMedians = housing.monthly.map((r)=>({period:r.period,value:qtl(r.cities.map((c)=>c.momIndex-100),.5),sourceUrl:r.sourceUrl,cityCount:r.cities.length}));
samples.G15 = {rows:priceMedians.length >=3 ? [{period:priceMedians.at(-1).period,value:mean(priceMedians.slice(-3).map((r)=>r.value)),sourceUrl:priceMedians.at(-1).sourceUrl,rawMonths:priceMedians}] : [],source:"app/data/macro-secondhand-price.json",comparable:"三个月每月70城环比中位数，再三月均值，仅1个完整窗口；不是官方全国指数。", monthly:priceMedians};
const cap = intrayear.industrialCapacityUtilization;
const capacityRaw = sorted([...cap.periods.map((p,i)=>({period:p.replace(" ","-"),value:cap.values[i],sourceUrl:cap.sourceUrls[i]})),...cap.recentPeriods.map((p,i)=>({period:p.replace(" ","-"),value:cap.recentValues[i],sourceUrl:cap.recentSourceUrls[i]}))]);
const capacityMap = new Map(capacityRaw.map((r)=>[r.period,r]));
samples.G18 = { rows:[...capacityMap.values()].filter((r)=>capacityMap.has(`${Number(r.period.slice(0,4))-1}${r.period.slice(4)}`)).map((r)=>{ const prior = capacityMap.get(`${Number(r.period.slice(0,4))-1}${r.period.slice(4)}`);return {period:r.period,value:r.value-prior.value,sourceUrl:r.sourceUrl,raw:{current:r,prior}}; }), source:"app/data/macro-intrayear.json",comparable:"同季同比，Q4稀疏年点与近6季分别留档；不把Q4水平分布当Q2分布，不跨缺季计算环比或反转。" };

function diagnostics(s, rows, partial=false) {
  const valid = sorted(rows).map((r)=>({...r,points:score(s,r,partial)})).filter((r)=>Number.isFinite(r.points));
  const values = valid.map((r)=>r.value), points = valid.map((r)=>r.points), deltas=[], reversalDeltas=[];
  for(let i=1;i<valid.length;i++) if(consecutive(valid[i-1].period,valid[i].period)) deltas.push(valid[i].points-valid[i-1].points);
  for(let i=2;i<valid.length;i++) {
    if(!consecutive(valid[i-2].period,valid[i-1].period)||!consecutive(valid[i-1].period,valid[i].period))continue;
    const a=valid[i-1].points-valid[i-2].points,b=valid[i].points-valid[i-1].points;
    if(a*b<0&&Math.abs(a)>=.25&&Math.abs(b)>=.25)reversalDeltas.push({period:valid[i].period,outbound:round(a),return:round(b)});
  }
  const baseCurve=s.method === "piecewise-linear" ? s.anchors : s.components[0].anchors;
  const sensitivity = values.map((x)=>Math.abs(interpolateScore(x+.1,baseCurve)-interpolateScore(x,baseCurve)));
  return {n:valid.length,first:valid[0]?.period??null,last:valid.at(-1)?.period??null,rawPercentiles:[0,.1,.25,.5,.75,.9,1].map((p)=>round(qtl(values,p))),scoreMean:round(mean(points)),scoreStd:round(Math.sqrt(mean(points.map((v)=>(v-mean(points))**2))??0)),levelResponsePlus0_1Mean:round(mean(sensitivity)),levelZeroResponsePlus0_1Count:sensitivity.filter((v)=>v<1e-10).length,endpointScoreCount:points.filter((v)=>v<=1+1e-10||v>=5-1e-10).length,nearTailScoreCount:points.filter((v)=>v<=1.25||v>=4.75).length,consecutivePairCount:deltas.length,meanAbsoluteScoreChange:round(mean(deltas.map(Math.abs))),scoreChangeOver0_5Count:deltas.filter((v)=>Math.abs(v)>.5).length,consecutiveTripletReversalsOver0_25Count:reversalDeltas.length,reversals:reversalDeltas};
}
function windows(rows){return [
  ["all available",rows], ["pre-pandemic 2015-2019",rows.filter((r)=>r.period<"2020")],
  ["pandemic and base effects 2020-2022",rows.filter((r)=>r.period>="2020"&&r.period<"2023")],
  ["reopening/base effects 2023",rows.filter((r)=>r.period>="2023"&&r.period<"2024")],
  ["recent 2024 onward",rows.filter((r)=>r.period>="2024")],
].filter(([,r])=>r.length).map(([label,r])=>({label,rows:r}));}
const chosen = new Set(["E01","E03","E04","E07","E08","E09"]);
const rationales = {
  E01:"保留4.5%=3分参照，常态4.0—5.0每0.5个百分点差1分；3.5%水平分1.5而非2分，7%极高端留空间。20%同比趋势曲线及权重不再收窄，避免同一变化双重放大。明显收窄方案令近期大幅评分变化更多，不采用。",
  E02:"保留：食品能源和春节影响大，现曲线已能响应0.1个百分点。候选收窄仅改善函数增益，不能证明对内需持续变化的辨别能力，且负通胀端会更早封底。",
  E03:"适度细化0.5—1.0%常态区，每0.5个百分点差1分；保持0.5%=3分、2—2.5%研究峰区及过热下行端。更窄方案使0.1个百分点测量/月份变化的得分过大，不选。",
  E04:"仅适度细化-2.5%—0.5%修复区；高波动尾部和2—3%峰区保持，不能把供给价格冲击当需求改善。明显收窄会较早封底，压缩严重工业通缩区的区分度，不采用。",
  E05:"保留：原0.1个百分点已改变约0.25分，收窄会放大毕业季及月度调查变化；未季调失业率不能仅按小波动幅度认定经济转向。维持低权重并检查参与率/就业不足限制。",
  E07:"适度细化负值至零及温和正值区：-1%=2、0%=3、0.75%=4；保留-3%低端及2—3%研究峰区。历史同版可复算；三方案全样本端点数均为2、近尾数均为6，未观察到更多封底。明显收窄会改变负值端边界与斜率，本轮保守选择仅适度细化。",
  E08:"三月平滑后的水平在50附近较集中，适度把49/50/51对应2/3/4，保留47/53尾端。连续6个月趋势及80/20配比不变；明显收窄50附近会放大来回穿越。",
  E09:"全国非制造业较制造业波动大，适度采用49/50/51.5对应2/3/4，保留47/54两端；不统一套制造业窄幅度，也不再次压窄20%趋势组件。",
};
const output={version:"V1.16",baseVersion:framework.version,asOf:current.asOf,scope:"经济运行8项+增长动力13项，指标及权重不变",status:"historical-current-vintage scale calibration; research trial, not PIT or economic false-positive/asset-return validation",method:{hypothesis:"常态附近局部加密可提高中期变化的得分响应，但不能以当前总分方向选参数。",candidates:"现版、事先固定适度收窄、事先固定明显收窄；经济运行按统计含义局部缩距，短样本增长项只作通用0.75/0.5宽度压力比较。",diagnosticDefinitions:{levelResponsePlus0_1Mean:"主水平原值增加0.1个原单位时绝对得分变化均值；GDP/PMI不包含20%趋势分，不代表经济识别率。",nearTailScoreCount:"得分<=1.25或>=4.75的点数，需结合样本量比较。",scoreChangeOver0_5Count:"相邻可比统计期得分绝对变化>0.5的计数，不是坏信号/误报定义。",consecutiveTripletReversalsOver0_25Count:"相邻连续三期得分先变后反向，两个变化均>=0.25的计数；仅是反转诊断，不是经济误报。"},selection:"仅长样本项考虑局部适度修订；保留固定中性/峰区含义，不最大化分数方差、不预测收益、不自动以历史分位替代经济基准。",sampleSplit:"2015—19、2020—22疫情及低基数、2023重启低基数、2024起近期分别完整报告，未静默删极端年。"},rules:[],limitations:["不是逐期信息集：使用现存官方原表/当期修订历史，没有逐期发布日期完整回放。","无法由锚点统计推断真实经济误报率；没有独立经济事件标签，没有样本外收益检验。","增长13项多数历史不足，本轮保留曲线；未用社零补商品、全口径投资补扣房地产投资、累计差分补单月。","锚点/中性参照/峰区/80-20等仍是研究试行，不是官方评分或回测最优。","原始月度/季度数据无插值；统计图已显示舍入数与官方原值精度区分。"]};
for(const r of rules){
  const sample=samples[r.id];if(!sample)throw new Error(`No sample accounting for ${r.id}`);
  const cs=["baseline","moderate","narrow"].map((key)=>{const s=candidate(r,key);return {key,label:{baseline:"现版",moderate:"适度收窄",narrow:"明显收窄"}[key],scoring:s,diagnostics:windows(sample.rows).map((w)=>({window:w.label,...diagnostics(s,w.rows)})),partialDiagnostics:sample.partialRows?diagnostics(s,sample.partialRows,true):null};});
  const selected=chosen.has(r.id)?"moderate":"baseline", decision=chosen.has(r.id)?"调整":"保留";
  const n=sample.rows.length, first=sorted(sample.rows)[0]?.period??"无", last=sorted(sample.rows).at(-1)?.period??"无";
  const limits=["同一原值组比较三个评分尺度，分数变化不是本期经济变化；未完成真正样本外经济识别检验。"];
  if(n<30)limits.push(`完整可比评分样本仅${n}点，不足以可靠选择更窄锚点；不把部分组件或其他口径视为完整历史。`);
  if(r.id==="E01")limits.push("前季同比差含基数影响，并非季调环比动量；全年目标不作为每季度硬目标，固定4.5中性需随结构性增长趋势定期审查。");
  if(["E02","E03","E04"].includes(r.id))limits.push("双侧通缩/过热评分是经济研究选择；当前版本沿用旧峰区，不能声称已历史验证最优物价水平。2026基期轮换需留意。");
  if(r.id==="E05")limits.push("全国总体、未季调、劳动力参与条件下的调查失业率；不估算隐性失业率，收窄分数不能解决覆盖限制。");
  const reason=rationales[r.id]??`保留：${sample.comparable} 当前数据不足以区别“提高中期敏感度”与“放大单期/累计基数噪声”，先保持已公开连续曲线；两种更窄候选仅保留为可复算压力方案，不声称通过校准。`;
  output.rules.push({id:r.id,name:r.name,decision,reason,selectedCandidate:selected,scoring:copy(cs.find((c)=>c.key===selected).scoring),sampleSummary:`${first}—${last}，完整${n}点；${sample.comparable}`,limitations:limits,candidates:cs,currentComparison:Object.fromEntries(cs.map((c)=>[c.key,round(score(c.scoring,{value:current.observations[r.id].value,inputs:Object.fromEntries(Object.entries(current.observations[r.id].scoringInputs??{}).map(([k,v])=>[k,v.value]))}))])),data:{sourceFile:sample.source,rows:sample.rows,monthly:sample.monthly??null,partialRows:sample.partialRows??null}});
}
if(new Set(output.rules.map((r)=>r.id)).size!==21)throw new Error("Expected21 unique rules");
const serialized = JSON.stringify(output,null,2);
if (process.argv.includes("--summary")) console.log(JSON.stringify(output.rules.map((r)=>({id:r.id,decision:r.decision,current:r.currentComparison,diag:r.candidates.map((c)=>({key:c.key,all:c.diagnostics[0],recent:c.diagnostics.at(-1)})).map((d)=>({...d,all:{n:d.all.n,response:d.all.levelResponsePlus0_1Mean,jumps:d.all.scoreChangeOver0_5Count,tail:d.all.nearTailScoreCount,reversals:d.all.consecutiveTripletReversalsOver0_25Count},recent:{n:d.recent.n,response:d.recent.levelResponsePlus0_1Mean,jumps:d.recent.scoreChangeOver0_5Count,tail:d.recent.nearTailScoreCount,reversals:d.recent.consecutiveTripletReversalsOver0_25Count}}))})),null,2));
else if (process.argv.includes("--length")) console.log(serialized.length);
else if (process.argv.some((a)=>a.startsWith("--slice="))) {
  const start = Number(process.argv.find((a)=>a.startsWith("--slice=")).split("=")[1]);
  console.log(serialized.slice(start,start+30000));
} else console.log(serialized);
