import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { interpolateScore } from '../lib/macro-scoring-continuous.mjs';

// Read-only calibration. Outputs JSON to stdout; never changes app/data.
const run = promisify(execFile);
const frameworkArchive = 'deliverables/macro-rating-framework-before-v1-16-2026-10-11.json';
const currentArchive = 'deliverables/macro-rating-current-before-v1-16-2026-10-11.json';
const frameworkInput = fs.existsSync(frameworkArchive) ? frameworkArchive : 'app/data/macro-rating-v1.json';
const currentInput = fs.existsSync(currentArchive) ? currentArchive : 'app/data/macro-rating-current.json';
const framework = JSON.parse(fs.readFileSync(frameworkInput, 'utf8'));
const current = JSON.parse(fs.readFileSync(currentInput, 'utf8'));
assert.equal(framework.version, 'V1.15', '政策校准只允许V1.15基线；迁移后必须提供迁移前framework备份，不能把V1.16当作旧版。');
assert.equal(current.version, 'V1.15', '政策校准只允许V1.15当期基线；迁移后必须提供迁移前current备份。');
assert.equal(current.asOf, '2026-10-11', '本任务信息截止日固定为2026-10-11。');
const baseline = { frameworkInput, currentInput, version: framework.version, asOf: current.asOf };
if (process.argv.includes('--baseline-check-only')) {
  console.log(JSON.stringify(baseline));
  process.exit(0);
}
const cutoff = current.asOf;
const baseIndex = 'https://www.mof.gov.cn/zhengwuxinxi/redianzhuanti/quanguocaizhengshouzhiqingkuang/';
const failures = [];

async function fetchPage(url) {
  const { stdout } = await run('curl', ['-fLsS', '--max-time', '18', '--retry', '1', url], { maxBuffer: 5 * 1024 * 1024 });
  return stdout;
}
async function parallelMap(values, worker, concurrency = 6) {
  const output = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const i = next++;
      output[i] = await worker(values[i]);
    }
  }));
  return output;
}
function periodFromTitle(title) {
  const year = title.match(/(20\d\d)年/)?.[1];
  if (!year) return null;
  let month;
  if (/上半年/.test(title)) month = 6;
  else if (/前三季度/.test(title)) month = 9;
  else if (/一季度/.test(title)) month = 3;
  else month = Number(title.match(/(?:1[-—至])?(\d{1,2})月/)?.[1] ?? 12);
  return `${year}-${String(month).padStart(2, '0')}`;
}
function reportedSeries(text, label) {
  const match = text.match(new RegExp(`全国${label}([\\d,，]+(?:\\.\\d+)?)亿元[，,](?:比上年(?:同期)?|同比)(增长|下降)(\\d+(?:\\.\\d+)?)%`));
  if (!match) return null;
  return { amount: Number(match[1].replace(/[,，]/g, '')), value: Number(match[3]) * (match[2] === '下降' ? -1 : 1) };
}

const savedCollection = process.argv.includes('--offline') ? JSON.parse(fs.readFileSync('deliverables/macro-v1-16-policy-calibration.json', 'utf8')) : null;
if (savedCollection) {
  assert.equal(savedCollection.originalVersion, 'V1.15', '离线归档必须来自V1.15基线。');
  assert.equal(savedCollection.asOf, cutoff, '离线样本与基线信息截止日必须一致。');
}
const indexes = savedCollection ? savedCollection.officialHistoricalCollection.indexUrls.map(url => ({ url, html: '' })) : await parallelMap([0, 1, 2, 3], async page => {
  const url = `${baseIndex}${page ? `index_${page}.html` : ''}`;
  try { return { url, html: await fetchPage(url) }; }
  catch (error) { failures.push({ url, stage: 'official-index', error: String(error.message).slice(0, 240) }); return { url, html: '' }; }
});
const entries = [];
for (const { url: indexUrl, html } of indexes) {
  for (const match of html.matchAll(/<li><a href="([^"]+)">([^<]*财政收支情况)<\/a><span>(\d{4}-\d{2}-\d{2})<\/span><\/li>/g)) {
    const period = periodFromTitle(match[2]);
    if (!period || period < '2020-02' || period > '2026-08' || match[3] > cutoff) continue;
    entries.push({ period, title: match[2], releaseDate: match[3], sourceUrl: match[1].replace(/^http:/, 'https:'), indexUrl });
  }
}
const fiscalRaw = savedCollection ? savedCollection.rawdata.fiscal : (await parallelMap(entries, async entry => {
  try {
    const html = await fetchPage(entry.sourceUrl);
    const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, '').replace(/\s/g, '');
    const general = reportedSeries(text, '一般公共预算支出');
    const fund = reportedSeries(text, '政府性基金预算支出');
    if (!general && !fund) failures.push({ ...entry, stage: 'parse-official-published-yoy', error: '未找到全国支出金额及官方同比，不以金额相除补算。' });
    const publishedMeta = html.match(/<meta name="PubDate" content="(\d{4}-\d{2}-\d{2})/)?.[1];
    if ((publishedMeta ?? entry.releaseDate) > cutoff) { failures.push({ ...entry, stage: 'release-after-cutoff', error: '原文发布日期晚于本期截止，拒绝使用。' }); return null; }
    return { ...entry, releaseDate: publishedMeta ?? entry.releaseDate, general, fund, basis: '全国年初累计支出官方可比同比', unit: '%', originalPublisher: '财政部' };
  } catch (error) {
    failures.push({ ...entry, stage: 'official-release-access', error: String(error.message).slice(0, 240) });
    return null;
  }
})).filter(Boolean).sort((a, b) => a.period.localeCompare(b.period));

const policies = framework.indicators.filter(r => r.pillar === '宏观调控');
const candidateAnchors = {
  P01E: [ [[-5, 1], [1, 2], [3, 3], [6, 4], [12, 5]], [[-5, 1], [2, 2], [3, 3], [4, 4], [12, 5]] ],
  P01F: [ [[-25, 1], [-7.5, 2], [0, 3], [7.5, 4], [25, 5]], [[-25, 1], [-5, 2], [0, 3], [5, 4], [25, 5]] ],
  P02A: [ [[-50, 5], [-20, 4], [0, 3], [20, 2], [50, 1]], [[-50, 5], [-10, 4], [0, 3], [10, 2], [50, 1]] ],
  P02E: [ [[-100, 5], [-40, 4], [0, 3], [40, 2], [100, 1]], [[-100, 5], [-25, 4], [0, 3], [25, 2], [100, 1]] ],
  P02D: [ [[-50, 5], [-20, 4], [0, 3], [20, 2], [50, 1]], [[-50, 5], [-10, 4], [0, 3], [10, 2], [50, 1]] ],
};
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const median = values => { const sorted = values.slice().sort((a, b) => a - b); return sorted.length ? sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : null; };
function diagnostics(rows, anchors) {
  const scores = rows.map(r => ({ period: r.period, value: r.value, score: interpolateScore(r.value, anchors) }));
  const adjacentSteps = [];
  for (let i = 1; i < scores.length; i++) {
    // Do not mistake January's annual cumulative reset for a monthly change.
    if (scores[i].period.slice(0, 4) !== scores[i - 1].period.slice(0, 4)) continue;
    if (Number(scores[i].period.slice(5)) !== Number(scores[i - 1].period.slice(5)) + 1) continue;
    adjacentSteps.push({ period: scores[i].period, step: scores[i].score - scores[i - 1].score });
  }
  const years = [...new Set(rows.map(r => r.period.slice(0, 4)))];
  return {
    n: scores.length,
    first: scores[0]?.period ?? null,
    last: scores.at(-1)?.period ?? null,
    minimumValue: rows.length ? Math.min(...rows.map(r => r.value)) : null,
    maximumValue: rows.length ? Math.max(...rows.map(r => r.value)) : null,
    meanScore: mean(scores.map(r => r.score)),
    floorCount: scores.filter(r => r.score <= 1).length,
    ceilingCount: scores.filter(r => r.score >= 5).length,
    adjacentWithinYearCount: adjacentSteps.length,
    medianAbsoluteWithinYearScoreChange: median(adjacentSteps.map(r => Math.abs(r.step))),
    meanAbsoluteWithinYearScoreChange: mean(adjacentSteps.map(r => Math.abs(r.step))),
    halfPointWithinYearJumpCount: adjacentSteps.filter(r => Math.abs(r.step) >= 0.5).length,
    yearMeans: years.map(year => ({ year, n: scores.filter(r => r.period.startsWith(year)).length, mean: mean(scores.filter(r => r.period.startsWith(year)).map(r => r.score)) })),
    scores,
    interpretation: '均值、端点饱和及同年连续累计期的分数变化只是尺度诊断；不是经济误报率、政策效果因果识别或资产收益回测。累计月份相互相关，不能把n视为n个独立样本。',
  };
}
const rules = policies.map(rule => {
  const observation = current.observations[rule.id];
  const quant = candidateAnchors[rule.id];
  const officialRows = rule.id === 'P01E' || rule.id === 'P01F'
    ? fiscalRaw.filter(r => (rule.id === 'P01E' ? r.general : r.fund)).map(r => ({ period: r.period, value: (rule.id === 'P01E' ? r.general : r.fund).value, sourceUrl: r.sourceUrl, releaseDate: r.releaseDate }))
    : [{ period: observation.period, value: observation.value, sourceUrl: observation.sourceUrl, releaseDate: observation.releaseDate }];
  const candidateSets = quant ? [rule.scoring.anchors, ...quant] : [];
  const candidates = candidateSets.map((anchors, i) => ({ name: ['现版', '适度收窄', '明显收窄'][i], anchors, currentScore: interpolateScore(observation.value, anchors), diagnostics: diagnostics(officialRows, anchors) }));
  let definition = rule.definition;
  // Correct obsolete integer-band descriptions without altering definitions or live values.
  if (rule.id === 'P01E') definition = definition.replace('[-5,0,3,7]仅为待长样本校准的研究试行边界', '现行连续锚点为-5%、0%、3%、7%、12%对应1—5分，属于研究试行，长样本诊断不等于最优或样本外验证');
  if (rule.id === 'P01F') definition = definition.replace('[-5,0,3,7]仅为待长样本校准的研究试行边界', '现行连续锚点为-25%、-10%、0%、10%、25%对应1—5分，属于研究试行，长样本诊断不等于最优或样本外验证');
  if (rule.id === 'P02A') definition = definition.replace('±5和±25基点为适应政策步长的研究试行分界', '连续锚点为-50、-25、0、25、50基点对应5、4、3、2、1分，属于研究试行尺度');
  if (rule.id === 'P02E') definition = definition.replace('±25及±100基点边界沿用研究试行值', '连续锚点为-100、-50、0、50、100基点对应5、4、3、2、1分，属于研究试行尺度');
  if (rule.id === 'P02D') definition = definition.replace('±20和±50基点仍是待回测试行边界', '连续锚点为-50、-25、0、25、50基点对应5、4、3、2、1分，属于研究试行尺度');
  const genericLimitations = [
    '本轮不改变指标、权重、统计口径、信息截止日或原始观察。',
    '未建立逐期实时版本和独立经济事件真值标签，不能报告误报率、预测最优参数或因果政策效果。',
  ];
  const specific = {
    P01E: '一般公共预算有多年度官方累计同比可作尺度诊断，但年度支出结构、基数、预算及累计自相关影响明显。保留3%中心及既有尺度，先报告候选收窄使同年短期分数变动放大的程度，不把名义支出映射为净财政冲量。',
    P01F: '政府性基金预算受土地、特别国债及专项债用途变化影响，历史波动较大；零锚点应保留方向意义。收窄常态区间不能改变预算组成及原发布可比说明，须防负增长时期相对改善被误当强刺激。',
    P02A: '公开样本只支持当前0基点；历史LPR和DR007不可充当7天逆回购政策利率。稀疏动作的时间退出属于6个月窗口定义，不通过收窄或延长窗口重复奖励旧降息。',
    P02E: '12期原表账本核验的是当前窗口无普遍动作，不是12个独立RRR变动样本。维持0基点3分，保持定向、外币、机构个别调整排除及公告去重；不延长窗口或把亿元工具金额当基点。',
    P02D: '企业贷款利率仅有两期同口径季末月原值用于当前同比，没有可核验长历史变化序列；不得以LPR、一般贷款或平均全部贷款替换。保留当前尺度，不因-18基点这一点收窄到高分。',
    P03A: '供给治理是有效规则与实施证据，不可用小数评分伪装更高精度。现证据范围是钢铁，不能外推全经济；支持条件4分不等于价格上涨或产能退出已经兑现。',
    P03B: '产业支持以工具、责任、资源渠道、时间和受益范围为依据。消费品执行不能替代设备更新全部范围，拨付、预算记支、兑付、开工分开记录；未公开不是未执行。',
    P04A: '法律持续有效且实施责任明确可保持4分，不因本月无新文件自动回3。5分须与预先固定主要范围匹配的救济、配套执行或壁垒清理，不用宣传培训代替。',
    P04B: '长期资金与回报制度继续整数档。股票市值增长、文件数量或累计净买入不能替代各类机构考核和回报治理的完整执行；持续有效制度按季度复核而非机械衰减。',
  };
  return {
    id: rule.id, name: rule.name, weight: rule.weight, scoring: rule.scoring,
    decision: '保留', reason: specific[rule.id], definition,
    sampleSummary: quant ? { source: rule.id.startsWith('P01') ? '财政部历史原始月报' : '本期结构化原始证据', observedChangeCount: officialRows.length, period: [officialRows[0]?.period, officialRows.at(-1)?.period], officialOnly: true, sufficientForOptimalSelection: false } : { historicalIndependentReviewCount: 1, period: observation.period, officialOnly: true, sufficientForNumericInterpolation: false },
    candidates,
    currentScore: quant ? interpolateScore(observation.value, rule.scoring.anchors) : observation.value,
    sampleEvidence: quant ? officialRows : observation.policyReview.evidence,
    evidenceAudit: quant ? undefined : { reviewedAt: observation.policyReview.reviewDate, coverageAssessment: observation.policyReview.coverageAssessment, completeImplementationDimensions: observation.policyReview.implementationChecks.map(r => r.dimension), evidenceIds: observation.policyReview.evidence.map(r => r.eventId), declaredWholeEconomyClaim: observation.policyReview.coverageAssessment.wholeEconomyClaim, executionMatchesScope: observation.policyReview.coverageAssessment.executionMatchesScope, currentFiveScoreEligible: observation.policyReview.coverageAssessment.unverifiedAreas.length === 0 && observation.policyReview.coverageAssessment.executionMatchesScope === true, recommendation: '保留整数五档及现4分；5分继续拒绝范围未核齐，负面反证和撤销也需记录，不因资料缺失默认3分。' },
    limitations: [...genericLimitations, ...(rule.id.startsWith('P01') ? ['历史累计期不独立，疫情/低基数、2015之后预算构成及跨预算转移会改变名义同比含义；本次原始月报抓取值为当前存档网页版本，不冒充当年未修订实时快照。'] : quant ? ['当前事实核验充足不等于尺度校准样本充足，本轮未构造或替代缺失的同口径长历史。'] : ['定性证据没有可靠同一标注者长历史，不能编造五档误报率或置信区间。'])],
  };
});
const collection = savedCollection?.officialHistoricalCollection ?? { indexUrls: indexes.map(r => r.url), attempted: entries.length, parsed: fiscalRaw.length, missingOrFailed: failures, providerFallback: '本轮采用可访问的官方原表；失败点保留缺口，未使用Wind/Caixin或金额推算补值。' };
const result = { version: 'V1.16', role: '宏观调控尺度校准', asOf: cutoff, originalVersion: framework.version, baseline, sourceOrder: ['官方原始发布', 'Wind', '财新数据 API'], officialHistoricalCollection: collection, rules, rawdata: { fiscal: fiscalRaw }, diagnosticsDefinition: '历史分布、端点饱和及同年连续累计期变化是尺度诊断，不是有独立真值的误报率或预测回测；未用本期总分决定候选。', recommendation: '九项评分方法和权重保持；清理五处definition旧档位残留。财政多年度诊断与三组候选保留作审查，不以更敏感就必然更准确；货币长历史不足保持现版；四项证据整数框架保留。' };
const output = process.argv[process.argv.indexOf('--output') + 1];
if (process.argv.includes('--output')) {
  if (!output?.startsWith('deliverables/macro-v1-16-policy-') || !output.endsWith('.json')) throw new Error('只允许生成本任务专属deliverables JSON');
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, attempted: collection.attempted, parsed: fiscalRaw.length, failureCount: collection.missingOrFailed.length, rules: rules.map(r => ({ id: r.id, sample: r.sampleSummary, candidates: r.candidates.map(c => ({ name: c.name, currentScore: c.currentScore, meanScore: c.diagnostics.meanScore, floor: c.diagnostics.floorCount, ceiling: c.diagnostics.ceilingCount, meanStep: c.diagnostics.meanAbsoluteWithinYearScoreChange, halfPointJumps: c.diagnostics.halfPointWithinYearJumpCount })) })) }, null, 2));
} else console.log(JSON.stringify(result, null, 2));
