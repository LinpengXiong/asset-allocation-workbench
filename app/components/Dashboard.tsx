"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssetName, MarketInputPayload, ModelSnapshot } from "../../lib/types";
import { calculateModel, modelParameters } from "../../lib/model";
import advisory from "../data/advisory.json";

const PRIMARY_TABS = ["宏观", "大类资产", "中观", "微观", "资产配置"] as const;
const ALLOCATION_TABS = ["配置总览", "市场因子", "细分配置", "情景压力", "参数与方法"] as const;
type PrimaryTab = (typeof PRIMARY_TABS)[number];
type AllocationTab = (typeof ALLOCATION_TABS)[number];

const ASSET_COLOR: Record<AssetName, string> = {
  股票: "var(--stock)",
  债券: "var(--bond)",
  商品: "var(--commodity)",
  另类: "var(--alternative)",
};

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const score = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

function freshness(input: MarketInputPayload) {
  const age = Date.now() - Date.parse(input.collectedAt);
  if (!Number.isFinite(age)) return "更新时间未知";
  const hours = Math.max(0, Math.floor(age / 3_600_000));
  if (hours < 1) return "刚刚更新";
  if (hours < 24) return `${hours} 小时前更新`;
  return `${Math.floor(hours / 24)} 天前更新`;
}

function ResearchHeader({ kicker, title, note }: { kicker: string; title: string; note: string }) {
  return <div className="research-header"><div><p className="eyebrow">{kicker}</p><h2>{title}</h2></div><p>{note}</p></div>;
}

const display = (value: unknown) => value == null || value === "" ? "—" : String(value);

function ResearchTabs({ items, active, onChange, label }: { items: readonly string[]; active: string; onChange: (item: string) => void; label: string }) {
  return <nav className="subtabs research-subtabs" aria-label={label}>{items.map((item) => <button key={item} className={active === item ? "active" : ""} onClick={() => onChange(item)}>{item}</button>)}</nav>;
}

function MacroView() {
  const tabs = ["总览与结论", "多年趋势", "67项指标库", "资产传导", "情景与政策"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  const [pillar, setPillar] = useState("全部");
  const [status, setStatus] = useState("全部");
  const indicators = advisory.macroIndicators.filter((item) => (pillar === "全部" || item.primary === pillar) && (status === "全部" || item.status === status));
  return <div className="research-stack">
    <section className="research-summary"><div><span>当前宏观状态</span><strong>{advisory.macroState}</strong></div><div><span>指标覆盖</span><strong>{advisory.macroFramework.verifiedIndicators} / {advisory.macroFramework.totalIndicators}</strong></div><p><b>核心矛盾：</b>{advisory.coreConflict}<small>{advisory.macroNote}</small></p></section>
    <ResearchTabs items={tabs} active={tab} onChange={(item) => setTab(item as (typeof tabs)[number])} label="宏观研究页面" />
    {tab === "总览与结论" ? <>
      <section className="panel"><ResearchHeader kicker="EXCEL FRAMEWORK" title="严格映射 Excel 的四支柱与五档状态" note={advisory.macroFramework.strictCoverage} /><div className="macro-pillar-grid">{advisory.macroPillars.map((item) => <article key={item.name}><div><span>{item.weight}</span><b>{item.signal}</b></div><h3>{item.name}</h3><strong>{item.direction}</strong><p>{item.evidence}</p><small>作用：{item.role}<br />覆盖：{item.coverage} · 继续观察：{item.watch}</small></article>)}</div><div className="rating-scale">{advisory.macroFramework.ratings.map((item) => <div key={item.grade}><span>{item.grade}</span><strong>{item.range}</strong><small>{item.state}</small></div>)}</div></section>
      <section className="panel"><ResearchHeader kicker="PROFESSIONAL EXTENSIONS" title="Excel 之外必须补看的宏观层" note="领先—同步—滞后、资产负债表与全球约束共同决定未来路径。" /><div className="framework-grid">{advisory.macroExtensions.map((item) => <article key={item.layer}><span>{item.layer}</span><h3>{item.purpose}</h3><p><b>指标：</b>{item.metrics}</p><p><b>当前：</b>{item.current}</p><small>{item.decision}</small></article>)}</div></section>
    </> : null}
    {tab === "多年趋势" ? <section className="panel"><ResearchHeader kicker="HISTORICAL REGIME" title="2022—2026 关键宏观序列" note={advisory.macroHistory.note} /><div className="table-wrap"><table className="dense-table"><thead><tr><th>指标</th>{advisory.macroHistory.periods.map((item) => <th key={item}>{item}</th>)}<th>专业解读</th></tr></thead><tbody>{advisory.macroHistory.series.map((item) => <tr key={item.metric}><td><strong>{item.metric}</strong><small>{item.unit}</small></td>{item.values.map((value, index) => <td key={index}>{value.toFixed(1)}</td>)}<td className="wide-cell">{item.interpretation}</td></tr>)}</tbody></table></div><p className="research-footnote">历史对比用于识别周期位置、基数效应与政策传导；不能把半年累计值和全年增速机械外推。</p></section> : null}
    {tab === "67项指标库" ? <section className="panel"><ResearchHeader kicker="67-INDICATOR LIBRARY" title="指标、阈值、当前值与资产含义" note="本期缺失项明确留空；只有来源、口径与周期可核验时才给分。" /><div className="filter-row"><div>{["全部", "经济运行", "增长动力", "金融信贷", "政策制度"].map((item) => <button key={item} className={pillar === item ? "active" : ""} onClick={() => setPillar(item)}>{item}</button>)}</div><div>{["全部", "已核验", "待采集"].map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{item}</button>)}</div><span>显示 {indicators.length} 项</span></div><div className="table-wrap indicator-table"><table className="dense-table"><thead><tr><th>ID</th><th>一级 / 二级</th><th>三级指标</th><th>频率</th><th>本期值 / 周期</th><th>历史参照 / 方向</th><th>评分</th><th>用途与资产含义</th><th>来源 / 阈值</th></tr></thead><tbody>{indicators.map((item) => <tr key={item.id}><td>{item.id}</td><td><strong>{item.primary}</strong><small>{item.secondary}</small></td><td><strong>{item.name}</strong><small className={item.status === "已核验" ? "verified-text" : "pending-text"}>{item.status}</small></td><td>{item.frequency}</td><td><strong>{display(item.currentValue)}</strong><small>{display(item.period)}</small></td><td>{display(item.prior)}<small>{display(item.trend)}</small></td><td>{item.score == null ? <span className="score-empty">—</span> : <span className={`macro-score s${item.score}`}>{item.score}</span>}</td><td className="wide-cell">{item.purpose}<small>{display(item.assetMeaning)}</small></td><td className="source-cell"><span>{item.currentSource || item.expectedSource}</span>{item.scoreRules ? <details><summary>查看 1—5 分规则</summary><ol><li>1：{item.scoreRules.score1}</li><li>2：{item.scoreRules.score2}</li><li>3：{item.scoreRules.score3}</li><li>4：{item.scoreRules.score4}</li><li>5：{item.scoreRules.score5}</li></ol><small>{item.scoreRules.logic} · {item.scoreRules.reference}</small></details> : <small>事件驱动项，不机械打分</small>}</td></tr>)}</tbody></table></div></section> : null}
    {tab === "资产传导" ? <section className="panel"><ResearchHeader kicker="MACRO TO ASSET" title="宏观变量如何决定各类资产" note="增长、通胀、信用、政策、全球利率和风险偏好共同决定赔率。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>决定因素</th><th>当前读数</th><th>权益</th><th>债券</th><th>商品</th><th>黄金</th><th>另类策略</th></tr></thead><tbody>{advisory.assetTransmission.map((item) => <tr key={item.driver}><td><strong>{item.driver}</strong></td><td>{item.current}</td><td>{item.equity}</td><td>{item.bond}</td><td>{item.commodity}</td><td>{item.gold}</td><td>{item.alternatives}</td></tr>)}</tbody></table></div></section> : null}
    {tab === "情景与政策" ? <><section className="panel"><ResearchHeader kicker="SCENARIO MAP" title="情景、触发与组合动作" note="不设置缺乏依据的概率；连续数据确认后才改变组合。" /><div className="scenario-map">{advisory.scenarios.map((item, index) => <article key={item.name} className={index === 0 ? "base" : ""}><span>0{index + 1}</span><h3>{item.name}情景</h3><p>{item.description}</p><dl><div><dt>确认信号</dt><dd>{item.trigger}</dd></div><div><dt>组合动作</dt><dd>{item.action}</dd></div></dl></article>)}</div></section><section className="panel"><ResearchHeader kicker="POLICY INTELLIGENCE" title="核心会议跟踪与解读" note="核心会议跟踪作为宏观政策输入，最终仍在本投顾网址呈现。" /><div className="policy-list">{advisory.policyMeetings.map((item) => <article key={item.title}><time>{item.date}</time><div><h3>{item.title}</h3><p>{item.core}</p><dl><div><dt>投研映射</dt><dd>{item.mapping}</dd></div><div><dt>验证点</dt><dd>{item.watch}</dd></div></dl><a href={item.url} target="_blank" rel="noreferrer">官方原文 ↗</a></div></article>)}</div></section><section className="panel"><ResearchHeader kicker="SOURCES" title="宏观、政策与内参来源" note="官方来源可打开回溯；用户上传材料明确标注为内部研究资料。" /><div className="research-sources">{advisory.sources.map((source, index) => source.url ? <a href={source.url} target="_blank" rel="noreferrer" key={`${source.label}-${index}`}><span>{source.date}</span><strong>{source.label}<small>{source.scope}</small></strong><i>↗</i></a> : <div className="source-static" key={`${source.label}-${index}`}><span>{source.date}</span><strong>{source.label}<small>{source.scope}</small></strong><i>内部</i></div>)}</div></section></> : null}
  </div>;
}

function AssetView() {
  const tabs = ["资产总表", "跨期观点", "中国权益估值", "风格赔率", "配置推导"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  return <div className="research-stack">
    <ResearchTabs items={tabs} active={tab} onChange={(item) => setTab(item as (typeof tabs)[number])} label="大类资产研究页面" />
    {tab === "资产总表" ? <><section className="panel"><ResearchHeader kicker="PERFORMANCE" title="大类资产表现" note="不同日期、币种和指数口径不可直接排名。" /><div className="market-snapshot-grid">{advisory.marketSnapshots.map((item) => <article key={item.name}><span>{item.name}</span><strong className={item.ytd.includes("−") ? "negative" : "positive"}>{item.ytd}</strong><small>YTD · {item.asOf}</small></article>)}</div><p className="research-footnote">表现只是结果；建议由宏观、估值/赔率、盈利/Carry、趋势、流动性和尾部风险共同推导。</p></section><section className="panel"><ResearchHeader kicker="SIX-DIMENSION METHOD" title="大类资产建议如何推导" note="每个资产回答六个问题，避免用单一涨跌给结论。" /><div className="dimension-grid">{advisory.assetRatingDimensions.map((item) => <article key={item.name}><span>{item.weight}</span><h3>{item.name}</h3><p>{item.question}</p></article>)}</div></section><section className="panel"><ResearchHeader kicker="ASSET SCORECARD" title="估值、赔率、风险与结论在一张表" note="继承 2026 年中期内参观点并补齐证据链。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>资产</th><th>观点</th><th>宏观匹配</th><th>估值/赔率</th><th>盈利/Carry</th><th>趋势/资金</th><th>流动性</th><th>主要风险</th><th>实施结论</th></tr></thead><tbody>{advisory.assetScorecards.map((item) => <tr key={item.asset}><td><strong>{item.asset}</strong></td><td><span className={`view-chip ${item.stance.includes("超配") ? "up" : item.stance.includes("低配") ? "down" : "flat"}`}>{item.stance}</span></td><td>{item.macro}</td><td>{item.valuation}</td><td>{item.carry}</td><td>{item.trend}</td><td>{item.liquidity}</td><td>{item.risk}</td><td className="wide-cell"><strong>{item.conclusion}</strong></td></tr>)}</tbody></table></div></section></> : null}
    {tab === "跨期观点" ? <section className="panel"><ResearchHeader kicker="MEMO EVOLUTION" title="三份内参的观点演变" note="按各期当时信息复原研究判断；历史观点用于检验逻辑一致性，不代表当前建议。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>时点 / 资料</th><th>中国权益</th><th>境外权益</th><th>境内债</th><th>境外债</th><th>CTA / 黄金</th><th>当期证据</th><th>事后复核 / 观点演变</th></tr></thead><tbody>{advisory.memoEvolution.map((item) => <tr key={item.period}><td><strong>{item.period}</strong><small>{item.source}</small></td><td>{item.chinaEquity}</td><td>{item.overseasEquity}</td><td>{item.domesticBond}</td><td>{item.overseasBond}</td><td>{item.cta}</td><td className="wide-cell">{item.evidence}</td><td className="wide-cell"><strong>{item.review}</strong></td></tr>)}</tbody></table></div><p className="research-footnote">跨期复核重点：哪些判断持续有效、哪些因基本面或估值变化而调整、当前配置是否仍满足组合约束。</p></section> : null}
    {tab === "中国权益估值" ? <section className="panel"><ResearchHeader kicker="VALUATION & ODDS" title="中国、港股与美股估值赔率对照" note="内参估值截至 2026-07-18；百分位越高通常越贵，ERP 越高通常安全边际越大。" /><div className="table-wrap"><table className="dense-table numeric-table"><thead><tr><th>指数</th><th>ERP%</th><th>PE</th><th>PE分位%</th><th>PB</th><th>PB分位%</th><th>PS</th><th>PS分位%</th><th>ROE%</th><th>股息率%</th><th>赔率判断</th></tr></thead><tbody>{advisory.equityValuations.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.erp}</td><td>{item.pe}</td><td>{item.pePct}</td><td>{item.pb}</td><td>{item.pbPct}</td><td>{item.ps}</td><td>{item.psPct}</td><td>{item.roe}</td><td>{item.dividend}</td><td className="wide-cell">{item.read}</td></tr>)}</tbody></table></div></section> : null}
    {tab === "风格赔率" ? <section className="panel"><ResearchHeader kicker="STYLE ODDS" title="价值、成长与红利：估值 + 盈利 + 股息" note="风格选择同时比较 ERP、估值分位、ROE、收入与利润。" /><div className="table-wrap"><table className="dense-table numeric-table"><thead><tr><th>风格</th><th>ERP%</th><th>PE / 分位</th><th>PB / 分位</th><th>ROE%</th><th>股息率%</th><th>Q1收入%</th><th>Q1利润%</th><th>观点</th><th>推导</th></tr></thead><tbody>{advisory.styleValuations.map((item) => <tr key={item.style}><td><strong>{item.style}</strong></td><td>{item.erp}</td><td>{item.pe} / {item.pePct}%</td><td>{item.pb} / {item.pbPct}%</td><td>{item.roe}</td><td>{item.dividend}</td><td>{item.revenueGrowth}</td><td>{item.profitGrowth}</td><td><span className="view-chip up">{item.view}</span></td><td className="wide-cell">{item.logic}</td></tr>)}</tbody></table></div></section> : null}
    {tab === "配置推导" ? <section className="panel"><ResearchHeader kicker="DECISION CHAIN" title="观点、组合角色与调仓触发" note="研究层观点不直接改仓；真正仓位由第五部分的约束和阈值生成。" /><div className="table-wrap"><table className="research-table"><thead><tr><th>资产</th><th>观点</th><th>组合角色</th><th>核心证据</th><th>风险</th><th>触发</th></tr></thead><tbody>{advisory.assetViews.map((item) => <tr key={item.asset}><td><strong>{item.asset}</strong></td><td><span className={`view-chip ${item.stance.includes("超配") ? "up" : item.stance.includes("低配") ? "down" : "flat"}`}>{item.stance}</span></td><td>{item.role}</td><td>{item.evidence}</td><td>{item.risk}</td><td>{item.trigger}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}

function MesoView() {
  const tabs = ["区域比较", "分析框架", "风格数据", "产业数据"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  return <div className="research-stack">
    <ResearchTabs items={tabs} active={tab} onChange={(item) => setTab(item as (typeof tabs)[number])} label="中观研究页面" />
    {tab === "区域比较" ? <section className="panel"><ResearchHeader kicker="REGIONAL MAP" title="中国、日韩、美国与全球同表比较" note="缺失的海外最新数据留空；后续采集增长、通胀、利率、盈利修正、估值和资金流。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>区域</th><th>增长</th><th>通胀</th><th>利率</th><th>盈利</th><th>估值</th><th>产业抓手</th><th>观点</th><th>待补数据</th></tr></thead><tbody>{advisory.regionalIndicators.map((item) => <tr key={item.region}><td><strong>{item.region}</strong></td><td>{item.growth}</td><td>{item.inflation}</td><td>{item.rates}</td><td>{item.earnings}</td><td>{item.valuation}</td><td>{item.industries}</td><td><span className="view-chip flat">{item.stance}</span></td><td>{item.missing}</td></tr>)}</tbody></table></div></section> : null}
    {tab === "分析框架" ? <section className="panel"><ResearchHeader kicker="MESO SIX LENSES" title="中观不止产业和风格" note="盈利、估值、供需、资本开支、资金拥挤与全球映射六层交叉。" /><div className="framework-grid">{advisory.mesoLenses.map((item, index) => <article key={item.lens}><span>0{index + 1}</span><h3>{item.lens}</h3><p>{item.metrics}</p><small>{item.decision}</small></article>)}</div></section> : null}
    {tab === "风格数据" ? <><section className="panel"><ResearchHeader kicker="STYLE TAPE" title="交易结构与拥挤度" note="成交结构用于控制风险预算，不替代盈利与估值。" /><div className="style-monitor">{advisory.styles.map((item) => <div key={item.factor}><span>{item.factor}</span><strong>{item.reading}</strong><p>{item.signal}</p><small>{item.action}</small></div>)}</div></section><section className="panel"><ResearchHeader kicker="STYLE FUNDAMENTALS" title="风格估值与盈利表" note="估值截至 2026-07-18，盈利截至 2026-03-31。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>风格</th><th>ERP%</th><th>PE/分位</th><th>PB/分位</th><th>ROE%</th><th>股息%</th><th>收入%</th><th>利润%</th><th>观点与逻辑</th></tr></thead><tbody>{advisory.styleValuations.map((item) => <tr key={item.style}><td><strong>{item.style}</strong></td><td>{item.erp}</td><td>{item.pe}/{item.pePct}%</td><td>{item.pb}/{item.pbPct}%</td><td>{item.roe}</td><td>{item.dividend}</td><td>{item.revenueGrowth}</td><td>{item.profitGrowth}</td><td className="wide-cell"><strong>{item.view}</strong><small>{item.logic}</small></td></tr>)}</tbody></table></div></section></> : null}
    {tab === "产业数据" ? <section className="panel"><ResearchHeader kicker="INDUSTRY MATRIX" title="11 个行业：估值、质量与盈利同表" note="不再用“景气强/弱”替代数据；地产 PE 无意义时明确留空。" /><div className="table-wrap"><table className="dense-table numeric-table"><thead><tr><th>行业</th><th>ERP%</th><th>PE/分位</th><th>PB/分位</th><th>ROE%</th><th>股息%</th><th>收入增速%</th><th>利润增速%</th><th>观点</th><th>判断依据</th></tr></thead><tbody>{advisory.industries.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.erp}</td><td>{display(item.pe)} / {display(item.pePct)}{item.pePct == null ? "" : "%"}</td><td>{item.pb} / {item.pbPct}%</td><td>{item.roe}</td><td>{item.dividend}</td><td>{item.revenueGrowth}</td><td>{item.profitGrowth}</td><td><span className={`view-chip ${item.stance.includes("超配") ? "up" : item.stance.includes("低配") ? "down" : "flat"}`}>{item.stance}</span></td><td className="wide-cell">{item.logic}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}

function MicroView() {
  const tabs = ["当下实施", "公募与ETF", "私募策略", "评级体系"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  return <div className="research-stack">
    <section className="panel"><ResearchHeader kicker="PRODUCT UNIVERSE" title="公募、ETF 与 11 类私募策略" note="现有截图保留为候选池来源；看不清的产品名不猜测，先用策略层和公开 ETF 建立可用版面。" /><div className="coverage-chips">{advisory.productCoverage.map((item) => <span key={item}>{item}</span>)}</div></section>
    <ResearchTabs items={tabs} active={tab} onChange={(item) => setTab(item as (typeof tabs)[number])} label="微观产品研究页面" />
    {tab === "当下实施" ? <><section className="panel"><ResearchHeader kicker="TOP-DOWN TO PRODUCT" title="宏观—资产—中观—产品实施链" note="公募用于透明、低成本、流动性好的 Beta/主题；私募用于难复制 Alpha、做空/衍生品和低相关收益。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>目标</th><th>宏观依据</th><th>资产结论</th><th>中观落点</th><th>优先工具</th><th>候选</th><th>当前动作</th></tr></thead><tbody>{advisory.implementationMap.map((item) => <tr key={item.objective}><td><strong>{item.objective}</strong></td><td>{item.macro}</td><td>{item.asset}</td><td>{item.meso}</td><td><span className="view-chip flat">{item.preferred}</span></td><td>{item.candidates}</td><td className="wide-cell"><strong>{item.action}</strong></td></tr>)}</tbody></table></div></section><section className="micro-grid"><article className="panel"><ResearchHeader kicker="BENCHMARK STRESS" title="策略基准压力表" note="用户上传快照，截至 2026-07-24" /><div className="table-wrap"><table><thead><tr><th>基准</th><th>本月</th><th>今年</th><th>近一年 Sharpe</th><th>近一年回撤</th></tr></thead><tbody>{advisory.benchmarks.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.mtd}</td><td>{item.ytd}</td><td>{item.sharpe}</td><td>{item.drawdown}</td></tr>)}</tbody></table></div></article><article className="panel gate-panel"><p className="eyebrow">FIVE GATES</p><h2>进入组合前的五道门</h2><ol><li>观察：数据完整、策略可解释</li><li>短名单：同基准、同周期比较</li><li>尽调：团队、流程、风控与治理</li><li>试配：小仓位验证相关性与流动性</li><li>复核：季度归因、年度深度复审</li></ol></article></section></> : null}
    {tab === "公募与ETF" ? <section className="panel"><ResearchHeader kicker="PUBLIC VEHICLES" title="公开 ETF 候选与待补数据" note="产品身份已由交易所来源确认；规模、跟踪误差、成交和费率未核验前不打分。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>代码 / 产品</th><th>组合角色</th><th>基准</th><th>当前判断</th><th>规模</th><th>跟踪误差</th><th>日均成交</th><th>总费率</th><th>内部评分</th><th>缺口 / 官方来源</th></tr></thead><tbody>{advisory.etfCandidates.map((item) => <tr key={item.code}><td><strong>{item.code}</strong><small>{item.name}</small></td><td>{item.role}</td><td>{item.benchmark}</td><td><span className="view-chip flat">{item.currentView}</span></td><td>{display(item.aum)}</td><td>{display(item.trackingError)}</td><td>{display(item.avgTurnover)}</td><td>{display(item.totalFee)}</td><td>{display(item.score)}</td><td className="wide-cell">{item.missing}<small><a href={item.source} target="_blank" rel="noreferrer">交易所来源 ↗</a></small></td></tr>)}</tbody></table></div><div className="professional-boundary"><b>公募选择原则</b><p>需要可交易 Beta、透明持仓、较高流动性和低费率时优先 ETF；需要可验证的选股 Alpha 且能接受风格偏离时，再考虑主动公募。所有比较必须统一基准与持有期。</p></div></section> : null}
    {tab === "私募策略" ? <section className="panel"><ResearchHeader kicker="PRIVATE STRATEGY DUE DILIGENCE" title="11 类私募策略的评价方法与当前用途" note="策略之间不能按同一收益排名；每类使用不同的风险与归因指标。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>策略</th><th>必须分析的数据</th><th>与宏观/中观的连接</th><th>当前用途</th><th>产品级状态</th></tr></thead><tbody>{advisory.privateStrategyMatrix.map((item) => <tr key={item.strategy}><td><strong>{item.strategy}</strong></td><td className="wide-cell">{item.mustSee}</td><td>{item.macroLink}</td><td>{item.currentUse}</td><td><span className="pending-text">{item.status}</span></td></tr>)}</tbody></table></div><p className="research-footnote">原截图中的具体产品在可辨识度不足时不录入名称；补充原始 Excel/净值文件后，可自动进入同策略排名、归因和评级。</p></section> : null}
    {tab === "评级体系" ? <><section className="rating-policy"><div><span>评级性质</span><strong>{advisory.ratingPolicy.title}</strong></div><div><span>数据门槛</span><strong>{advisory.ratingPolicy.dataGate}</strong></div><div><span>复核频率</span><strong>{advisory.ratingPolicy.review}</strong></div></section><section className="panel"><ResearchHeader kicker="INTERNAL RATING" title="ETF、主动公募与私募分别评级" note="先过数据完整性和准入门，再比较收益、风险、稳定性、治理与组合适配。" /><div className="rating-model-grid">{advisory.productRatingModels.map((model) => <article key={model.type}><h3>{model.type}</h3><p>{model.grade}</p><div>{model.dimensions.map((item) => <div key={String(item[0])}><span>{item[0]}</span><b>{item[1]}%</b><small>{item[2]}</small></div>)}</div></article>)}</div><div className="grade-row">{advisory.ratingPolicy.grades.map((item) => <span key={item}>{item}</span>)}</div></section></> : null}
  </div>;
}

function AllocationBars({ model }: { model: ModelSnapshot }) {
  return (
    <div className="allocation-bars" aria-label="当前仓位与建议目标对比">
      {model.allocations.map((item) => (
        <div className="bar-row" key={item.asset}>
          <div className="bar-label">
            <span>{item.asset}</span>
            <strong>{pct(item.target)}</strong>
          </div>
          <div className="bar-track">
            <span className="bar-current" style={{ width: pct(item.current), background: ASSET_COLOR[item.asset] }} />
            <span className="bar-target-marker" style={{ left: pct(item.target) }} />
          </div>
          <div className="bar-legend"><span>当前 {pct(item.current)}</span><span>目标 {pct(item.target)}</span></div>
        </div>
      ))}
    </div>
  );
}

function Overview({ model }: { model: ModelSnapshot }) {
  const triggerCount = model.allocations.filter((item) => item.action !== "观察").length;
  return (
    <>
      <section className="kpi-grid">
        <article className="kpi-card primary">
          <p>上证指数</p>
          <strong>{model.input.index.value.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</strong>
          <span className={Number(model.input.index.changePct ?? 0) >= 0 ? "positive" : "negative"}>
            {model.input.index.changePct == null ? "—" : `${model.input.index.changePct > 0 ? "+" : ""}${model.input.index.changePct.toFixed(2)}%`}
          </span>
        </article>
        <article className="kpi-card">
          <p>股票建议仓位</p>
          <strong>{pct(model.allocations[0].target)}</strong>
          <span>点位锚与战术信号共同生成</span>
        </article>
        <article className="kpi-card">
          <p>组合目标合计</p>
          <strong>{pct(model.checks.targetTotal)}</strong>
          <span>上下限与归一约束</span>
        </article>
        <article className={`kpi-card ${model.checks.status === "模型通过" ? "success" : "warning"}`}>
          <p>模型状态</p>
          <strong>{model.checks.status}</strong>
          <span>{triggerCount} 项触发调仓</span>
        </article>
      </section>

      <section className="two-column">
        <article className="panel">
          <div className="section-heading">
            <div><p className="eyebrow">目标组合</p><h2>大类资产调仓建议</h2></div>
            <span className="muted">阈值抑制频繁交易</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>资产</th><th>当前</th><th>目标</th><th>差额</th><th>信号</th><th>观点</th><th>执行</th></tr></thead>
              <tbody>
                {model.allocations.map((item) => (
                  <tr key={item.asset}>
                    <td><span className="asset-dot" style={{ background: ASSET_COLOR[item.asset] }} />{item.asset}</td>
                    <td>{pct(item.current)}</td><td><strong>{pct(item.target)}</strong></td>
                    <td className={item.difference > 0 ? "positive" : item.difference < 0 ? "negative" : ""}>{signedPct(item.difference)}</td>
                    <td>{score(item.signal)}</td><td>{item.view}</td>
                    <td><span className={`action ${item.action}`}>{item.action}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="section-heading"><div><p className="eyebrow">仓位对比</p><h2>当前 vs 建议目标</h2></div></div>
          <AllocationBars model={model} />
        </article>
      </section>

      <section className="panel rationale-panel">
        <div className="section-heading"><div><p className="eyebrow">审计线索</p><h2>建议依据</h2></div></div>
        <div className="rationale-grid">
          {model.allocations.map((item) => (
            <div key={item.asset} className="rationale-card">
              <span>{item.asset}</span><strong>{item.rationale}</strong><p>{item.trigger} · 调仓阈值 {pct(item.threshold)}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Factors({ model }: { model: ModelSnapshot }) {
  const sourceById = Object.fromEntries(model.input.sources.map((source) => [source.id, source]));
  return (
    <div className="stack">
      {(["股票", "债券", "商品", "另类"] as AssetName[]).map((asset) => (
        <section className="panel" key={asset}>
          <div className="section-heading">
            <div><p className="eyebrow">{asset}信号</p><h2>{asset}因子证据</h2></div>
            <strong className="signal-badge">{score(model.allocations.find((item) => item.asset === asset)?.signal ?? 0)}</strong>
          </div>
          <div className="factor-list">
            {model.input.factors.filter((factor) => factor.asset === asset).map((factor) => (
              <article className="factor-card" key={factor.factor}>
                <div className="factor-top"><div><h3>{factor.factor}</h3><p>{factor.indicator}</p></div><span className={`score-pill score-${String(factor.score).replace("-", "n").replace(".", "_")}`}>{factor.score > 0 ? "+" : ""}{factor.score.toFixed(1)}</span></div>
                <div className="factor-meta"><span>权重 {pct(factor.weight, 0)}</span><span>{factor.frequency}</span><span className={factor.verified ? "verified" : "unverified"}>{factor.verified ? "已核验" : "待核验"}</span></div>
                <p className="evidence">{factor.evidence}</p>
                {factor.sourceIds.length ? <div className="source-links">{factor.sourceIds.map((id) => sourceById[id] ? <a href={sourceById[id].url} target="_blank" rel="noreferrer" key={id}>{sourceById[id].publisher} ↗</a> : null)}</div> : null}
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">股票风格</p><h2>风格轮动信号矩阵</h2></div></div>
        <div className="style-score-grid">
          {Object.entries(model.styleScores).map(([name, value]) => <div key={name}><span>{name}</span><strong>{score(value)}</strong></div>)}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>风格因子</th><th>评分</th><th>权重</th><th>红利暴露</th><th>GARP暴露</th><th>成长暴露</th><th>判定口径</th></tr></thead>
            <tbody>{model.input.styleFactors.map((factor) => <tr key={factor.factor}><td>{factor.factor}</td><td>{factor.score.toFixed(1)}</td><td>{pct(factor.weight, 0)}</td><td>{factor.exposure.dividend.toFixed(1)}</td><td>{factor.exposure.garp.toFixed(1)}</td><td>{factor.exposure.growth.toFixed(1)}</td><td>{factor.methodology}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SubAllocationView({ model }: { model: ModelSnapshot }) {
  return <section className="panel"><div className="section-heading"><div><p className="eyebrow">母资产内归一</p><h2>细分方向建议</h2></div><span className="muted">组合目标合计 {pct(model.checks.subTargetTotal)}</span></div><div className="table-wrap"><table><thead><tr><th>母资产</th><th>细分方向</th><th>母资产内基准</th><th>评分</th><th>母资产内目标</th><th>组合目标</th><th>当前</th><th>差额</th><th>执行</th><th>核心观察</th></tr></thead><tbody>{model.subAllocations.map((item) => <tr key={`${item.parent}-${item.name}`}><td>{item.parent}</td><td><strong>{item.name}</strong></td><td>{pct(item.baseWithinParent)}</td><td>{score(item.score)}</td><td>{pct(item.targetWithinParent)}</td><td>{pct(item.portfolioTarget)}</td><td>{pct(item.currentPortfolio)}</td><td className={item.difference > 0 ? "positive" : item.difference < 0 ? "negative" : ""}>{signedPct(item.difference)}</td><td><span className={`action ${item.action}`}>{item.action}</span></td><td>{item.watch}</td></tr>)}</tbody></table></div></section>;
}

function StressView({ model }: { model: ModelSnapshot }) {
  const maxStock = Math.max(...model.stressScenarios.map((item) => item.stock));
  return <div className="two-column stress-layout"><section className="panel"><div className="section-heading"><div><p className="eyebrow">点位路径</p><h2>指数点位与股票建议仓位</h2></div></div><div className="scenario-chart">{model.stressScenarios.map((item) => <div className="scenario-column" key={item.indexPoint}><div className="scenario-fill" style={{ height: `${(item.stock / maxStock) * 100}%` }}><span>{pct(item.stock, 0)}</span></div><strong>{item.indexPoint}</strong></div>)}</div></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">约束结果</p><h2>大类资产情景表</h2></div></div><div className="table-wrap"><table><thead><tr><th>上证点位</th><th>股票</th><th>债券</th><th>商品</th><th>另类</th></tr></thead><tbody>{model.stressScenarios.map((item) => <tr key={item.indexPoint}><td><strong>{item.indexPoint}</strong></td><td>{pct(item.stock)}</td><td>{pct(item.bond)}</td><td>{pct(item.commodity)}</td><td>{pct(item.alternative)}</td></tr>)}</tbody></table></div></section></div>;
}

function MethodView({ model }: { model: ModelSnapshot }) {
  return <div className="stack"><section className="panel"><div className="section-heading"><div><p className="eyebrow">模型参数</p><h2>大类资产约束</h2></div></div><div className="table-wrap"><table><thead><tr><th>资产</th><th>战略中枢</th><th>下限</th><th>上限</th><th>信号敏感度/分</th><th>调仓阈值</th></tr></thead><tbody>{Object.entries(modelParameters.assets).map(([asset, param]) => <tr key={asset}><td><strong>{asset}</strong></td><td>{pct(param.strategic)}</td><td>{pct(param.min)}</td><td>{pct(param.max)}</td><td>{pct(param.sensitivity)}</td><td>{pct(param.threshold)}</td></tr>)}</tbody></table></div></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">点位锚</p><h2>上证指数—股票基础仓位</h2></div></div><div className="anchor-grid">{modelParameters.indexAnchors.map((item) => <div key={item.point}><strong>{item.point}</strong><span>{pct(item.position, 0)}</span></div>)}</div></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">治理原则</p><h2>更新、复核与边界</h2></div></div><ol className="method-list"><li><strong>股票先定总仓位：</strong>点位分段线性插值，基本面、流动性、趋势与风险信号只做有限修正。</li><li><strong>剩余预算再分配：</strong>债券、商品、另类先形成各自原始目标，再在非股票预算内按相对强弱分配。</li><li><strong>上下限硬约束：</strong>所有目标不得突破产品约束，残差按可用空间二次分配并归一到 100%。</li><li><strong>阈值抑制换手：</strong>偏离不足阈值时只观察，达到阈值才生成增配或减配动作。</li><li><strong>证据化评分：</strong>定时任务记录来源、时间与结论；证据不足保持原值或中性，不猜测。</li><li><strong>人工复核边界：</strong>极端行情可临时触发，但政策、地缘和执行约束仍应由负责人复核。</li></ol></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">数据来源</p><h2>本期证据清单</h2></div></div><div className="source-list">{model.input.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><div><strong>{source.title}</strong><span>{source.publisher} · {new Date(source.observedAt).toLocaleString("zh-CN")}</span></div><span>打开来源 ↗</span></a>)}</div></section></div>;
}

function AllocationSystem({ model }: { model: ModelSnapshot }) {
  const [tab, setTab] = useState<AllocationTab>("配置总览");
  return <div className="allocation-system">
    <section className="allocation-intro">
      <div><p className="eyebrow">LIVE PORTFOLIO ENGINE</p><h2>资产配置与调仓建议</h2></div>
      <p>完整保留当前持仓、点位锚、19 项资产因子、6 项风格因子、细分目标、压力测试、参数约束和证据清单；本页数据仍按原有接口每 60 秒同步。</p>
    </section>
    <nav className="subtabs" aria-label="资产配置功能">
      {ALLOCATION_TABS.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
    </nav>
    {tab === "配置总览" ? <Overview model={model} /> : null}
    {tab === "市场因子" ? <Factors model={model} /> : null}
    {tab === "细分配置" ? <SubAllocationView model={model} /> : null}
    {tab === "情景压力" ? <StressView model={model} /> : null}
    {tab === "参数与方法" ? <MethodView model={model} /> : null}
  </div>;
}

export function Dashboard({ initialPayload }: { initialPayload: MarketInputPayload }) {
  const [payload, setPayload] = useState(initialPayload);
  const [tab, setTab] = useState<PrimaryTab>("宏观");
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const model = useMemo(() => calculateModel(payload), [payload]);

  async function refresh(silent = false) {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (response.status === 401) { window.location.reload(); return; }
      if (!response.ok) throw new Error("refresh failed");
      const next = (await response.json()) as { payload: MarketInputPayload };
      if (next.payload.collectedAt !== payload.collectedAt) {
        setPayload(next.payload);
        setMessage("已同步最新数据");
        window.setTimeout(() => setMessage(""), 3000);
      }
    } catch {
      if (!silent) setMessage("同步失败，将自动重试");
    } finally {
      if (!silent) setRefreshing(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 60_000);
    return () => window.clearInterval(timer);
  });

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">ASSET ALLOCATION WORKBENCH</p><h1>资产配置工作台</h1></div><div className="topbar-actions"><div className="live-status"><span /><div><strong>{freshness(payload)}</strong><small>组合数据日 {payload.asOf}</small></div></div><button className="ghost-button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "同步中…" : "同步最新"}</button><button className="ghost-button" onClick={logout}>退出</button></div></header>
    <div className={`data-banner ${payload.status}`}><strong>{payload.status === "verified" ? "本期数据已核验" : payload.status === "partial" ? "部分数据已核验" : "初始模板数据"}</strong><span>{payload.notes[0]}</span>{message ? <em>{message}</em> : null}</div>
    <section className="ic-strip"><div><span>宏观状态</span><strong>{advisory.macroState}</strong></div><div><span>增长范式</span><strong>{advisory.regime}</strong></div><div><span>当前组合</span><strong>{model.allocations.map((item) => `${item.asset}${pct(item.current, 0)}`).join(" · ")}</strong></div><div><span>模型状态</span><strong>{model.checks.status}</strong></div></section>
    <nav className="tabs primary-tabs" aria-label="五层投顾体系">{PRIMARY_TABS.map((item, index) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><span>0{index + 1}</span>{item}</button>)}</nav>
    <div className="content">{tab === "宏观" ? <MacroView /> : null}{tab === "大类资产" ? <AssetView /> : null}{tab === "中观" ? <MesoView /> : null}{tab === "微观" ? <MicroView /> : null}{tab === "资产配置" ? <AllocationSystem model={model} /> : null}</div>
    <footer><span>宏观—资产—产业—产品—组合 · 数据与观点均标注时间口径</span><strong>纪律化决策支持，不构成个人化投资建议</strong></footer>
  </main>;
}
