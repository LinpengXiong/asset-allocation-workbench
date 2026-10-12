/** Limited, versioned scale diagnostics; not macro-event, PIT or asset-return validation. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { interpolateScore } from "../lib/macro-scoring-continuous.mjs";

const root = new URL("../", import.meta.url);
const load = async (file) => JSON.parse(await readFile(new URL(file, root), "utf8"));
async function frozenOrCurrent(backup, fallback) {
  try { return { file:backup, value:await load(backup) }; }
  catch (error) { if (error.code !== "ENOENT") throw error; return { file:fallback, value:await load(fallback) }; }
}
const [frameworkInput, currentInput, prices, gdp] = await Promise.all([
  frozenOrCurrent("deliverables/macro-rating-framework-before-v1-18-2026-10-11.json", "app/data/macro-rating-v1.json"),
  frozenOrCurrent("deliverables/macro-rating-current-before-v1-18-2026-10-11.json", "app/data/macro-rating-current.json"),
  load("app/data/macro-price-history.json"), load("app/data/macro-gdp-deflator-history.json"),
]);
const framework = frameworkInput.value, current = currentInput.value;
assert.equal(framework.version,"V1.17","freeze the real previous rule before V1.18 migration");
assert.equal(current.version,"V1.17","do not recalibrate using the new V1.18 current record");
assert.equal(framework.indicators.length,37);
const ppiRule=framework.indicators.find((row)=>row.id==="E04"), deflatorRule=framework.indicators.find((row)=>row.id==="E07");
assert.equal(ppiRule.scoring.method,"piecewise-linear");
assert.equal(deflatorRule.scoring.method,"piecewise-linear");
assert.equal(ppiRule.weight,.05);
assert.equal(deflatorRule.weight,.03);
const copy=(value)=>JSON.parse(JSON.stringify(value));
const round=(value)=>Number.isFinite(value)?Number(value.toFixed(10)):null;
const mean=(values)=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const index=(period)=>period.includes("Q")?Number(period.slice(0,4))*4+Number(period.at(-1)):Number(period.slice(0,4))*12+Number(period.slice(5));
const adjacent=(first,second)=>index(second)-index(first)===1;
const official=(value)=>{try{const url=new URL(value);return url.protocol==="https:"&&(url.hostname==="stats.gov.cn"||url.hostname.endsWith(".stats.gov.cn"));}catch{return false;}};
const quantile=(values,p)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),pos=(sorted.length-1)*p,i=Math.floor(pos);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(pos-i);};
function diagnose(scored) {
  const points=scored.map((row)=>row.points), values=scored.map((row)=>row.value), changes=[],reversals=[];
  assert.ok(points.every((value)=>Number.isFinite(value)&&value>=1-1e-9&&value<=5+1e-9));
  for(let i=1;i<scored.length;i++)if(adjacent(scored[i-1].period,scored[i].period))changes.push({period:scored[i].period,previousPeriod:scored[i-1].period,delta:scored[i].points-scored[i-1].points});
  for(let i=1;i<changes.length;i++)if(adjacent(changes[i-1].period,changes[i].period)&&changes[i].delta*changes[i-1].delta<0&&Math.abs(changes[i].delta)>=.25-1e-9&&Math.abs(changes[i-1].delta)>=.25-1e-9)
    reversals.push({period:changes[i].period,outbound:round(changes[i-1].delta),return:round(changes[i].delta)});
  return {n:scored.length,first:scored[0]?.period??null,last:scored.at(-1)?.period??null,
    rawPercentiles:[0,.1,.25,.5,.75,.9,1].map((p)=>round(quantile(values,p))),scoreMean:round(mean(points)),scoreStd:round(Math.sqrt(mean(points.map((value)=>(value-mean(points))**2))??0)),
    floorCount:points.filter((value)=>value<=1+1e-9).length,ceilingCount:points.filter((value)=>value>=5-1e-9).length,
    endpointScoreCount:points.filter((value)=>value<=1+1e-9||value>=5-1e-9).length,nearTailScoreCount:points.filter((value)=>value<=1.25+1e-9||value>=4.75-1e-9).length,
    consecutivePairCount:changes.length,meanAbsoluteScoreChange:round(mean(changes.map((row)=>Math.abs(row.delta)))),maximumAbsoluteScoreChange:round(changes.length?Math.max(...changes.map((row)=>Math.abs(row.delta))):null),
    scoreChangeOver0_5Count:changes.filter((row)=>Math.abs(row.delta)>.5+1e-9).length,
    largeChanges:changes.filter((row)=>Math.abs(row.delta)>.5+1e-9).map((row)=>({...row,delta:round(row.delta)})),
    consecutiveTripletReversalsOver0_25Count:reversals.length,reversals,
    scoreBands:[1,2,3,4].map((lower)=>({interval:lower===4?"[4,5]":`[${lower},${lower+1})`,count:points.filter((value)=>value>=lower-1e-9&&(lower===4||value<lower+1-1e-9)).length})),
  };
}
function windows(rows) {
  const between=(first,last)=>rows.filter((row)=>row.period>=first&&row.period<=last);
  return [
    {key:"all",label:"全部可比历史",rows},
    {key:"pre-pandemic",label:"2015—2019疫情前",rows:between("2015","2019-Z")},
    {key:"pandemic",label:"2020—2022疫情与基数",rows:between("2020","2022-Z")},
    {key:"reopening2023",label:"2023重启与基数",rows:between("2023","2023-Z")},
    {key:"since2023",label:"2023年以来",rows:rows.filter((row)=>row.period>="2023")},
    {key:"recent",label:"2024年以来",rows:rows.filter((row)=>row.period>="2024")},
    ...Array.from({length:12},(_,i)=>{const year=2015+i;return {key:`year${year}`,label:`${year}年${year===2026?"（仅已公布统计期）":""}`,rows:between(`${year}`,`${year}-Z`)};}),
  ].filter((window)=>window.rows.length);
}
function currentPrecision(anchors, value) {
  const scores=[interpolateScore(value-.05,anchors),interpolateScore(value+.05,anchors)];
  return {minimum:round(Math.min(...scores)),maximum:round(Math.max(...scores)),rawBound:.05,unit:"百分点",note:"当月PPI公布一位小数的已知舍入范围敏感性，不是统计置信区间。"};
}

// All candidates fixed before comparing scores; negative anchors, 0.5/1/2 points and full 1–5 range remain unchanged.
const ppiSpecs=[
  {key:"baseline",label:"现行V1.17",anchors:[[-5,1],[-2.5,2],[-1,3],[.5,4],[1,5],[2,5],[3,4],[5,3],[8,2],[12,1]]},
  {key:"moderate",label:"适度高端降分",anchors:[[-5,1],[-2.5,2],[-1,3],[.5,4],[1,5],[2,5],[3,3.5],[5,2.5],[8,1.5],[12,1]]},
  {key:"strict",label:"较严格高端降分",anchors:[[-5,1],[-2.5,2],[-1,3],[.5,4],[1,5],[2,5],[3,3],[5,2],[8,1.5],[12,1]]},
];
assert.deepEqual(ppiRule.scoring.anchors,ppiSpecs[0].anchors);
for(const spec of ppiSpecs)assert.deepEqual(spec.anchors.slice(0,6),ppiSpecs[0].anchors.slice(0,6));
const ppiRows=prices.rows.filter((row)=>row.period>="2015-01"&&row.period<="2026-08").map((row)=>({period:row.period,value:row.ppi,sourceUrl:row.ppiUrl,unit:"%",basis:"当月同比",originalPublisher:"国家统计局"})).sort((a,b)=>a.period.localeCompare(b.period));
assert.equal(ppiRows.length,140);
assert.equal(new Set(ppiRows.map((row)=>row.period)).size,140);
assert.ok(ppiRows.every((row,i)=>Number.isFinite(row.value)&&official(row.sourceUrl)&&(i===0||adjacent(ppiRows[i-1].period,row.period))));
assert.equal(ppiRows[0].period,"2015-01");assert.equal(ppiRows.at(-1).period,"2026-08");
const ppiCandidates=ppiSpecs.map((spec)=>({key:spec.key,label:spec.label,scoring:{...copy(ppiRule.scoring),anchors:copy(spec.anchors)},anchors:copy(spec.anchors),
  diagnostics:windows(ppiRows).map((window)=>({key:window.key,window:window.label,...diagnose(window.rows.map((row)=>({...row,points:interpolateScore(row.value,spec.anchors)})))})),
  currentScore:round(interpolateScore(current.observations.E04.value,spec.anchors)),precisionRange:currentPrecision(spec.anchors,current.observations.E04.value),
  referenceScores:[-5,-2.5,-1,0,.5,1,1.5,2,2.5,3,4,5,6,8,12].map((value)=>({value,points:round(interpolateScore(value,spec.anchors))})),
  slopes:spec.anchors.slice(1).map(([toValue,toScore],i)=>({fromValue:spec.anchors[i][0],toValue,slope:round((toScore-spec.anchors[i][1])/(toValue-spec.anchors[i][0])),unit:"分/百分点"})),
}));
const ppiSelected=ppiCandidates.find((candidate)=>candidate.key==="moderate");
ppiSelected.scoring.description="PPI当月同比评价工业价格环境，不评价上游资产收益。保留负侧和0.5/1/2%的参考点及完整1—5量尺；3/5/8/12%依次为3.5/2.5/1.5/1分。高位涨幅更快体现成本风险，但恢复、基数和供给冲击需另行解释，不把3%或5%定性为恶性通胀。";
const ppiReason="选择适度高端降分：更快表达超过研究峰区后的价格与成本压力，3/5/8%分别由4/3/2降至3.5/2.5/1.5分；负侧、0.5/1/2%及1—5量尺不变。2—3%区段斜率由−1变为−1.5分/百分点，比严格候选−2审慎，避免将每0.1个百分点的变化直接扩大为0.2分。选择是经济含义和有限尺度权衡，未以本期总分、方差或资产回报选参，也未证明这些具体分数是最优。";

const deflatorAnchors=copy(deflatorRule.scoring.anchors);
const gdpRows=gdp.rows.filter((row)=>row.period>="2015-Q1"&&row.period<="2026-Q2"&&row.vintage==="2026-09-15-SDDS")
  .sort((a,b)=>a.period.localeCompare(b.period)).map((row)=>{
    assert.ok([row.nominalGdp,row.priorYearNominalGdp,row.realGdpIndex].every((value)=>Number.isFinite(value)&&value>0));
    const value=(row.nominalGdp/row.priorYearNominalGdp/(row.realGdpIndex/100)-1)*100;
    return {period:row.period,value,levelPoints:interpolateScore(value,deflatorAnchors),sourceUrl:row.sourceUrl,unit:"%",basis:"GDP平减指数单季同比派生",vintage:row.vintage,
      raw:{nominalGdp:row.nominalGdp,priorYearNominalGdp:row.priorYearNominalGdp,realGdpIndex:row.realGdpIndex}};
  });
assert.equal(gdpRows.length,46);
assert.ok(gdpRows.every((row,i)=>official(row.sourceUrl)&&(i===0||adjacent(gdpRows[i-1].period,row.period))));
assert.equal(gdpRows[0].period,"2015-Q1");assert.equal(gdpRows.at(-1).period,"2026-Q2");
const deflatorWindows=gdpRows.slice(2).map((row,i)=>({period:row.period,value:row.value,currentQuarterPoints:row.levelPoints,
  precedingTwoQuarterMeanPoints:(gdpRows[i].levelPoints+gdpRows[i+1].levelPoints)/2,
  components:copy(gdpRows.slice(i,i+3)),sourceUrl:row.sourceUrl,vintage:row.vintage}));
assert.equal(deflatorWindows.length,44);
const deflatorSpecs=[
  {key:"baseline",label:"现行单季水平100%",currentWeight:1},
  {key:"current60",label:"本季60%＋前两季各20%",currentWeight:.6},
  {key:"current70",label:"本季70%＋前两季各15%",currentWeight:.7},
  {key:"current80",label:"本季80%＋前两季各10%",currentWeight:.8},
];
function lagDiagnostic(sample,weight){
  const opposite=[],lagged=[];
  for(let i=1;i<sample.length;i++){
    if(!adjacent(sample[i-1].period,sample[i].period))continue;
    const baselineChange=sample[i].currentQuarterPoints-sample[i-1].currentQuarterPoints;
    const compositeChange=weight*baselineChange+(1-weight)*(sample[i].precedingTwoQuarterMeanPoints-sample[i-1].precedingTwoQuarterMeanPoints);
    if(Math.abs(baselineChange)>=.1-1e-9&&Math.abs(compositeChange)>=.1-1e-9&&baselineChange*compositeChange<0)
      opposite.push({period:sample[i].period,currentQuarterScoreChange:round(baselineChange),compositeScoreChange:round(compositeChange)});
    if(i>=2&&adjacent(sample[i-2].period,sample[i-1].period)){
      const priorChange=sample[i-1].currentQuarterPoints-sample[i-2].currentQuarterPoints;
      if(priorChange*baselineChange<0&&Math.abs(priorChange)>=.25-1e-9&&Math.abs(baselineChange)>=.25-1e-9&&compositeChange*baselineChange<=0)
        lagged.push({period:sample[i].period,precedingScoreChange:round(priorChange),currentQuarterScoreChange:round(baselineChange),compositeScoreChange:round(compositeChange)});
    }
  }
  const differences=sample.map((row)=>(1-weight)*(row.precedingTwoQuarterMeanPoints-row.currentQuarterPoints));
  return {directionOppositionCount:opposite.length,directionOppositions:opposite,currentQuarterScoreReversalLagCount:lagged.length,reversalLags:lagged,
    meanAbsoluteDeviationFromCurrentQuarterOnly:round(mean(differences.map(Math.abs))),maximumAbsoluteDeviationFromCurrentQuarterOnly:round(differences.length?Math.max(...differences.map(Math.abs)):null),
    deviationOver0_5Count:differences.filter((value)=>Math.abs(value)>.5+1e-9).length,
    definition:"与单季水平得分方向相反或反转延迟，只是函数记忆的滞后诊断，不是实际经济转向滞后率。"};
}
const currentDeflatorLevel=interpolateScore(current.observations.E07.value,deflatorAnchors), currentPrevious=gdpRows.slice(-3,-1),currentPastMean=mean(currentPrevious.map((row)=>row.levelPoints));
assert.ok(Math.abs(gdpRows.at(-1).value-current.observations.E07.value)<1e-6,"keep the observed current value unchanged; raw recomputation must match its disclosed precision");
const deflatorCandidates=deflatorSpecs.map((spec)=>({key:spec.key,label:spec.label,currentWeight:spec.currentWeight,
  precedingQuarterWeights:[(1-spec.currentWeight)/2,(1-spec.currentWeight)/2],anchors:copy(deflatorAnchors),
  formula:"w×L(本季平减指数同比)+(1−w)×[L(前一季同比)+L(前二季同比)]/2；不是先平均原值再评分。",
  diagnostics:windows(deflatorWindows).map((window)=>({key:window.key,window:window.label,...diagnose(window.rows.map((row)=>({...row,points:spec.currentWeight*row.currentQuarterPoints+(1-spec.currentWeight)*row.precedingTwoQuarterMeanPoints}))),
    persistenceLag:lagDiagnostic(window.rows,spec.currentWeight)})),
  currentScore:round(spec.currentWeight*currentDeflatorLevel+(1-spec.currentWeight)*currentPastMean),
  currentComponents:[...currentPrevious,{period:current.observations.E07.period,value:current.observations.E07.value,levelPoints:currentDeflatorLevel,sourceUrl:current.observations.E07.sourceUrl,vintage:"2026-09-15-SDDS",note:"本季沿用原始观察存储精度，不修改原值。"}],
}));
const deflatorSelected=deflatorCandidates.find((candidate)=>candidate.key==="current70");
const deflatorReason="选择70/15/15作为试行持续性权衡：本季仍占主导，过去两季的水平得分共同刻画价格修复是否持续；单季原值和原评分参考点均不重拟合。60%本季方案记忆更强，80%方案更贴近单季；必须同时报告平滑与反转滞后，不能把较少跳变解释为较少经济误报，也不能将前两季有利条件当成本季已经改善。";

const comparisons=(candidates)=>candidates.map((candidate)=>{const all=candidate.diagnostics[0],recent=candidate.diagnostics.find((row)=>row.key==="recent");return {label:candidate.label,
  summary:`同窗${all.n}期，相邻绝对变分均值${all.meanAbsoluteScoreChange}，大于0.5分变化${all.scoreChangeOver0_5Count}次，最大${all.maximumAbsoluteScoreChange}分；触底${all.floorCount}期、满分${all.ceilingCount}期，反转${all.consecutiveTripletReversalsOver0_25Count}次。2024年以来${recent.n}期，大于0.5分变化${recent.scoreChangeOver0_5Count}次。${all.persistenceLag?`与单季水平方向相反${all.persistenceLag.directionOppositionCount}次，函数反转延迟${all.persistenceLag.currentQuarterScoreReversalLagCount}次。`:""}以上均是尺度统计，不是经济误报率或最优分数证明。`};});
const limitations=[
  "同一组既有官方原值比较有限、事先固定候选；这些历史已被查看，不是未见样本或PIT逐期可得信息回放。",
  "跳变、平均得分、方差、饱和和反转只用于尺度诊断；没有独立经济状态、后续下游利润率或成本压力的完整真值检验，不代表最优分数、经济误报率或样本外资产回报。",
  "PPI负侧、0.5/1/2%参考点本轮保留；仍不能据此宣称−1%为健康中性，或1—2%是官方/已验证的最佳工业通胀区间。",
  "高位PPI可能来自需求恢复、低基数、输入成本或供给调整；较低得分是审慎价格环境假设，不把3%或5%定性为恶性通胀，也不拿下游利润为PPI额外加分。",
  "GDP平减指数使用同一2026-09-15-SDDS修订段46季复算，组合只比较44个完整连续三季窗口；不把其他修订段拼接、不跨缺季平均。",
  "GDP70/15/15加入过去得分会产生记忆与反转滞后；平滑可能减弱新改善，也可能暂时抬高新恶化时的得分，须同时报告代价。",
  "GDP组合是三个单季水平得分加权，绝不是平减指数原值平均后评分；主观察仍保留本季同比原值和公式证据。",
  "本期工业利润新增20%广度由另一份实现核验；完整可比利润组件历史目前只有1点，本报告没有将其包装成完整利润历史校准。",
  "每个本地原值保留官方链接；本脚本核对齐期、同版及公式，不声称本轮重新下载了所有原网页。得分函数插值不用于补统计缺口。",
];
const output={version:"V1.18",baseVersion:"V1.17",asOf:current.asOf,status:"limited current-vintage parameter-scale diagnostics; research trial, not PIT/unseen/economic-event or asset-return validation",
  frozenInputs:{framework:frameworkInput.file,current:currentInput.file},scope:"只诊断PPI正值高端和GDP平减指数持续性；不修改工作台数据或发布。",hypothesis:"对高位工业价格风险更审慎，并在GDP价格条件中加入有限持续性，但不以当前低分目标或跳变数量选择经济真值。",
  candidateProtocol:"PPI现版/适度/较严格三条固定曲线；GDP同一44个完整窗口比较100/0、60/20/20、70/15/15、80/10/10；不搜索最优总分。",limitations,
  diagnosticDefinitions:{scoreChangeOver0_5Count:"相邻连续统计期的得分绝对变化严格大于0.5的次数，不是经济误报。",consecutiveTripletReversalsOver0_25Count:"连续三期得分先变后反向，两段变化各至少0.25分，不是实际经济反转标签。",persistenceLag:"组合相对单季水平分的方向相反/反转延迟，衡量函数记忆的代价，不等于经济预测滞后。"},
  ppi:{id:"E04",name:ppiRule.name,selectedCandidate:"moderate",decision:"调整",scoring:copy(ppiSelected.scoring),reason:ppiReason,
    sampleSummary:"2015-01—2026-08，同口径当月同比完整140个月、139对相邻月，全部保留国家统计局原链接；无缺月无插值。",comparisons:comparisons(ppiCandidates),precisionRange:copy(ppiSelected.precisionRange),limitations:limitations.filter((text)=>!text.startsWith("GDP")),
    current:{period:current.observations.E04.period,value:current.observations.E04.value,unit:"%",basis:"当月同比",sourceUrl:current.observations.E04.sourceUrl,scores:Object.fromEntries(ppiCandidates.map((candidate)=>[candidate.key,candidate.currentScore]))},
    candidates:ppiCandidates,data:{sourceFile:"app/data/macro-price-history.json",rows:ppiRows}},
  deflator:{id:"E07",name:deflatorRule.name,selectedCandidate:"current70",decision:"调整",reason:deflatorReason,anchors:copy(deflatorAnchors),selectedWeights:[.7,.15,.15],
    sampleSummary:"2015-Q1—2026-Q2同版46季现价与实际原值复算；2015-Q3—2026-Q2共有44个连续三季完整窗口，所有候选严格同窗。",comparisons:comparisons(deflatorCandidates),limitations:limitations.filter((text)=>!text.startsWith("PPI")&&!text.startsWith("高位PPI")),
    current:{period:current.observations.E07.period,value:current.observations.E07.value,unit:"%",basis:current.observations.E07.basis,sourceUrl:current.observations.E07.sourceUrl,levelScore:round(currentDeflatorLevel),precedingTwoQuarterMeanLevelScore:round(currentPastMean),scores:Object.fromEntries(deflatorCandidates.map((candidate)=>[candidate.key,candidate.currentScore]))},
    candidates:deflatorCandidates,data:{sourceFile:"app/data/macro-gdp-deflator-history.json",vintage:"2026-09-15-SDDS",formula:gdp.formula,rawRows:gdpRows,comparisonWindows:deflatorWindows}},
  contributionImpact:{ppiWeight:ppiRule.weight,deflatorWeight:deflatorRule.weight,
    ppiChange:round((ppiSelected.currentScore-ppiCandidates[0].currentScore)*ppiRule.weight),
    deflatorChange:round((deflatorSelected.currentScore-deflatorCandidates[0].currentScore)*deflatorRule.weight),
    combinedTheseTwoChange:round((ppiSelected.currentScore-ppiCandidates[0].currentScore)*ppiRule.weight+(deflatorSelected.currentScore-deflatorCandidates[0].currentScore)*deflatorRule.weight),
    note:"仅按不变权重计算这两项的规则修订贡献差，不是新总分；本期经济原值没有变化。其他获准修改项及总览必须由完整评分器复算，本报告不手写最终总分。"},
};

function markdown(result){
  const lines=["# V1.18有限参数尺度诊断","",`截止日${result.asOf}；基线为冻结V1.17。只提供可复算尺度比较，不修改数据、权重或发布。`,"","## PPI：适度高端降分","",ppiReason,"",
    "|候选|参考点（同比%→得分）|","|---|---|",...ppiCandidates.map((candidate)=>`|${candidate.label}|${candidate.anchors.map(([value,points])=>`${value}→${points}`).join("；")}|`),"",
    "## GDP平减指数：持续性","",deflatorReason,"",deflatorCandidates[2].formula,"",
    "本季原值与过去两季原值、单季水平分均保留；当前三季组件分别如下：","",
    "|季度|复算同比/观察原值|单季水平分|","|---|---:|---:|",...deflatorSelected.currentComponents.map((row)=>`|${row.period}|${round(row.value)}|${round(row.levelPoints)}|`),"",
    "## 全样本与分阶段/分年比较","",
  ];
  for(const [name,candidates] of [["PPI",ppiCandidates],["GDP平减指数",deflatorCandidates]]){
    lines.push(`### ${name}`,"","|阶段|候选|期数|平均分|平均绝对变分|最大变分|>0.5变化|触底|满分|反转≥0.25|","|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for(const window of candidates[0].diagnostics)for(const candidate of candidates){const d=candidate.diagnostics.find((row)=>row.key===window.key);lines.push(`|${d.window}|${candidate.label}|${d.n}|${d.scoreMean}|${d.meanAbsoluteScoreChange}|${d.maximumAbsoluteScoreChange}|${d.scoreChangeOver0_5Count}|${d.floorCount}|${d.ceilingCount}|${d.consecutiveTripletReversalsOver0_25Count}|`);}
    lines.push("");
  }
  lines.push("## 持续性带来的滞后代价","","|候选|同窗44季与单季方向相反次数|函数反转延迟次数|平均偏离单季分|最大偏离单季分|","|---|---:|---:|---:|---:|");
  for(const candidate of deflatorCandidates){const d=candidate.diagnostics[0].persistenceLag;lines.push(`|${candidate.label}|${d.directionOppositionCount}|${d.currentQuarterScoreReversalLagCount}|${d.meanAbsoluteDeviationFromCurrentQuarterOnly}|${d.maximumAbsoluteDeviationFromCurrentQuarterOnly}|`);}
  lines.push("","这些计数是与单季函数相比的数学记忆滞后，不是真实经济转向识别率。新改善和新恶化均可能被缓冲，不能只汇报降噪。","","## 本期规则修订贡献（不是新总分）","",
    `PPI原值${result.ppi.current.value}%不变，适度候选为${ppiSelected.currentScore.toFixed(2)}分（现版${ppiCandidates[0].currentScore.toFixed(2)}）；GDP本季同比原值${result.deflator.current.value}%不变，70/15/15为${deflatorSelected.currentScore.toFixed(2)}分（单季${deflatorCandidates[0].currentScore.toFixed(2)}）。`,"",
    `两项按原权重的贡献差：PPI ${result.contributionImpact.ppiChange}；GDP平减指数 ${result.contributionImpact.deflatorChange}；仅两项合计 ${result.contributionImpact.combinedTheseTwoChange}。最终总分须由完整评分器连同其他获准改动重算。`,"","## 证据与范围","",
    "PPI140月官方链接、GDP46季同版原值与44个完整窗口全部保存在同名JSON；原表沿用此前经核验资料，本次未用新闻摘要、其他部门口径、插值或混合修订版补样本。", "",
    "利润完整组件历史只有1个点；新增广度的本期核验由另一模块完成，本报告没有宣称利润历史已完整校准。","","## 限制","",...limitations.map((text)=>`- ${text}`),"",
    "复算入口：scripts/calibrate-macro-v1-18.mjs --write；只机械生成本报告JSON/Markdown，不修改评分框架或发布。","");
  return lines.join("\n");
}
if(process.argv.includes("--write")){
  await writeFile(new URL("deliverables/macro-v1-18-parameter-diagnostics.json",root),JSON.stringify(output,null,2)+"\n");
  await writeFile(new URL("deliverables/macro-v1-18-parameter-diagnostics.md",root),markdown(output));
}
if(process.argv.includes("--summary"))console.log(JSON.stringify({version:output.version,frozenInputs:output.frozenInputs,
  ppi:ppiCandidates.map((candidate)=>({key:candidate.key,currentScore:candidate.currentScore,all:candidate.diagnostics[0]})),
  deflator:deflatorCandidates.map((candidate)=>({key:candidate.key,currentScore:candidate.currentScore,all:candidate.diagnostics[0]})),
  contributionImpact:output.contributionImpact},null,2));
else if(!process.argv.includes("--write"))console.log(JSON.stringify(output,null,2));
else console.log(JSON.stringify({written:["deliverables/macro-v1-18-parameter-diagnostics.json","deliverables/macro-v1-18-parameter-diagnostics.md"],frozenInputs:output.frozenInputs,
  ppiSamples:ppiRows.length,deflatorRawSamples:gdpRows.length,deflatorCompleteWindows:deflatorWindows.length,ppiCurrent:ppiSelected.currentScore,deflatorCurrent:deflatorSelected.currentScore},null,2));
