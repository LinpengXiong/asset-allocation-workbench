/** PPI price-environment scale diagnostics, not a PIT/event/asset-return backtest. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { interpolateScore } from "../lib/macro-scoring-continuous.mjs";

const root = new URL("../", import.meta.url);
const load = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
async function frozenOrCurrent(backup, fallback) {
  try { return { value: await load(backup), file: backup }; }
  catch (error) { if (error.code !== "ENOENT") throw error; return { value: await load(fallback), file: fallback }; }
}
const [frameworkInput, currentInput, prices] = await Promise.all([
  frozenOrCurrent("deliverables/macro-rating-framework-before-v1-17-2026-10-11.json", "app/data/macro-rating-v1.json"),
  frozenOrCurrent("deliverables/macro-rating-current-before-v1-17-2026-10-11.json", "app/data/macro-rating-current.json"),
  load("app/data/macro-price-history.json"),
]);
const framework = frameworkInput.value, current = currentInput.value;
assert.equal(framework.version, "V1.16", "use the frozen actual V1.16 rule, not the changed V1.17 rule");
assert.equal(current.version, "V1.16", "current observation must use the frozen pre-migration V1.16 version");
assert.equal(framework.indicators.length, 37);
const rule = framework.indicators.find((row) => row.id === "E04");
assert.equal(rule.scoring.method, "piecewise-linear");
assert.equal(rule.weight, .05);
assert.equal(rule.measurementBasis, "当月同比");
const baselineAnchors = [[-5,1],[-2.5,2],[-1,3],[.5,4],[2,5],[3,5],[5,4],[8,2],[12,1]];
assert.deepEqual(rule.scoring.anchors, baselineAnchors);

// Fixed before diagnostics: no optimization against the current total, future returns, or score variance.
const specs = [
  { key: "baseline", label: "现版V1.16：峰区2—3%", anchors: baselineAnchors },
  { key: "A", label: "温和峰1—2%", anchors: [[-5,1],[-2.5,2],[-1,3],[.5,4],[1,5],[2,5],[3,4],[5,3],[8,2],[12,1]] },
  { key: "B", label: "较宽峰0.5—2%", anchors: [[-5,1],[-2.5,2],[-1,3],[.5,5],[2,5],[3,4],[5,3],[8,2],[12,1]] },
  { key: "C", label: "较早降分1—1.5%", anchors: [[-5,1],[-2.5,2],[-1,3],[.5,4],[1,5],[1.5,5],[2.5,4],[4,3],[6,2],[12,1]] },
];
const copy = (value) => JSON.parse(JSON.stringify(value));
const round = (value) => Number.isFinite(value) ? Number(value.toFixed(10)) : null;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b), index = (sorted.length-1)*p, left = Math.floor(index);
  return sorted[left] + (sorted[Math.min(left+1, sorted.length-1)] - sorted[left])*(index-left);
};
const monthIndex = (period) => Number(period.slice(0,4))*12 + Number(period.slice(5));
const officialUrl = (value) => {
  try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "stats.gov.cn" || url.hostname.endsWith(".stats.gov.cn")); }
  catch { return false; }
};
const rows = prices.rows.filter((row) => row.period >= "2015-01" && row.period <= "2026-08")
  .map((row) => ({ period: row.period, value: row.ppi, sourceUrl: row.ppiUrl,
    originalPublisher: "国家统计局", unit: "%", basis: "当月同比" }))
  .sort((a,b) => a.period.localeCompare(b.period));
assert.equal(rows.length, 140);
assert.equal(new Set(rows.map((row) => row.period)).size, 140);
assert.equal(rows[0].period, "2015-01");
assert.equal(rows.at(-1).period, "2026-08");
assert.ok(rows.every((row, index) => Number.isFinite(row.value) && officialUrl(row.sourceUrl)
  && (index === 0 || monthIndex(row.period)-monthIndex(rows[index-1].period) === 1)), "reject missing months/values/nonofficial links; never interpolate observations");
const latest = current.observations.E04;
assert.equal(latest.value, 3.8);
assert.equal(latest.period, "2026-08");
assert.equal(latest.basis, "当月同比");
assert.equal(latest.originalPublisher, "国家统计局");
assert.equal(rows.at(-1).value, latest.value);

function diagnostics(anchors, sample) {
  const scored = sample.map((row) => ({ ...row, points: interpolateScore(row.value, anchors) }));
  const points = scored.map((row) => row.points), values = scored.map((row) => row.value);
  const deltas = [], reversals = [];
  for (let i=1;i<scored.length;i++) if (monthIndex(scored[i].period)-monthIndex(scored[i-1].period) === 1)
    deltas.push({ period: scored[i].period, previousPeriod: scored[i-1].period, delta: scored[i].points-scored[i-1].points });
  for (let i=1;i<deltas.length;i++) if (monthIndex(deltas[i].period)-monthIndex(deltas[i-1].period) === 1
    && deltas[i].delta*deltas[i-1].delta < 0 && Math.abs(deltas[i].delta) >= .25-1e-10 && Math.abs(deltas[i-1].delta) >= .25-1e-10)
    reversals.push({ period: deltas[i].period, outbound: round(deltas[i-1].delta), return: round(deltas[i].delta) });
  const roundingWidths = values.map((value) => Math.abs(interpolateScore(value+.05, anchors)-interpolateScore(value-.05, anchors)));
  return {
    n: sample.length, first: sample[0]?.period ?? null, last: sample.at(-1)?.period ?? null,
    rawPercentiles: [0,.1,.25,.5,.75,.9,1].map((p) => round(quantile(values,p))),
    scoreMean: round(mean(points)), scoreStd: round(Math.sqrt(mean(points.map((value) => (value-mean(points))**2)) ?? 0)),
    floorCount: points.filter((value) => value <= 1+1e-10).length,
    ceilingCount: points.filter((value) => value >= 5-1e-10).length,
    endpointScoreCount: points.filter((value) => value <= 1+1e-10 || value >= 5-1e-10).length,
    nearTailScoreCount: points.filter((value) => value <= 1.25+1e-10 || value >= 4.75-1e-10).length,
    scoreBands: [1,2,3,4].map((lower) => ({ interval: lower === 4 ? "[4,5]" : `[${lower},${lower+1})`,
      count: points.filter((value) => value >= lower-1e-10 && (lower === 4 || value < lower+1-1e-10)).length })),
    consecutivePairCount: deltas.length,
    meanAbsoluteScoreChange: round(mean(deltas.map((row) => Math.abs(row.delta)))),
    maximumAbsoluteScoreChange: round(deltas.length ? Math.max(...deltas.map((row) => Math.abs(row.delta))) : null),
    scoreChangeOver0_5Count: deltas.filter((row) => Math.abs(row.delta) > .5+1e-10).length,
    largeChanges: deltas.filter((row) => Math.abs(row.delta) > .5+1e-10).map((row) => ({...row,delta:round(row.delta)})),
    consecutiveTripletReversalsOver0_25Count: reversals.length, reversals,
    plus0_1MeanAbsoluteScoreResponse: round(mean(values.map((value) => Math.abs(interpolateScore(value+.1,anchors)-interpolateScore(value,anchors))))),
    knownRoundingWidthMean: round(mean(roundingWidths)), knownRoundingWidthMaximum: round(roundingWidths.length ? Math.max(...roundingWidths) : null),
    positiveCostPressureSampleCount: values.filter((value) => value > 3).length,
    positiveCostPressureMeanScore: round(mean(scored.filter((row) => row.value > 3).map((row) => row.points))),
  };
}
const between = (first,last) => rows.filter((row) => row.period >= first && row.period <= last);
const windows = [
  { key: "all", label: "全部2015-01—2026-08", rows },
  { key: "pre-pandemic", label: "2015—2019", rows: between("2015-01","2019-12") },
  { key: "recovery2016-2017", label: "2016—2017恢复与基数阶段", rows: between("2016-01","2017-12") },
  { key: "pandemic2020-2022", label: "2020—2022疫情与基数阶段", rows: between("2020-01","2022-12") },
  { key: "shock2021-2022", label: "2021—2022上游价格冲击阶段", rows: between("2021-01","2022-12") },
  { key: "reopening2023", label: "2023重启与基数阶段", rows: between("2023-01","2023-12") },
  { key: "since2023", label: "2023年以来", rows: between("2023-01","2026-08") },
  { key: "recent", label: "2024年以来", rows: between("2024-01","2026-08") },
  ...Array.from({length:12}, (_,index) => {
    const year = 2015+index; return { key: `year${year}`, label: `${year}年${year === 2026 ? "（仅1—8月）" : ""}`,
      rows: between(`${year}-01`,`${year}-12`) };
  }),
];
const candidates = specs.map((spec) => ({ ...copy(spec), scoring: { ...copy(rule.scoring), anchors: copy(spec.anchors) },
  diagnostics: windows.map((window) => ({ key: window.key, window: window.label, ...diagnostics(spec.anchors,window.rows) })),
  currentScore: round(interpolateScore(latest.value,spec.anchors)),
  currentPrecisionRange: { input: latest.value, reportedIncrement: .1, lowerInput: round(latest.value-.05), upperInput: round(latest.value+.05),
    scoreInterval: [round(interpolateScore(latest.value+.05,spec.anchors)),round(interpolateScore(latest.value-.05,spec.anchors))],
    interpretation: "原值保留一位小数对应的已知舍入范围敏感性，不是统计置信区间；上界端点形式不影响显示。" },
  referenceScores: [-5,-2.5,-1,0,.5,1,1.5,2,3,4,5,6,8,12].map((value) => ({value,points:round(interpolateScore(value,spec.anchors))})),
}));
// A is selected for the intended interpretation and conservative trade-off, never the current score direction.
const selected = candidates.find((candidate) => candidate.key === "A");
assert.deepEqual(selected.anchors.slice(0,4), baselineAnchors.slice(0,4));
assert.equal(selected.currentScore, 3.6);
const baselineDiag = candidates[0].diagnostics[0], selectedDiag = selected.diagnostics[0], bDiag = candidates[2].diagnostics[0];
assert.equal(selectedDiag.floorCount, baselineDiag.floorCount);
assert.ok(selectedDiag.scoreChangeOver0_5Count <= bDiag.scoreChangeOver0_5Count);

const officialReferences = [
  { title: "国家统计局：2017年CPI温和上涨、PPI涨势趋稳", publisher: "国家统计局", releaseDate: "2018-01-19", verifiedAt: current.asOf,
    url: "https://www.stats.gov.cn/sj/sjjd/202302/t20230202_1895976.html",
    officialFact: "2017年全年PPI上涨6.3%；统计局将其解释为持续恢复性上涨，并讨论供给侧改革、全球价格、前期下跌和低基数因素。",
    researchImplication: "较高PPI涨幅不能仅凭数值定性为恶性通胀；高端降分是对广义价格环境与成本压力的审慎评价，不是宣称整体经济必然恶化。" },
  { title: "国家发展改革委2021年7月新闻发布会：大宗商品保供稳价", publisher: "国家发展改革委", releaseDate: "2021-07-20", verifiedAt: current.asOf,
    url: "https://www.ndrc.gov.cn/fggz/fgzy/shgqhy/202107/t20210720_1290819_ext.html",
    officialFact: "有关部门采取重点企业约谈、期现货联动监管及铜铝锌储备投放等措施，并报告价格回落和PPI环比涨幅收窄。",
    researchImplication: "上游涨价与成本传导需要单独观察；官方措施没有给出PPI3%或4%的法定风险阈值。" },
  { title: "人民银行2021年第二季度中国货币政策执行报告", publisher: "中国人民银行", releaseDate: "2021-08-09", verifiedAt: current.asOf,
    url: "https://www.pbc.gov.cn/goutongjiaoliu/fileDir/resource/cms/2021/08/2021081015495988989.pdf",
    officialFact: "报告强调跟踪物价走势、稳定预期和维护物价总体稳定，并将货币政策力度节奏与国内经济和物价形势相联系。",
    researchImplication: "评分不宜将PPI单项持续上涨机械解释为全面需求改善，也不应将CPI目标直接套成PPI目标。" },
  { title: "国家统计局2026年8月工业生产者价格原始发布", publisher: "国家统计局", releaseDate: latest.releaseDate, verifiedAt: current.asOf,
    url: latest.sourceUrl, verification: "既有经核验本期原始观察，统计期、口径和数值保持不变；本轮评分诊断不重新生成或更改原值。" },
  { title: "国家统计局解读2026年8月CPI和PPI", publisher: "国家统计局", releaseDate: "2026-09-09", verifiedAt: current.asOf,
    url: "https://www.stats.gov.cn/xxgk/jd/sjjd2020/202609/t20260909_1965261.html",
    officialFact: "PPI当月同比为3.8%；解读将环比变动区分为国际大宗商品输入性影响、部分转型升级行业需求和季节因素。",
    researchImplication: "本期存在需求与输入成本等多种因素；单一总同比仍不能确定上下游净盈利效果。" },
];
const reason = `采用候选A，把5分研究峰区由2—3%移至1—2%；0.5%仍为4分，3%为4分、5%为3分、8%为2分、12%为1分，负值侧及0.5%参照不变。全样本超过0.5分的相邻变化由${baselineDiag.scoreChangeOver0_5Count}次变为${selectedDiag.scoreChangeOver0_5Count}次，B为${bDiag.scoreChangeOver0_5Count}次；A避免把仅0.5%的低正增长直接封顶。A最大单月变分${selectedDiag.maximumAbsoluteScoreChange}分，仍高于原版${baselineDiag.maximumAbsoluteScoreChange}分，不能称全面更平滑。C过早降低高正值评分，本轮不选。选择基于价格环境含义与固定候选的尺度权衡，未验证1—2%为最优PPI。`;
const description = "评价广义工业价格环境，不评价上游资产收益。采用连续分段线性研究曲线：负值侧保留旧参照；1—2%为温和正增长5分试行峰区，超过2%逐步降低，3/5/8/12%分别为4/3/2/1分。较高涨幅可能包含恢复、基数、输入成本或供给冲击，不按3%或4%定性为恶性通胀。";
selected.scoring.description = description;
const limitations = [
  "140个现存官方原表数据点属于当前整理版本历史，不是逐期可得信息集（PIT）回放；2026年基期轮换及历史发布版本仍需留意。",
  "逐月原值和官方链接来自既有已核验资料，本脚本仅核对齐期、有限数值及国家统计局链接域名，不声称本轮重新下载核验了140个原网页。",
  "仅比较评分函数灵敏度、跳变、反转、舍入范围和高低端覆盖；没有独立经济状态标签，不能称已检验真实预警误报率。",
  "没有样本外资产回报或因果验证；历史评分分布、均值、方差及本期总分不作为选参目标。",
  "官方材料支持警惕上游成本和多因素解释，不规定1—2%的PPI目标或3/4%的风险阈值；这些是研究试行评分参照，不是官方评分标准或最优通胀区间。",
  "本轮仅重设正值高分区和高端路径；保留-5/-2.5/-1对应1/2/3分，不表示-1%的工业通缩是健康、中性或已得到验证。",
  "PPI涨价受上游权重、国际商品、供给和基数影响，高同比不自动等于需求强；转入高端降分也不自动意味着工业盈利或上游资产收益下降。",
  "不调整37项成员、任何单项权重、统计期、截止日或原始观察；插值仅作用于得分函数，不补齐缺失统计数据。",
  "候选A减少大变分次数但提高样本最大单次变分；这项权衡公开保留，不以更平滑为单方面结论。",
];
const output = { version: "V1.17", baseVersion: "V1.16", asOf: current.asOf, id: "E04", name: rule.name, decision: "调整",
  selectedCandidate: "A", scoring: copy(selected.scoring), reason,
  sampleSummary: "2015-01—2026-08，同口径当月PPI同比完整140个月，139个相邻月；每个原值保留国家统计局原始发布链接，无缺月、无插值。完整阶段与逐年诊断均保存；当前整理历史不是PIT。",
  status: "研究试行：正值高分区重设与历史尺度诊断；非官方评分、非真实经济误报率或样本外资产回报验证。",
  frozenInputs: { framework: frameworkInput.file, current: currentInput.file },
  hypothesis: "对于宏观背景判断，适度、温和的工业价格转正比持续上游大幅涨价更适合作为高分环境；修改峰区而非把PPI越高越好，或预设当前总分方向。",
  candidateProtocol: "实际V1.16基线与A/B/C三套固定候选；仅改变正值高分区和高端降分路径，负值侧及0.5%过渡点的改变在B中公开单列；不自动搜索参数。",
  diagnosticDefinitions: {
    scoreChangeOver0_5Count: "连续两个月得分绝对变化严格大于0.5的次数；不是经济坏信号或误报率。",
    consecutiveTripletReversalsOver0_25Count: "连续三个月先变后反向，两个方向绝对变化均至少0.25的次数；只是尺度反转诊断。",
    endpointScoreCount: "触及1分或5分的月份数，低端和高端分别报告；高分平坦区不是遗漏值。",
    positiveCostPressureSampleCount: "PPI大于3%的诊断子样本数量，只用于观察高端评分；大于3%不构成官方成本风险或恶性通胀认定。",
    scoreMean: "函数对固定同组原值的平均得分，不是宏观目标或选参优化指标。",
  },
  officialReferences,
  evidenceSources: officialReferences.map((reference) => ({ title: reference.title, url: reference.url,
    note: [reference.officialFact ?? reference.verification,reference.researchImplication].filter(Boolean).join(" 研究判断：") })),
  limitations,
  comparisons: candidates.map((candidate) => { const all=candidate.diagnostics[0], recent=candidate.diagnostics.find((item) => item.key === "recent");
    return { label:candidate.label,
      summary:`相同140个月，相邻绝对变分均值${all.meanAbsoluteScoreChange}，大于0.5分变化${all.scoreChangeOver0_5Count}次、最大${all.maximumAbsoluteScoreChange}分；触底${all.floorCount}期、满分${all.ceilingCount}期，至少0.25分反转${all.consecutiveTripletReversalsOver0_25Count}次。2024年以来${recent.n}个月，大于0.5分变化${recent.scoreChangeOver0_5Count}次、最大${recent.maximumAbsoluteScoreChange}分。次数不是经济误报率，峰区未经经济真值或样本外投资检验。` };
  }),
  precisionRange: { minimum:selected.currentPrecisionRange.scoreInterval[0], maximum:selected.currentPrecisionRange.scoreInterval[1],
    rawBound:.05, unit:"百分点", detail:copy(selected.currentPrecisionRange),
    note:"原值一位小数的已知舍入范围敏感性，不是统计置信区间。" },
  currentComparison: { period: latest.period, value: latest.value, unit: latest.unit, basis: latest.basis,
    sourceUrl: latest.sourceUrl, scores: Object.fromEntries(candidates.map((candidate) => [candidate.key,candidate.currentScore])),
    note: "同一个3.8%原值按不同函数计分，分数变化是规则修订，不是今天经济发生变化；本期总分不参与候选选择。" },
  candidates,
  data: { sourceFile: "app/data/macro-price-history.json", basis: "当月同比", unit: "%", expectedMonthCount: 140,
    officialUrlFormatCheckedCount: 140, sourceContentVerification: "继承既有官方原表核验；本轮不将域名检查冒充每个页面内容的重新下载核验。", rows },
};

function makeMarkdown(result) {
  const lines = ["# PPI评分参考点修订：V1.17", "", "仅修改经济运行E04的PPI价格环境评分曲线。37项成员、权重、截止日和原始观察均不变。", "",
    "## 结论", "", reason, "", "新峰区是研究配置，不是官方PPI目标；不以3%或4%断言恶性通胀，也不声称高于该值的涨价必然恶化。", "",
    "## 固定候选与函数", "", "|候选|原值—评分参考点|", "|---|---|",
    ...result.candidates.map((candidate) => `|${candidate.label}|${candidate.anchors.map(([value,points]) => `${value}%→${points}`).join("；")}|`), "",
    "## 同组140个月全样本诊断", "", "|候选|相邻变分>0.5|最大相邻变分|触底月份|满分月份|得分反转≥0.25|平均绝对变分|", "|---|---:|---:|---:|---:|---:|---:|",
    ...result.candidates.map((candidate) => { const d=candidate.diagnostics[0]; return `|${candidate.label}|${d.scoreChangeOver0_5Count}|${d.maximumAbsoluteScoreChange}|${d.floorCount}|${d.ceilingCount}|${d.consecutiveTripletReversalsOver0_25Count}|${d.meanAbsoluteScoreChange}|`; }), "",
    "跳变或反转次数只衡量评分函数，不是真实经济误报率。A虽减少大变分次数，但最大单次跳变仍高于旧版；完整尾部与舍入敏感性已保存。", "",
    "## 分阶段与逐年", "", "每行均使用相同原值组；阶段名称只作样本划分，不把所有价格变化归因为同一个事件。", "",
    "|阶段/年度|月数|旧版>0.5变分|A>0.5变分|B>0.5变分|C>0.5变分|旧版平均分|A平均分|B平均分|C平均分|", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...windows.map((window,index) => { const d=result.candidates.map((candidate) => candidate.diagnostics[index]); return `|${window.label}|${d[0].n}|${d.map((item) => item.scoreChangeOver0_5Count).join("|")}|${d.map((item) => item.scoreMean).join("|")}|`; }), "",
    "## 当前原值与已知舍入范围", "", `PPI原值${latest.value}%，统计期${latest.period}，来源和截止日不变；旧版${result.currentComparison.scores.baseline.toFixed(2)}分，候选A${selected.currentScore.toFixed(2)}分。原值公布到0.1个百分点，若考虑±0.05的已知舍入范围，A约为${selected.currentPrecisionRange.scoreInterval[0].toFixed(3)}—${selected.currentPrecisionRange.scoreInterval[1].toFixed(3)}分；这不是置信区间。`, "",
    "## 官方事实与研究判断分开", "",
    ...officialReferences.flatMap((reference) => [`- [${reference.title}](${reference.url})：${reference.officialFact ?? reference.verification}${reference.researchImplication ? ` 研究含义：${reference.researchImplication}` : ""}`, ""]),
    "## 限制", "", ...limitations.map((limitation) => `- ${limitation}`), "",
    "复算入口：scripts/calibrate-macro-ppi-v1-17.mjs；原始140点、每月官方链接、四套候选和全部诊断保存在同名JSON。", ""];
  return lines.join("\n");
}
if (process.argv.includes("--write")) {
  await writeFile(new URL("deliverables/macro-v1-17-ppi-calibration.json",root),JSON.stringify(output,null,2)+"\n");
  await writeFile(new URL("deliverables/macro-v1-17-ppi-calibration.md",root),makeMarkdown(output));
}
if (process.argv.includes("--summary")) console.log(JSON.stringify({ version: output.version, selected: output.selectedCandidate, current: output.currentComparison,
  candidates: candidates.map((candidate) => ({ key:candidate.key, all:candidate.diagnostics[0], recent:candidate.diagnostics.find((item) => item.key === "recent") })) },null,2));
else if (!process.argv.includes("--write")) console.log(JSON.stringify(output,null,2));
else console.log(JSON.stringify({ written: ["deliverables/macro-v1-17-ppi-calibration.json","deliverables/macro-v1-17-ppi-calibration.md"], rows: rows.length, selected: output.selectedCandidate,
  currentScore: selected.currentScore, knownRoundingRange: selected.currentPrecisionRange.scoreInterval, baseFiles: output.frozenInputs },null,2));
