/** Current-vintage scale diagnostics only: no economic error labels, PIT claims or asset-return optimization. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { interpolateScore } from '../lib/macro-scoring-continuous.mjs';
import { scoreLeverageMatrix } from '../lib/macro-leverage-scoring.mjs';

const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const frameworkBackup = 'deliverables/macro-rating-framework-before-v1-16-2026-10-11.json';
const currentBackup = 'deliverables/macro-rating-current-before-v1-16-2026-10-11.json';
const frameworkInputPath = fs.existsSync(frameworkBackup) ? frameworkBackup : 'app/data/macro-rating-v1.json';
const currentInputPath = fs.existsSync(currentBackup) ? currentBackup : 'app/data/macro-rating-current.json';
const framework = read(frameworkInputPath);
const current = read(currentInputPath);
if (framework.version !== 'V1.15' || current.version !== 'V1.15') throw new Error('Calibration requires frozen V1.15 baseline; refusing to reuse integrated V1.16 as baseline.');
const loans = read('app/data/macro-finance-credit.json');
const money = read('app/data/macro-money-supply.json');
const evidence = read('deliverables/macro-v1-15-credit-evidence.json');
const clone = (x) => structuredClone(x);
const round = (x) => x == null ? null : Math.round(x * 1e8) / 1e8;
const month = (p) => +p.slice(0, 4) * 12 + +p.slice(5);
const period = (n) => `${Math.floor((n - 1) / 12)}-${String((n - 1) % 12 + 1).padStart(2, '0')}`;
const shift = (p, n) => period(month(p) + n);
const isOfficial = (url) => { try { return new URL(url).hostname.endsWith('.pbc.gov.cn'); } catch { return false; } };
const WINDOW = { start: '2024-04', end: '2026-08', expectedMonths: 29 };
const files = [
  [2023, 'https://www.pbc.gov.cn/diaochatongjisi/attachDir/2025/11/2025110416000696359.htm'],
  [2024, 'https://www.pbc.gov.cn/diaochatongjisi/attachDir/2025/11/2025111416272086731.htm'],
  [2025, 'https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/02/2026021416101539242.htm'],
  [2026, 'https://www.pbc.gov.cn/diaochatongjisi/attachDir/2026/09/2026091417325051118.htm'],
];
const cachePath = 'deliverables/macro-v1-16-credit-stock-originals.json';
let fetched;
if (fs.existsSync(cachePath) && !process.argv.includes('--refresh-official')) fetched = read(cachePath);
else {
  fetched = { asOf: current.asOf, description: '央行原始年度存量表；保存当前原表版次，不代表历史首次发布版本', tables: [] };
  for (const [year, url] of files) {
    const raw = execFileSync('curl', ['-L', '--fail', '--max-time', '30', '--retry', '1', '-s', url]);
    const html = new TextDecoder(/charset\s*=\s*gb/i.test(raw.toString('ascii').slice(0, 1000)) ? 'gb18030' : 'utf8').decode(raw);
    const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) => [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => td[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()));
    const periods = rows.find((r) => r.some((cell) => new RegExp(`^${year}\\.1$`).test(cell)))?.filter((x) => new RegExp(`^${year}\\.\\d+$`).test(x));
    const total = rows.find((r) => /^社会融资规模存量/.test(r[0]) && /AFRE/i.test(r[0]));
    const gov = rows.find((r) => /^政府债券/.test(r[0]));
    if (!periods || !total || !gov) throw new Error('Annual stock table has no identifiable original rows: ' + year);
    const values = periods.map((p, i) => ({ period: `${year}-${String(p.split('.')[1]).padStart(2, '0')}`, totalStock: Number(total[1 + i * 2]), governmentBondStock: Number(gov[1 + i * 2]), sourceUrl: url }))
      .filter((r, i) => total[1 + i * 2] !== '' && gov[1 + i * 2] !== '' && Number.isFinite(r.totalStock) && Number.isFinite(r.governmentBondStock));
    const pathDate = /attachDir\/\d{4}\/\d{2}\/(\d{4})(\d{2})(\d{2})/.exec(url);
    fetched.tables.push({ year, sourceUrl: url, originalPublisher: '中国人民银行', attachmentVersionDate: pathDate ? `${pathDate[1]}-${pathDate[2]}-${pathDate[3]}` : null, attachmentVersionDateBasis: '官方附件日期路径；不是原统计期首次发布日期', sha256: crypto.createHash('sha256').update(raw).digest('hex'), rawHtml: html, extractedPeriods: periods, extractedTotalCells: total, extractedGovernmentCells: gov, values });
  }
  fs.writeFileSync(cachePath, JSON.stringify(fetched, null, 2) + '\n');
}
const stock = new Map(fetched.tables.flatMap((t) => t.values).map((x) => [x.period, x]));
const growth = new Map();
for (const [p, r] of stock) {
  const past = stock.get(shift(p, -12));
  if (past && r.totalStock > r.governmentBondStock && past.totalStock > past.governmentBondStock) growth.set(p, { period: p, value: (r.totalStock - r.governmentBondStock) / (past.totalStock - past.governmentBondStock) * 100 - 100, inputs: [past, r] });
}
const histories = {};
for (const [id, field] of [['F01', 'householdLong'], ['F02', 'enterpriseLong']]) {
  const byMonth = new Map(loans.rows.map((r) => [r.period, r]));
  histories[id] = loans.rows.flatMap((row) => {
    const recent = [-2, -1, 0].map((n) => byMonth.get(shift(row.period, n)));
    const past = [-14, -13, -12].map((n) => byMonth.get(shift(row.period, n)));
    const inputs = [...past, ...recent];
    if (inputs.some((r) => !r || !Number.isFinite(r[field]) || !isOfficial(r.url))) return [];
    return [{ period: row.period, value: recent.reduce((s, r) => s + r[field], 0) - past.reduce((s, r) => s + r[field], 0), inputs: inputs.map((r) => ({ period: r.period, value: r[field], sourceUrl: r.url, reportedBasis: r.reportedBasis })) }];
  });
}
histories.F07 = [...growth.values()];
histories.F08 = [...growth.values()].flatMap((r) => growth.has(shift(r.period, -3)) ? [{ period: r.period, value: r.value - growth.get(shift(r.period, -3)).value, inputs: [growth.get(shift(r.period, -3)), r] }] : []);
histories.F05 = money.rows.filter((r) => r.period >= '2024-01' && ['revised', 'revised-2024'].includes(r.m1Basis) && Number.isFinite(r.m1) && Number.isFinite(r.m2) && isOfficial(r.sourceUrl)).map((r) => ({ period: r.period, value: round(r.m1 - r.m2), m1: r.m1, m2: r.m2, m1Basis: r.m1Basis, sourceUrl: r.sourceUrl }));
const scoped = (rows, start = WINDOW.start, end = WINDOW.end) => rows.filter((r) => r.period >= start && r.period <= end).sort((a, b) => a.period.localeCompare(b.period));
const rawDiagnostics = (rows, anchors) => {
  const pairs = rows.map((r) => ({ period: r.period, value: round(r.value), score: round(interpolateScore(r.value, anchors)) }));
  const deltas = pairs.slice(1).flatMap((r, i) => month(r.period) - month(pairs[i].period) === 1 ? [{ period: r.period, change: r.score - pairs[i].score }] : []);
  const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const signs = deltas.map((d) => Math.abs(d.change) < .01 ? 0 : Math.sign(d.change));
  const flips = signs.slice(1).filter((s, i) => s * signs[i] === -1).length;
  return {
    n: pairs.length, start: pairs[0]?.period, end: pairs.at(-1)?.period,
    min: round(Math.min(...pairs.map((p) => p.score))), max: round(Math.max(...pairs.map((p) => p.score))),
    middleShare: round(pairs.filter((p) => p.score > 2 && p.score < 4).length / pairs.length),
    tailCount: pairs.filter((p) => p.score === 1 || p.score === 5).length,
    tailShare: round(pairs.filter((p) => p.score === 1 || p.score === 5).length / pairs.length),
    meanAbsoluteMonthChange: round(mean(deltas.map((d) => Math.abs(d.change)))),
    nearFlatChanges: deltas.filter((d) => Math.abs(d.change) < .01).length,
    changesAtLeastHalfPoint: deltas.filter((d) => Math.abs(d.change) >= .5).length,
    consecutiveSignReversals: flips, consecutiveDeltaCount: deltas.length,
    limitation: '相邻得分反转与跳动是机械诊断，不是经济误报；滑动三个月序列相邻观测不独立。',
    pairs,
  };
};
const quantitative = framework.indicators.filter((r) => r.id.startsWith('F') && r.scoring?.method === 'piecewise-linear');
const loanIds = new Set(['F01', 'F02']);
const narrower = (id, anchors, factor) => anchors.map(([x, s], i) => {
  if (i === 0 || i === anchors.length - 1) return [x, s];
  if (id === 'F05') return [round(x <= 0 ? x * factor : x <= 3 ? x : 3 + (x - 3) * factor), s];
  const center = id === 'F07' ? 6 : 0;
  return [round(center + (x - center) * factor), s];
});
const selections = { F01: 'moderate', F02: 'moderate', F07: 'moderate', F08: 'baseline', F05: 'baseline' };
const reasons = {
  F01: '零多增仍为3分，2/4分内节点由±3000收至±2250亿元，1/5分外端仍±6000。29月中间变化更清晰而尾部饱和不增加；固定金额及累计舍入局限仍存在，不将该尺度永久外推。',
  F02: '与居民不能同一金额尺度；2/4分内节点由±5000收至±3750亿元，1/5分外端仍±10000。扩大常态响应，但保留大波动的尾部空间；企事业单位不等于上市公司或私人资本开支。',
  F07: '原4—8%内段每2个百分点只变1分；适度方案收至4.5—7.5%，保留6%=3分、2/10%=1/5分。6%中心本身仍是试行，不因样本偏弱或本期5.5%而重置中心，不把高信用增长等同低风险。',
  F08: '现版中心±0.3个百分点已对应2/4分，每0.1个百分点约变0.33分；机械收窄25%/50%会把同源三个月变化噪声进一步放大，没有新增经济事件标签或修订样本支持必要性，因此本轮保留。',
  F05: '新M1仅32个月回溯可比序列，正侧没有足够样本；相对指数差不是直接资本效率或偿债能力。窄化会放大新口径和月度波动，并重新隐含未经证实的最佳区间。本轮保留非单调曲线，不借单侧32个月把全周期最优带重新拟合。',
};
const rules = quantitative.map((r) => {
  const rows = scoped(histories[r.id]);
  const candidates = [['baseline', '现版', r.scoring.anchors], ['moderate', '常态内节点收窄25%、外端不变', narrower(r.id, r.scoring.anchors, .75)], ['strong', '常态内节点收窄50%、外端不变', narrower(r.id, r.scoring.anchors, .5)]].map(([key, label, anchors]) => ({ key, label, scoring: { ...clone(r.scoring), anchors }, diagnostics: rawDiagnostics(rows, anchors), annualDiagnostics: Object.fromEntries(['2024', '2025', '2026'].map((year) => [year, rawDiagnostics(rows.filter((x) => x.period.startsWith(year)), anchors)])), currentScore: round(interpolateScore(current.observations[r.id].value, anchors)) }));
  for (const candidate of candidates) {
    candidate.centralSensitivity = r.id === 'F05'
      ? { slopes: candidate.scoring.anchors.slice(1).map(([x,s],i)=>({ lower: candidate.scoring.anchors[i][0], upper:x, scoreChangePerUnit:round((s-candidate.scoring.anchors[i][1])/(x-candidate.scoring.anchors[i][0])) })), nonMonotonic: true }
      : { neutralValue: r.id === 'F07' ? 6 : 0, neutralScore: 3, scoreChangePerUnitNearNeutral: round(1/(candidate.scoring.anchors[3][0]-candidate.scoring.anchors[2][0])), illustrativeRawChange: loanIds.has(r.id)?100:.1, illustrativeScoreChangeNearNeutral:round((loanIds.has(r.id)?100:.1)/(candidate.scoring.anchors[3][0]-candidate.scoring.anchors[2][0])) };
  }
  const selected = candidates.find((c) => c.key === selections[r.id]);
  const limitations = ['仅为当前修订数据的评分尺度敏感性检验；不是当时可得数据/PIT、样本外经济预测或跨资产收益回测。', '三套方案预先固定比较，选取解释性和尺度稳定性，不按当前总分高低或收益拟合。'];
  if (loanIds.has(r.id)) limitations.push('当月值含同年累计差分；新增流量同比多增，不是余额同比。3个月重叠引入自相关，金额尺度随金融深化变化。', `本期已知原值舍入误差界约±${r.id === 'F01' ? 51.5 : 200}亿元，应显示得分误差区间。`);
  if (['F07', 'F08'].includes(r.id)) limitations.push('采用央行2023—2026年度原表当前附件修订值；2025附件2026年2月才可得，严禁用于伪装2025实时判断。', '跨年度原表为当前各年度附件；本次未重建全部统计修订/债务置换的历史可比金额，不把派生历史同比称央行独立公布的可比指数。', '剔除政府债仍含国企、平台和股权等，不是纯私人信用；政府债置换可机械影响剩余存量。');
  if (r.id === 'F05') limitations.push('2024年回溯M1和2025年后新M1可比；不连接2023旧M1。最佳带与正侧风险未被32个月单侧样本验证。');
  const currentError = loanIds.has(r.id) ? (r.id === 'F01' ? 51.5 : 200) : r.id === 'F05' ? .1 : null;
  return { id: r.id, name: r.name, weight: r.weight, scoring: { ...selected.scoring, description: `${reasons[r.id]} 当前修订样本的解释性校准，非回测最优；只插值得分，不插值数据。` }, decision: selections[r.id] === 'baseline' ? '保留' : '调整', reason: reasons[r.id], sampleSummary: { ...WINDOW, n: rows.length, missingMonths: Array.from({length: WINDOW.expectedMonths}, (_, i) => shift(WINDOW.start, i)).filter((p) => !rows.some((r) => r.period === p)), fullAvailableStart: histories[r.id][0]?.period, fullAvailableEnd: histories[r.id].at(-1)?.period, fullAvailableN: histories[r.id].length, selected: selections[r.id] }, limitations, candidates, current: { period: current.observations[r.id].period, value: current.observations[r.id].value, oldScore: candidates[0].currentScore, recommendedScore: selected.currentScore, rawErrorBound: currentError, recommendedScoreIntervalFromKnownPrecision: currentError == null ? null : [round(interpolateScore(current.observations[r.id].value - currentError, selected.scoring.anchors)), round(interpolateScore(current.observations[r.id].value + currentError, selected.scoring.anchors))].sort((a,b) => a-b) }, definitionCorrection: r.id === 'F07' ? '剔除政府债后剩余社融存量同比；不是私人信贷增速。连续节点：2→1、4.5→2、6→3、7.5→4、10→5；节点之间线性插值。' : loanIds.has(r.id) ? `近3月当月新增额与上年对应3月合计之差，亿元；不是同比百分比。连续节点：${selected.scoring.anchors.map(([x,s])=>`${x}→${s}`).join('、')}；保留累计差分舍入界。` : null };
});
for (const id of ['F09', 'F10']) {
  const r = framework.indicators.find((r) => r.id === id), observation = current.observations[id], matrix = observation.scoringMatrix;
  const result = scoreLeverageMatrix(r, observation, current.asOf);
  if (result !== 2.5) throw new Error('Existing leverage evidence matrix could not be reproduced for ' + id);
  const sorted = matrix.international.peers.map((p) => p.value).sort((a,b) => a-b);
  const percentile = 100 * (sorted.filter((x)=>x<matrix.international.china.value).length + .5*sorted.filter((x)=>x===matrix.international.china.value).length) / sorted.length;
  rules.push({ id, name: r.name, weight: r.weight, scoring: clone(r.scoring), decision: '保留', reason: '现版已是半分证据矩阵，不存在原值锚点过宽问题；2.5分由新兴相对高负担、国内压力和正收入/盈利缓冲共同决定，不以同季国际排名机械给低分，不为提高灵敏度捏造偿债数据。', sampleSummary: { domesticPeriod: matrix.domestic.period, internationalPeriod: matrix.international.period, peerCount: sorted.length, peerMedian: sorted[7], recomputedPercentile: round(percentile), currentValue: observation.leverageRatio, sameQuarterBisChina: matrix.international.china.value, engineScore: result, matchedState: matrix.matchedState, historicalMatrixN: 1, notHistoricalNumericBacktest: true }, limitations: ['国家资产负债表研究中心本国值与BIS国际值不可混排；BIS最新同表仅2026-Q1，国内2026-Q2单独展示。', 'BIS中国实际DSR仅私人非金融整体，居民/企业拆分缺失；新贷利率和工业子集仅代理，不等于同部门全部存量偿债。', '2.5半分矩阵可复算不等于门槛经跨周期历史验证；各证据组不完整时仍为空，不自动3分。', '新兴样本只描述相对负担，不是统一安全/危机线；收入差距不允许虚构更高的实际宏观杠杆率。'], candidates: [{ key: 'baseline', scoring: clone(r.scoring), currentScore: result }, { key: 'quantitative-narrowing', applicable: false, reason: '证据矩阵没有连续原值锚点，不能套用25%/50%收窄。' }], evidenceReview: { international: clone(matrix.international), domestic: clone(matrix.domestic), support: clone(matrix.counterEvidence.positive), pressure: clone(matrix.counterEvidence.negative), servicingLimitations: clone(matrix.servicing), supplementaryClarification: '在标准页清楚列出：相对高负担须同表新兴排中国75百分位及以上且高于中位数；明显国内约束须具体债务、收入和资产/回款组合。3.5以上须同部门实际DSR；代理缺失不得强行加/扣分。' }, definitionCorrection: '原始杠杆比率仅为研判证据，主计分观察为1—5分半分证据矩阵；先判断国内约束和反证，不单靠杠杆绝对高低。' });
}
rules.sort((a,b)=>framework.indicators.findIndex((x)=>x.id===a.id)-framework.indicators.findIndex((x)=>x.id===b.id));
if (rules.length !== 7 || Math.abs(rules.reduce((s,r)=>s+r.weight,0)-.2)>1e-12) throw new Error('Indicator/weight invariant failed');
for (const r of rules.filter((r)=>r.scoring.method==='piecewise-linear')) {
  if (r.sampleSummary.n !== 29 || r.sampleSummary.missingMonths.length) throw new Error('Common sample incomplete: '+r.id);
  const hs = scoped(histories[r.id]);
  if (Math.abs(hs.at(-1).value-current.observations[r.id].value) > 1e-5) throw new Error('Current original value mismatch: '+r.id);
  if (r.scoring.anchors.some(([x,s],i,a)=>i&&x<=a[i-1][0]||s<1||s>5)) throw new Error('Invalid recommended scoring '+r.id);
}
const summary = { originalPillarScore: rules.reduce((s,r)=>s+r.weight*(r.current?.oldScore??r.sampleSummary.engineScore),0)/.2, recommendedPillarScore: rules.reduce((s,r)=>s+r.weight*(r.current?.recommendedScore??r.sampleSummary.engineScore),0)/.2 };
summary.macroTotalContributionChange = (summary.recommendedPillarScore-summary.originalPillarScore)*.2;
const output = { version: 'V1.16', asOf: current.asOf, status: '可集成的尺度校准候选；未修改共享规则、主观测或发布', baselineInputs: { frameworkInputPath, currentInputPath, requiredVersion: 'V1.15', preference: '冻结备份存在时优先使用；共享当前仅允许V1.15，拒绝把V1.16再次作为现版基线。' }, skills: ['china-macro-rating', 'backtest-expert'], hypothesis: '适度加密常态内节点，提高中期信用变化的得分可见性，同时保留极端锚点和可复核证据门槛。', commonWindow: WINDOW, rules, summary, diagnosticsDefinitions: { middleShare: '2<得分<4的样本占比；不把集中于中间视为自动缺陷', tailShare: '恰为1或5的样本占比；三候选外端相同，饱和不变主要由构造决定，不是经验有效性证明', consecutiveSignReversals: '相邻两个非微小月度得分变化（绝对变化>=0.01）方向反转次数；不是经济误报率', meanAbsoluteMonthChange: '连续月份的绝对得分变化均值；局部中心更敏感不保证全样本月均跳动增加', sensitivityComparison: '现版与预先固定常态25%/50%内锚点收窄，各自外端完全保留；不根据当前值位置或总分事后移动锚点' }, histories, officialOriginalFiles: fetched.tables.map(({rawHtml,...t})=>t), sourceEvidenceFile: cachePath, inputChecksums: Object.fromEntries([frameworkInputPath,currentInputPath,'app/data/macro-finance-credit.json','app/data/macro-money-supply.json','lib/macro-leverage-scoring.mjs'].map((path)=>[path,crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')])), limitations: ['统一29个月样本不足覆盖完整地产/通胀/信用周期，未给出宏观事件真值，不能把反转/波动叫误报率或宣称最优。', '未做PIT发布日期重建、样本外验证、资产回报检验；这次是宏观背景评分尺度而非交易策略。', '保留全部7项及合计20%和各项已确认权重；建议仅3项适度内节点变化、4项保留。'] };
fs.writeFileSync('deliverables/macro-v1-16-credit-calibration.json', JSON.stringify(output,null,2)+'\n');
const lines = ['# V1.16 金融信贷评分尺度校准', '', '研究截止：2026-10-11。7项及各权重不动；仅评分尺度比较，不是资产收益优化。', '', '## 结论', '', '建议居民/企事业中长期贷款同比多增、剔除政府债后社融同比3项适度加密内节点，保留尾部端点；同源社融三个月变化、M1−M2、两项杠杆证据矩阵保留。三套比较固定为现版、常态25%、常态50%收窄，不根据本期总分倒推。', '', '统一2024-04至2026-08、29个月当前修订样本，全部量化5项齐全；另外保留全部可得序列。这里“反转”“尾部饱和”仅机械诊断，不叫经济误报率，不声称PIT或样本外有效。', '', '| 指标 | 推荐 | 旧分→候选分 | 现/25%/50%月均绝对变化 | 现/25%/50%反转次数 | 尾部样本数 |', '| --- | --- | --- | --- | --- | --- |'];
for(const r of rules){if(r.current){lines.push(`| ${r.id} ${r.name} | ${r.decision} | ${r.current.oldScore.toFixed(4)}→${r.current.recommendedScore.toFixed(4)} | ${r.candidates.map(c=>c.diagnostics.meanAbsoluteMonthChange.toFixed(3)).join('/')} | ${r.candidates.map(c=>c.diagnostics.consecutiveSignReversals).join('/')} | ${r.candidates.map(c=>c.diagnostics.tailCount).join('/')} |`);}else lines.push(`| ${r.id} ${r.name} | 保留矩阵 | 2.50→2.50 | 不适用 | 不适用 | 不适用 |`);}
for(const r of rules){lines.push('',`## ${r.id} ${r.name}`, '', r.reason, '', r.scoring.anchors?`推荐锚点：${r.scoring.anchors.map(([x,s])=>`${x}→${s}分`).join('；')}。`:'半分证据矩阵保持；国内与国际口径分开。', '', ...r.limitations.map(x=>'- '+x));if(r.evidenceReview)lines.push('',r.evidenceReview.supplementaryClarification);}
lines.push('', '## 复算与证据', '', `金融信贷分${summary.originalPillarScore.toFixed(6)}→${summary.recommendedPillarScore.toFixed(6)}，对总分影响${summary.macroTotalContributionChange.toFixed(6)}；这是同信息截止的规则差异，不是经济变化。`, '', ...fetched.tables.map(t=>`- [${t.year}年央行社会融资规模存量统计表](${t.sourceUrl})：原始网页、提取行、SHA-256保存在配套stock-originals文件。`), '', '脚本默认使用已保存原表；--refresh-official重新获取。若本轮冻结的V1.15规则/当前观测备份存在，脚本优先读取备份；否则只允许共享当前仍为V1.15，拒绝将已集成V1.16当作旧基线。实际输入路径和SHA-256保存在JSON。所有候选锚点、逐月原值/得分、年度诊断、当前误差区间和矩阵证据可独立复算；候选数值本次未变。', '', '## 治理限制', '', ...output.limitations.map(x=>'- '+x));
fs.writeFileSync('deliverables/macro-v1-16-credit-calibration.md', lines.join('\n')+'\n');
console.log(JSON.stringify({rules:rules.map(r=>({id:r.id,decision:r.decision,n:r.sampleSummary.n,anchors:r.scoring.anchors,old:r.current?.oldScore,next:r.current?.recommendedScore})),summary},null,2));
