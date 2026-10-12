/** Read-only scoring review. Only creates review deliverables; never changes public rules or observations. */
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { interpolateScore } from "../lib/macro-scoring-continuous.mjs";

const read = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const [framework, current, history] = await Promise.all([
  read("app/data/macro-rating-v1.json"), read("app/data/macro-rating-current.json"), read("app/data/macro-gdp-deflator-history.json"),
]);
const rule = framework.indicators.find((item) => item.id === "E07");
const baseline = [[-3,1],[-1,2],[0,3],[.75,4],[2,5],[3,5],[4,4],[6,2],[8,1]];
assert.deepEqual(rule.scoring.anchors, baseline, "Review requires unchanged V1.16 E07 curve");
const rows = history.rows.filter((row) => row.period >= "2015-Q1" && row.vintage === "2026-09-15-SDDS")
  .map((row) => ({ ...row, value: (row.nominalGdp / row.priorYearNominalGdp / (row.realGdpIndex / 100) - 1) * 100 }))
  .sort((a, b) => a.period.localeCompare(b.period));
assert.equal(rows.length, 46);
const qIndex = (period) => Number(period.slice(0, 4)) * 4 + Number(period.slice(-1));
assert.ok(rows.slice(1).every((row, index) => qIndex(row.period) - qIndex(rows[index].period) === 1));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const round = (value) => Number.isFinite(value) ? Number(value.toFixed(8)) : null;
const percentile = (values, probability) => {
  const sorted = [...values].sort((a, b) => a - b), at = (sorted.length - 1) * probability, i = Math.floor(at);
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (at - i);
};
// Predefined semantic alternatives, not fitted by current score, economic outcomes, or asset returns.
const candidates = [
  { key: "baseline", name: "现版 2%–3% 满分平台", anchors: baseline },
  { key: "upper_taper", name: "保守：不移动 2% 峰值，超过 2% 逐步回落", anchors: [[-3,1],[-1,2],[0,3],[.75,4],[2,5],[3,4.5],[4,3.5],[6,2],[8,1]] },
  { key: "peak_1_to_2", name: "较强：1%–2% 峰区，上端加快降分", anchors: [[-3,1],[-1,2],[0,3],[.75,4],[1,5],[2,5],[3,4],[4,3],[6,2],[8,1]] },
  { key: "peak_1_5_to_2", name: "缓坡：1.5%–2% 峰区，上端加快降分", anchors: [[-3,1],[-1,2],[0,3],[.75,4],[1.5,5],[2,5],[3,4],[4,3],[6,2],[8,1]] },
];
const windows = [
  { name: "2015-Q1—2026-Q2 全样本", filter: () => true },
  { name: "2015—2019 疫情前", filter: (row) => row.period < "2020" },
  { name: "2020—2022 疫情与低基数", filter: (row) => row.period >= "2020" && row.period < "2023" },
  { name: "2023 重启与基数", filter: (row) => row.period >= "2023" && row.period < "2024" },
  { name: "2024-Q1—2026-Q2 近期", filter: (row) => row.period >= "2024" },
];
function diagnostics(anchors, sample) {
  const points = sample.map((row) => interpolateScore(row.value, anchors));
  const deltas = [], reversals = [];
  for (let i = 1; i < sample.length; i++) if (qIndex(sample[i].period) - qIndex(sample[i-1].period) === 1) deltas.push(points[i] - points[i-1]);
  for (let i = 2; i < sample.length; i++) {
    if (qIndex(sample[i].period) - qIndex(sample[i-1].period) !== 1 || qIndex(sample[i-1].period) - qIndex(sample[i-2].period) !== 1) continue;
    const a = points[i-1] - points[i-2], b = points[i] - points[i-1];
    if (a * b < 0 && Math.abs(a) >= .25 && Math.abs(b) >= .25) reversals.push(sample[i].period);
  }
  return {
    n: sample.length, first: sample[0].period, last: sample.at(-1).period,
    meanScore: round(mean(points)), scoreFiveCount: points.filter((point) => point >= 5 - 1e-10).length,
    scoreFourOrHigherCount: points.filter((point) => point >= 4).length,
    meanAbsoluteScoreChange: round(mean(deltas.map(Math.abs))), consecutivePairCount: deltas.length,
    changeOverPointFiveCount: deltas.filter((delta) => Math.abs(delta) > .5).length,
    reversalOverPointTwoFiveCount: reversals.length,
    localSensitivityPlusPointOneMean: round(mean(sample.map((row, i) => Math.abs(interpolateScore(row.value + .1, anchors) - points[i])))),
  };
}
const review = {
  scope: "E07 GDP 平减指数独立分析；未改公开规则、现值、权重、评分记录，未发布。",
  informationCutoff: current.asOf,
  hypothesis: "全经济价格的高分平台可能过宽，可检验温和正增长峰区与高位降分；不将 PPI 的 1%–2% 偏好直接复制为官方 GDP 平减指数目标。",
  baseline: { version: framework.version, ruleId: rule.id, weight: rule.weight, anchors: baseline },
  officialEvidence: [
    { title: "什么是 GDP 缩减指数", sourceUrl: "https://www.stats.gov.cn/zs/tjws/tjzb/202301/t20230101_1903780.html", publisher: "国家统计局", date: "2025-02-28", supportedClaim: "国内所有最终货物和服务产出的总体价格变化，按分行业现价与不变价 GDP 得到；不是直接抽样编制的工业出厂价指数。", access: "官方搜索抓取返回正文，本次直接打开超时；定义另由可直接打开的官方核算司答复交叉核验。" },
    { title: "国家统计局国民经济核算司咨询答复", sourceUrl: "https://www.stats.gov.cn/hd/lyzx/zxgk/202208/t20220801_1886957.html", publisher: "国家统计局国民经济核算司", date: "2022-07-19", supportedClaim: "GDP 缩减指数并不等于 CPI，受到 PPI、服务价格和工资等因素影响；不能从名义增长中直接扣 CPI 得到实际增长。", access: "本次直接打开正文成功。" },
    { title: "2018 年第二季度中国货币政策执行报告", sourceUrl: "https://www.pbc.gov.cn/zhengcehuobisi/125207/125227/125957/3537682/5dad7896c1c945c5be61518cb4a06605/2018081021363898908.pdf", publisher: "中国人民银行货币政策分析小组", date: "2018-08-10", supportedClaim: "摘要称物价基本稳定；正文第 45—46 页报告上半年 GDP 平减指数上涨 3.0%、第二季度上涨 2.9%。只能支持须结合背景判断，不能将 3% 自动定性为恶性通胀；不是官方 3% 理想目标，也不证明当前满分平台合适。", access: "本次直接打开 PDF 正文、封面日期和对应段落成功。" },
    { title: "国家统计局 SDDS GDP 序列", sourceUrl: rows[0].sourceUrl, publisher: "国家统计局", vintage: "2026-09-15-SDDS", supportedClaim: "历史诊断复用工作台先前核验并留存的同版现价单季 GDP、上年同季 GDP 和实际同比指数。", access: "本次直接打开超时，未宣称重新抓取验证成功；本次没有更改原始序列。" },
  ],
  historicalSample: { n: rows.length, first: rows[0].period, last: rows.at(-1).period, vintage: "2026-09-15-SDDS", rawPercentiles: [0,.1,.25,.5,.75,.9,1].map((probability) => ({ probability, value: round(percentile(rows.map((row) => row.value), probability)) })), originalSeries: "app/data/macro-gdp-deflator-history.json", formula: "(current nominal GDP / previous-year same-quarter nominal GDP / (real GDP index / 100) - 1) × 100" },
  candidates: candidates.map((candidate) => ({ ...candidate, windows: windows.map((window) => ({ name: window.name, ...diagnostics(candidate.anchors, rows.filter(window.filter)) })), currentScore: round(interpolateScore(current.observations.E07.value, candidate.anchors)), referenceTable: [-3,-1,0,.75,1,1.5,2,2.5,3,4,5,6,8].map((value) => ({ value, points: round(interpolateScore(value, candidate.anchors)) })) })),
  current: { period: current.observations.E07.period, value: current.observations.E07.value, raw: current.observations.E07.gdpDeflatorEvidence, baselineScore: round(interpolateScore(current.observations.E07.value, baseline)) },
  conclusions: [
    "与 PPI 存在相似的研究峰区问题：现版 2%–3% 满分、4% 仍为 4 分，并非官方合理通胀目标，也未经过经济状态或资产表现验证。值得提出修订候选。",
    "不可直接复制 PPI：GDP 平减指数覆盖全经济最终产出价格，正的名义价格修复可能帮助名义收入和债务承载；但无法仅由同比数值识别需求修复、结构权重变化与成本冲击。",
    "建议首先把 2%–3% 平台改为超过 2% 缓慢回落的保守上端方案列入待确认，保留 0%=3、-1%=2 等负值分支。此方案针对高分平台，不连带重设中性点。",
    "保守候选把满分从区间改成单个峰点，本样本无精确 2% 因而无精确 5 分；这不是坏样本或证明修订更优，若需要宽峰应另行设计连续过渡而不是追求更多满分。",
    "1%–2% 峰区并非已证实最优；保留 0.75%=4 后，1%=5 将造成该段每 0.1 个百分点变 0.4 分，比现版明显更陡。需避免为了缩窄峰区引入新的局部灵敏度悬崖。",
    "本期约 1.5266% 在保守上端方案中仍是约 4.62 分；在 1%–2% 或 1.5%–2% 峰区方案中为 5 分。分数上升也只是方法改变，不表示经济当天改善。",
  ],
  limitations: [
    "46 个季度为同一现存修订版本，非每期当时发布值的 point-in-time 回放；2020—2022、2023、2024 起阶段分别完整报告，没有删除疫情或极值。",
    "相邻评分跳变和反转只反映曲线统计行为，不是经济误报率，未用独立宏观事件标签或资产收益检验。",
    "GDP 平减指数没有在本次官方材料中找到统一的 1%–2% 理想目标；研究候选数字不得冒称官方红线或良好状态阈值。",
    "更高分、较低跳变或历史均值均不作为候选优胜的充分依据；诊断并不能确定哪个峰区科学最优。",
    "同比值受基数和分行业权重影响，不能把某次 3% 或 4% 自动称恶性通胀，也不能由正数直接推出盈利改善。",
  ],
  historicalRows: rows.map((row) => ({ ...row, scores: Object.fromEntries(candidates.map((candidate) => [candidate.key, round(interpolateScore(row.value, candidate.anchors))])) })),
};
assert.deepEqual(rule.scoring.anchors, baseline);
const jsonPath = new URL("../deliverables/macro-v1-17-deflator-review.json", import.meta.url);
const mdPath = new URL("../deliverables/macro-v1-17-deflator-review.md", import.meta.url);
const table = review.candidates.map((candidate) => {
  const all = candidate.windows[0], recent = candidate.windows.at(-1);
  return `| ${candidate.name} | ${all.n} | ${all.scoreFiveCount} | ${all.meanAbsoluteScoreChange} | ${all.changeOverPointFiveCount} | ${all.reversalOverPointTwoFiveCount} | ${recent.meanAbsoluteScoreChange} | ${candidate.currentScore} |`;
}).join("\n");
const markdown = `# GDP 平减指数高分区独立复核\n\n${review.scope}\n\n## 结论\n\n${review.conclusions.map((line) => `- ${line}`).join("\n")}\n\n## 同样本候选比较\n\n完整 46 季度，2015 年一季度至 2026 年二季度，同版原值复算；全部候选事先固定，未寻找能让当前总分高或低的参数。\n\n| 候选 | 全样本数 | 满分期数 | 相邻绝对变分均值 | 超过 0.5 分变化 | 超过 0.25 分反转 | 2024 年起变分均值 | 本期得分 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${table}\n\n跳变与反转不是经济误报。原始分期结果和所有可复算原值见同名 JSON。\n\n## 官方口径依据\n\n${review.officialEvidence.map((source) => `- [${source.title}](${source.sourceUrl})：${source.supportedClaim} ${source.access}`).join("\n")}\n\n## 验证限制\n\n${review.limitations.map((line) => `- ${line}`).join("\n")}\n`;
await Promise.all([writeFile(jsonPath, `${JSON.stringify(review, null, 2)}\n`), writeFile(mdPath, markdown)]);
console.log(JSON.stringify({ scope: review.scope, historicalSample: review.historicalSample, candidates: review.candidates.map(({ key, windows, currentScore }) => ({ key, all: windows[0], recent: windows.at(-1), currentScore })) }, null, 2));
