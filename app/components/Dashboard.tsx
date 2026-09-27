"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssetName, MarketInputPayload, ModelSnapshot } from "../../lib/types";
import { calculateModel, modelParameters } from "../../lib/model";
import advisory from "../data/advisory.json";
import intrayear from "../data/macro-intrayear.json";
import additional from "../data/macro-additional.json";

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

function AnnualSparkline({ values, label }: { values: number[]; label: string }) {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high - low || 1;
  const y = (value: number) => 38 - ((value - low) / span) * 30;
  const points = values.map((value, index) => `${8 + index * 26},${y(value)}`).join(" ");
  return <svg className="annual-sparkline" viewBox="0 0 94 46" role="img" aria-label={`${label}，2022 至 2025 年度趋势`}>
    <line x1="5" y1={y(0)} x2="89" y2={y(0)} className="zero-line" />
    <polyline points={points} />
    {values.map((value, index) => <circle key={index} cx={8 + index * 26} cy={y(value)} r="2.6" />)}
  </svg>;
}

function IntrayearChart({ metric, periods, values, unit, precision = 1, approximate = false }: { metric: string; periods: string[]; values: number[]; unit: string; precision?: number; approximate?: boolean }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const chartLeft = 42;
  const chartRight = 604;
  const chartTop = 17;
  const chartBottom = 154;
  const benchmark = metric === "消费者信心指数" ? 100 : metric.includes("PMI") ? 50 : null;
  const floor = Math.min(...values, benchmark ?? Infinity);
  const ceiling = Math.max(...values, benchmark ?? -Infinity);
  const padding = Math.max((ceiling - floor) * 0.18, 0.35);
  const low = floor - padding;
  const high = ceiling + padding;
  const x = (index: number) => chartLeft + (index * (chartRight - chartLeft)) / Math.max(1, values.length - 1);
  const y = (value: number) => chartBottom - ((value - low) / (high - low)) * (chartBottom - chartTop);
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const ticks = [low, (low + high) / 2, high];
  const reference = benchmark ?? (low <= 0 && high >= 0 ? 0 : null);
  const activeIndex = hoveredIndex ?? selectedIndex;
  const nearestIndex = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    const chartX = ((clientX - bounds.left) / bounds.width) * 620;
    return Math.max(0, Math.min(values.length - 1, Math.round(((chartX - chartLeft) / (chartRight - chartLeft)) * (values.length - 1))));
  };
  const tooltipX = activeIndex === null ? 0 : Math.max(72, Math.min(548, x(activeIndex)));
  const tooltipY = activeIndex === null ? 0 : y(values[activeIndex]) < 65 ? y(values[activeIndex]) + 53 : y(values[activeIndex]) - 12;
  return <svg className="intrayear-chart" viewBox="0 0 620 194" role="img" tabIndex={0} aria-label={`${metric}逐期走势。移动鼠标、点击或使用左右方向键查看最近的已发布数据点。${periods.map((period, index) => `${period}${approximate ? "约" : ""}${values[index]}${unit}`).join("，")}`}
    onPointerMove={(event) => setHoveredIndex(nearestIndex(event.clientX, event.currentTarget))}
    onPointerLeave={() => setHoveredIndex(null)}
    onPointerDown={(event) => { if (event.pointerType !== "mouse") setSelectedIndex(nearestIndex(event.clientX, event.currentTarget)); }}
    onClick={(event) => setSelectedIndex(nearestIndex(event.clientX, event.currentTarget))}
    onKeyDown={(event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(0, Math.min(values.length - 1, (current ?? (event.key === "ArrowRight" ? -1 : values.length)) + (event.key === "ArrowRight" ? 1 : -1))));
      } else if (event.key === "Escape") setSelectedIndex(null);
    }}>
    <rect x="0" y="0" width="620" height="194" fill="transparent" />
    {ticks.map((tick, index) => <g key={index}><line x1={chartLeft} x2={chartRight} y1={y(tick)} y2={y(tick)} className="intrayear-grid" /><text x={chartLeft - 7} y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick.toFixed(precision)}</text></g>)}
    {reference !== null ? <line x1={chartLeft} x2={chartRight} y1={y(reference)} y2={y(reference)} className="intrayear-reference" /> : null}
    <polyline points={points} className="intrayear-line" />
    {activeIndex !== null ? <line x1={x(activeIndex)} x2={x(activeIndex)} y1={chartTop} y2={chartBottom} className="intrayear-hover-guide" pointerEvents="none" /> : null}
    {values.map((value, index) => <g key={`${periods[index]}-${index}`}><circle cx={x(index)} cy={y(value)} r={activeIndex === index ? 6 : index === values.length - 1 ? 5 : 3.5} className={activeIndex === index ? "intrayear-active-point" : index === values.length - 1 ? "intrayear-last-point" : "intrayear-point"}><title>{periods[index]}：{approximate ? "约" : ""}{value.toFixed(precision)}{unit}</title></circle><text x={x(index)} y="181" textAnchor="middle" className="intrayear-axis-label">{periods[index]}</text></g>)}
    {activeIndex !== null ? <g className="intrayear-tooltip" transform={`translate(${tooltipX},${tooltipY})`} pointerEvents="none"><rect x="-64" y="-38" width="128" height="42" rx="7" /><text y="-22" textAnchor="middle">{periods[activeIndex]}</text><text y="-7" textAnchor="middle">{approximate ? "约" : ""}{values[activeIndex].toFixed(precision)}{unit}</text></g> : null}
  </svg>;
}

function PopulationStructureChart() {
  const rows = additional.population.rows;
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const colors = ["#b9bba9", "#bc9157", "#741918"];
  const names = ["0—14岁", "15—64岁", "65岁及以上"];
  const x = (index: number) => 42 + index * 25;
  return <article className="intrayear-card macro-wide-card population-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>就业市场 · 年度结构</span></div><h3>人口结构占比</h3><p>三组年龄人口占比，1990—2025 年；与月度失业率分开观察</p></div><div className="intrayear-latest"><strong>{row[0]} 年</strong><small>指向、点按柱体或用方向键查看</small></div></div>
    <div className="macro-chart-legend">{names.map((name, index) => <span key={name}><i style={{ background: colors[index] }} />{name}</span>)}</div>
    <div className="intrayear-chart-scroll"><svg className="population-chart" viewBox="0 0 960 260" role="img" tabIndex={0} aria-label={`1990至2025年人口结构百分比堆叠柱图；当前选中${row[0]}年，0至14岁${row[1].toFixed(1)}%，15至64岁${row[2].toFixed(1)}%，65岁及以上${row[3].toFixed(1)}%`}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1="35" x2="940" y1={222 - tick * 1.9} y2={222 - tick * 1.9} className="intrayear-grid" /><text x="30" y={226 - tick * 1.9} textAnchor="end" className="intrayear-axis-label">{tick}</text></g>)}
      {rows.map((item, index) => { const sum = item[1] + item[2] + item[3]; let bottom = 222; return <g key={item[0]} onPointerEnter={() => setActive(index)} onClick={() => setActive(index)} className={active === index ? "population-active" : ""}>
        {[3, 2, 1].map((part) => { const height = (item[part] / sum) * 190; bottom -= height; return <rect key={part} x={x(index)} y={bottom} width="19" height={height} fill={colors[part - 1]}><title>{item[0]}年 {names[part - 1]}：{item[part].toFixed(1)}%</title></rect>; })}
        <rect x={x(index)} y="32" width="19" height="190" fill="transparent" />
        {index % 5 === 0 || index === rows.length - 1 ? <text x={x(index) + 9.5} y="240" textAnchor="middle" className="intrayear-axis-label">{item[0]}</text> : null}
      </g>; })}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row[0]} 年</strong>{names.map((name, index) => <span key={name}>{name}：{row[index + 1].toFixed(1)}%</span>)}</div>
    <div className="intrayear-card-bottom"><span>国家统计局年鉴；2025 年按年末公报人数计算，占比四舍五入。年龄结构不是劳动参与率。</span><span><a href={additional.population.yearbookUrl} target="_blank" rel="noreferrer">1990—2024 年鉴 ↗</a> · <a href={additional.population.latestUrl} target="_blank" rel="noreferrer">2025 公报 ↗</a></span></div>
  </article>;
}

function InwardFdiChart() {
  const rows = additional.inwardFdi.rows;
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const x = (index: number) => 58 + index * 73;
  const amountY = (value: number) => 186 - value / 5200 * 145;
  const yoyY = (value: number) => 42 + (-value / 12) * 144;
  return <article className="intrayear-card macro-wide-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>投资 · 实际使用外资</span></div><h3>外商直接投资</h3><p>2026 年人民币累计金额（柱）与累计同比（线），双轴分别标注</p></div><div className="intrayear-latest"><strong>{row.amount.toFixed(1)} 亿元</strong><small>{row.period}累计 · 同比 {row.yoy.toFixed(1)}%</small></div></div>
    <div className="macro-chart-legend"><span><i style={{ background: "#bc9157" }} />实际使用外资 · 亿元</span><span><i style={{ background: "#741918" }} />累计同比 · %</span></div>
    <div className="intrayear-chart-scroll"><svg className="fdi-chart" viewBox="0 0 620 232" role="img" tabIndex={0} aria-label={`2026年实际使用外资金额和累计同比；当前${row.period}累计${row.amount}亿元，同比${row.yoy}%`}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      {[0, 2000, 4000].map((tick) => <g key={tick}><line x1="42" x2="574" y1={amountY(tick)} y2={amountY(tick)} className="intrayear-grid" /><text x="37" y={amountY(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick}</text></g>)}
      {[-12, -6, 0].map((tick) => <text key={tick} x="580" y={yoyY(tick) + 4} className="intrayear-axis-label">{tick}%</text>)}
      {rows.map((item, index) => <g key={item.period} onPointerEnter={() => setActive(index)} onClick={() => setActive(index)}><rect x={x(index) - 13} y={amountY(item.amount)} width="26" height={186 - amountY(item.amount)} fill="#bc9157" opacity={active === index ? 1 : .8}><title>{item.period}：{item.amount}亿元，同比{item.yoy}%</title></rect><rect x={x(index) - 29} y="30" width="58" height="167" fill="transparent" /><text x={x(index)} y="213" textAnchor="middle" className="intrayear-axis-label">{item.period}</text></g>)}
      <polyline points={rows.map((item, index) => `${x(index)},${yoyY(item.yoy)}`).join(" ")} className="fdi-yoy-line" />
      {rows.map((item, index) => <circle key={item.period} cx={x(index)} cy={yoyY(item.yoy)} r={active === index ? 5 : 3} className="fdi-yoy-point" onPointerEnter={() => setActive(index)} onClick={() => setActive(index)} />)}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row.period}累计</strong><span>金额：{row.amount.toFixed(1)} 亿元</span><span>累计同比：{row.yoy.toFixed(1)}%</span><a href={row.url} target="_blank" rel="noreferrer">当期商务部发布 ↗</a></div>
    <div className="intrayear-card-bottom"><span>{additional.inwardFdi.basis}</span><a href={additional.inwardFdi.rows.at(-1)?.url} target="_blank" rel="noreferrer">最新官方发布 ↗</a></div>
  </article>;
}

function GoodsTradeCards() {
  const trade = additional.goodsTrade.rows;
  const ccfi = additional.ccfi.rows;
  const periods = trade.map((item) => item.period);
  return <div className="intrayear-grid-cards goods-trade-grid">
    {(["export", "import"] as const).map((kind) => {
      const isExport = kind === "export";
      const title = isExport ? "出口金额与增速" : "进口金额与增速";
      const values = trade.map((item) => isExport ? item.exportYoy : item.importYoy);
      const latest = trade.at(-1)!;
      return <article className="intrayear-card" key={kind}><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>进出口 · 当月同比</span></div><h3>{title}</h3><p>上图为美元计价的当月同比；下方逐月列出当月金额</p></div><div className="intrayear-latest"><strong>{values.at(-1)?.toFixed(1)}%</strong><small>8月金额 {(isExport ? latest.export : latest.import).toFixed(2)} 亿美元</small></div></div>
        <div className="intrayear-chart-scroll"><IntrayearChart metric={title} periods={periods} values={values} unit="%" /></div>
        <div className="trade-month-amounts" aria-label={`${title}逐月金额`}>{trade.map((item) => <span key={item.period}><small>{item.period}</small><strong>{(isExport ? item.export : item.import).toFixed(2)}</strong></span>)}</div>
        <div className="intrayear-card-bottom"><span>金额单位：亿美元 · 当月值</span><a href={additional.goodsTrade.sourceUrl} target="_blank" rel="noreferrer">海关月度原表 ↗</a></div>
      </article>;
    })}
    <article className="intrayear-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>进出口 · 当月值</span></div><h3>货物贸易顺差</h3><p>海关口径，美元计价，当月出口减进口</p></div><div className="intrayear-latest"><strong>{trade.at(-1)?.surplus.toFixed(2)} 亿美元</strong><small>8月</small></div></div><div className="intrayear-chart-scroll"><IntrayearChart metric="货物贸易顺差" periods={periods} values={trade.map((item) => item.surplus)} unit="亿美元" precision={2} /></div><div className="intrayear-card-bottom"><span>与国际收支口径货物顺差不可直接混用</span><a href={additional.goodsTrade.sourceUrl} target="_blank" rel="noreferrer">海关月度原表 ↗</a></div></article>
    <article className="intrayear-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>进出口 · 月均指数</span></div><h3>出口集装箱运价指数（CCFI）</h3><p>中国出口集装箱综合运价指数月平均值</p></div><div className="intrayear-latest"><strong>{ccfi.at(-1)?.value.toFixed(2)} 点</strong><small>8月</small></div></div><div className="intrayear-chart-scroll"><IntrayearChart metric="CCFI" periods={ccfi.map((item) => item.period)} values={ccfi.map((item) => item.value)} unit="点" precision={2} /></div><div className="intrayear-card-bottom"><span>上海航运交易所发布；非即期 SCFI</span><a href={ccfi.at(-1)?.url} target="_blank" rel="noreferrer">最新官方月报 ↗</a></div></article>
  </div>;
}

function MacroHistoryView() {
  const groups = ["全部", "经济运行", "增长动力", "金融信贷", "政策制度"] as const;
  const economicSubgroups = ["经济增长", "物价水平", "国际收支", "景气指数", "就业市场"] as const;
  const growthSubgroups = ["投资", "消费", "进出口", "工业生产", "房地产"] as const;
  const featuredMetrics = new Set(["GDP 单季实际增速", "GDP 平减指数", "CPI", "PPI", "核心 CPI", "PPI－CPI 剪刀差", "制造业 PMI", "非制造业 PMI", "综合 PMI 产出指数", "消费者信心指数", "城镇调查失业率", "规模以上工业增加值", "民间固定资产投资", "新建商品房销售面积", "社融存量增速", "一般公共预算支出"]);
  const priceMetricOrder = ["CPI", "PPI", "核心 CPI", "PPI－CPI 剪刀差"];
  const [group, setGroup] = useState<(typeof groups)[number]>("全部");
  const [deflatorMode, setDeflatorMode] = useState<"single" | "cumulative">("single");
  const rows = advisory.macroHistory.series;
  const visiblePillars = group === "全部" ? groups.slice(1) : [group];
  const indicatorsById = new Map(advisory.macroIndicators.map((item) => [item.id, item]));
  const renderIntrayearCard = (item: (typeof intrayear.series)[number]) => {
    const hasAlternate = "alternate" in item && Boolean(item.alternate);
    const active = deflatorMode === "cumulative" && "alternate" in item && item.alternate ? item.alternate : item;
    const sourceSet = "sourceSet" in item ? item.sourceSet : undefined;
    const sources = sourceSet === "activity" ? intrayear.activitySources
      : sourceSet === "fiscal" ? intrayear.fiscalSources
      : sourceSet === "coreCpi" ? intrayear.coreCpiSources
      : sourceSet === "privateInvestment" ? intrayear.privateInvestmentSources
      : sourceSet === "credit" ? intrayear.creditSources
      : sourceSet === "deflator" ? intrayear.deflatorSources
      : sourceSet === "nonManufacturingPmi" ? intrayear.nonManufacturingPmiSources
      : sourceSet === "reserve" ? intrayear.reserveSources
      : sourceSet === "trade" ? intrayear.tradeSources : undefined;
    const sourceUrl = sourceSet === "deflator" ? sources?.[deflatorMode === "cumulative" ? 2 : 1]?.url : "url" in item ? item.url : sources?.[sources.length - 1]?.url;
    const last = active.values[active.values.length - 1];
    const previous = active.values[active.values.length - 2];
    const delta = last - previous;
    const precision = "precision" in item ? item.precision : 1;
    const changeUnit = item.unit === "%" ? "个百分点" : item.unit || "点";
    const approximate = hasAlternate;
    const comparisonLabel = hasAlternate && deflatorMode === "cumulative" ? "较上个累计期" : "较上个披露期";
    return <article className="intrayear-card" key={item.metric}>
      <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>{"subgroup" in item ? item.subgroup : item.group}</span>{"role" in item && item.role ? <span className="intrayear-role">{item.role}</span> : null}</div><h3>{item.metric}</h3><p>{active.basis}</p></div><div className="intrayear-latest"><strong>{approximate ? "约" : ""}{last.toFixed(precision)}{item.unit}</strong><small>{active.periods[active.periods.length - 1]}</small><small>{comparisonLabel} {delta >= 0 ? "+" : ""}{delta.toFixed(precision)} {changeUnit}</small></div></div>
      {hasAlternate ? <div className="intrayear-switch" role="group" aria-label="GDP 平减指数统计口径"><button type="button" aria-pressed={deflatorMode === "single"} onClick={() => setDeflatorMode("single")}>单季同比</button><button type="button" aria-pressed={deflatorMode === "cumulative"} onClick={() => setDeflatorMode("cumulative")}>年初累计同比</button></div> : null}
      <div className="intrayear-chart-scroll"><IntrayearChart metric={item.metric} periods={active.periods} values={active.values} unit={item.unit} precision={precision} approximate={approximate} /></div>
      <div className="intrayear-card-bottom"><span>{active.source}</span>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{"sourceLinkLabel" in item ? item.sourceLinkLabel : "查看官方发布 ↗"}</a> : null}</div>
    </article>;
  };
  return <div className="research-stack">
    <section className="panel">
      <ResearchHeader kicker="INVESTMENT VIEW" title="2026 逐期变化" note={intrayear.note} />
      <div className="history-summary"><strong>{intrayear.series.length} 条基础序列 · 5 项专项观察 · 1 项年度结构</strong><span>鼠标指向或点击图表查看真实观测点；不同统计口径不拼接。</span><span>复核日：{additional.reviewedAt}</span></div>
      <div className="history-filters" aria-label="宏观趋势四大板块">{groups.map((item) => <button key={item} className={item === group ? "active" : ""} onClick={() => setGroup(item)}>{item}</button>)}</div>
      {visiblePillars.map((pillar) => {
        const pillarRows = intrayear.series.filter((item) => item.group === pillar);
        if (pillar === "经济运行") return <section className="intrayear-pillar" key={pillar} aria-label="经济运行逐期走势">
          <div className="intrayear-pillar-heading"><h3>经济运行</h3><span>{pillarRows.length} 条逐期曲线 + 1 项年度人口结构 · 按五类查看</span></div>
          {economicSubgroups.map((subgroup) => {
            const rows = pillarRows.filter((item) => "subgroup" in item && item.subgroup === subgroup)
              .sort((a, b) => subgroup === "物价水平" ? priceMetricOrder.indexOf(a.metric) - priceMetricOrder.indexOf(b.metric) : 0);
            const isExternal = subgroup === "国际收支";
            const primaryRows = group === "全部" ? rows.filter((item) => featuredMetrics.has(item.metric)) : rows;
            const secondaryRows = group === "全部" ? rows.filter((item) => !featuredMetrics.has(item.metric)) : [];
            return <section className="intrayear-subgroup" key={subgroup} aria-label={`${subgroup}走势`}>
              <div className="intrayear-subgroup-heading"><h4>{subgroup}</h4><span>{rows.length} 条曲线{isExternal ? " · 辅助观察" : ""}</span></div>
              {isExternal ? <details className="intrayear-more intrayear-external"><summary>展开国际收支曲线</summary><p>外储是月末存量，受汇率与资产价格影响；货物及服务贸易均采用外汇局国际收支月度口径，与指标库的海关货物贸易数值不可直接比较。</p><div className="intrayear-grid-cards">{rows.map(renderIntrayearCard)}</div></details> : <>
                <div className="intrayear-grid-cards">{primaryRows.map(renderIntrayearCard)}</div>
                {secondaryRows.length ? <details className="intrayear-more"><summary>查看{subgroup}其他 {secondaryRows.length} 条曲线</summary><div className="intrayear-grid-cards">{secondaryRows.map(renderIntrayearCard)}</div></details> : null}
              </>}
              {subgroup === "就业市场" ? <PopulationStructureChart /> : null}
            </section>;
          })}
        </section>;
        if (pillar === "增长动力") return <section className="intrayear-pillar" key={pillar} aria-label="增长动力逐期走势">
          <div className="intrayear-pillar-heading"><h3>增长动力</h3><span>{pillarRows.length} 条已核验逐期曲线 · 按五类查看</span></div>
          {growthSubgroups.map((subgroup) => {
            const rows = pillarRows.filter((item) => "subgroup" in item && item.subgroup === subgroup);
            return <section className="intrayear-subgroup" key={subgroup} aria-label={`${subgroup}走势`}>
              <div className="intrayear-subgroup-heading"><h4>{subgroup}</h4><span>{subgroup === "进出口" ? "4 项官方逐月指标" : `${rows.length} 条曲线${subgroup === "投资" ? " · 外商直接投资另列" : ""}`}</span></div>
              {subgroup === "进出口" ? <><p className="intrayear-subgroup-note">出口与进口上方为美元当月同比，金额逐月列在图下；货物顺差为海关口径，运价为 CCFI 月均值。</p><GoodsTradeCards /></> : <div className="intrayear-grid-cards">{rows.map(renderIntrayearCard)}</div>}
              {subgroup === "投资" ? <InwardFdiChart /> : null}
            </section>;
          })}
        </section>;
        const primaryRows = group === "全部" ? pillarRows.filter((item) => featuredMetrics.has(item.metric)) : pillarRows;
        const secondaryRows = group === "全部" ? pillarRows.filter((item) => !featuredMetrics.has(item.metric)) : [];
        return <section className="intrayear-pillar" key={pillar} aria-label={`${pillar}逐期走势`}>
          <div className="intrayear-pillar-heading"><h3>{pillar}</h3><span>{pillarRows.length} 条已核验逐期曲线</span></div>
          <div className="intrayear-grid-cards">{primaryRows.map(renderIntrayearCard)}</div>
          {secondaryRows.length ? <details className="intrayear-more"><summary>查看{pillar}其他 {secondaryRows.length} 条曲线</summary><div className="intrayear-grid-cards">{secondaryRows.map(renderIntrayearCard)}</div></details> : null}
        </section>;
      })}
      <details className="intrayear-source-details"><summary>查看逐期原始发布与统计期</summary><div><strong>国家统计局经济运行</strong>{intrayear.activitySources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家统计局核心 CPI</strong>{intrayear.coreCpiSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家统计局民间投资</strong>{intrayear.privateInvestmentSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家统计局非制造业 PMI</strong>{intrayear.nonManufacturingPmiSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家统计局 GDP 平减指数推算</strong>{intrayear.deflatorSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>中国人民银行社融</strong>{intrayear.creditSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>财政部财政收支</strong>{intrayear.fiscalSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家外汇管理局外汇储备</strong>{intrayear.reserveSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家外汇管理局货物及服务贸易</strong>{intrayear.tradeSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div></details>
    </section>
    <section className="panel">
      <details className="intrayear-planned"><summary><strong>后续候选曲线（{intrayear.planned.length} 条）</strong><span>目前仅展示指标库最新值，历史点未逐期核验，不绘制走势</span></summary><div className="history-signal-grid">{intrayear.planned.map((item) => {
        const indicator = indicatorsById.get(item.indicatorId);
        return <article key={item.indicatorId}><span>{item.group} · 待补</span><h3>{item.metric}</h3><strong>{display(indicator?.currentValue)}</strong><small>{display(indicator?.period)}</small><p>{item.reason}</p></article>;
      })}</div></details>
    </section>
    <section className="panel">
      <details className="history-annual-details"><summary><strong>2022—2025 年度参照</strong><span>长期背景 · 不与2026逐期数据连线</span></summary>
      <ResearchHeader kicker="ANNUAL COMPARISON" title="完整年度比较" note={advisory.macroHistory.note} />
      <div className="table-wrap"><table className="dense-table macro-history-table"><thead><tr><th>指标 / 年度口径</th>{advisory.macroHistory.periods.map((item) => <th key={item}>{item}</th>)}<th>年度轨迹</th><th>2026 当前观察<br /><small>不与全年直接比较</small></th><th>阅读要点</th></tr></thead><tbody>{rows.map((item) => {
        const indicator = "latestIndicatorId" in item && item.latestIndicatorId ? indicatorsById.get(item.latestIndicatorId) : undefined;
        const latest = "latest" in item ? item.latest : undefined;
        const currentValue = indicator?.currentValue ?? latest?.value;
        const currentPeriod = indicator?.period ?? latest?.period;
        const currentSource = indicator?.currentSource ?? latest?.source;
        return <tr key={item.metric}><td><strong>{item.metric}</strong><small>{item.group} · {item.basis} · {item.unit}</small></td>{item.values.map((value, index) => <td key={advisory.macroHistory.periods[index]}>{value.toFixed(1)}</td>)}<td><AnnualSparkline values={item.values} label={item.metric} /></td><td className="history-current"><strong>{display(currentValue)}</strong><small>{display(currentPeriod)}</small><small>{display(currentSource)}</small>{latest?.url ? <a href={latest.url} target="_blank" rel="noreferrer">当期官方发布 ↗</a> : null}</td><td className="wide-cell">{item.interpretation}</td></tr>;
      })}</tbody></table></div>
      <p className="research-footnote">年度折线只连接 2022—2025 完整年度读数；“2026 当前观察”可能是单季、单月或年初累计，用来查看最新方向，不计算与全年值的差额。</p>
      <div className="history-sources"><span>年度原始来源：</span>{advisory.macroHistory.annualSources.map((source) => <a href={source.url} key={source.year} target="_blank" rel="noreferrer">{source.year} 国家统计局公报 ↗</a>)}</div>
      </details>
    </section>
    <section className="panel">
      <ResearchHeader kicker="LEADING SIGNALS" title="当期领先观察" note="重要但尚未纳入同口径年度表的信号，单独呈现，不补造历史值。" />
      <div className="history-signal-grid">{advisory.macroHistory.leadingSignals.map((signal) => {
        const indicator = "indicatorId" in signal && signal.indicatorId ? indicatorsById.get(signal.indicatorId) : undefined;
        return <article key={signal.label}><span>{signal.label}</span><strong>{display(indicator?.currentValue ?? ("value" in signal ? `${signal.value}${signal.unit}` : null))}</strong><small>{display(indicator?.period ?? ("period" in signal ? signal.period : null))}</small><p>{signal.note}</p>{signal.url ? <a href={signal.url} target="_blank" rel="noreferrer">来源与口径 ↗</a> : <small>{display(indicator?.currentSource)}</small>}</article>;
      })}</div>
    </section>
  </div>;
}

function MacroView() {
  const tabs = ["总览与结论", "多年趋势", "62项指标库", "资产传导", "情景与政策"] as const;
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
    {tab === "多年趋势" ? <MacroHistoryView /> : null}
    {tab === "62项指标库" ? <section className="panel"><ResearchHeader kicker="62-INDICATOR LIBRARY" title="指标、阈值、当前值与资产含义" note="各指标按官方最新可得周期展示；累计期与单月、单季数据分别标注。" /><div className="filter-row"><div>{["全部", "经济运行", "增长动力", "金融信贷", "政策制度"].map((item) => <button key={item} className={pillar === item ? "active" : ""} onClick={() => setPillar(item)}>{item}</button>)}</div><div>{["全部", "已核验", "待采集"].map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{item}</button>)}</div><span>显示 {indicators.length} 项</span></div><div className="table-wrap indicator-table"><table className="dense-table"><thead><tr><th>ID</th><th>一级 / 二级</th><th>三级指标</th><th>频率</th><th>本期值 / 周期</th><th>历史参照 / 方向</th><th>评分</th><th>用途与资产含义</th><th>来源 / 阈值</th></tr></thead><tbody>{indicators.map((item) => <tr key={item.id}><td>{item.id}</td><td><strong>{item.primary}</strong><small>{item.secondary}</small></td><td>{item.name}<small className={item.status === "已核验" ? "verified-text" : "pending-text"}>{item.status}</small></td><td>{item.frequency}</td><td><strong>{display(item.currentValue)}</strong><small>{display(item.period)}</small></td><td>{display(item.prior)}<small>{display(item.trend)}</small></td><td>{item.score == null ? <span className="score-empty">—</span> : <span className={`macro-score s${item.score}`}>{item.score}</span>}</td><td className="wide-cell">{item.purpose}<small>{display(item.assetMeaning)}</small></td><td className="source-cell"><span>{item.currentSource || item.expectedSource}</span>{item.scoreRules ? <details><summary>查看 1—5 分规则</summary><ol><li>1：{item.scoreRules.score1}</li><li>2：{item.scoreRules.score2}</li><li>3：{item.scoreRules.score3}</li><li>4：{item.scoreRules.score4}</li><li>5：{item.scoreRules.score5}</li></ol><small>{item.scoreRules.logic} · {item.scoreRules.reference}</small></details> : <small>事件驱动项，不机械打分</small>}</td></tr>)}</tbody></table></div></section> : null}
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

      {model.input.notes[0] ? <p className="research-footnote">{model.input.notes[0]}</p> : null}

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
