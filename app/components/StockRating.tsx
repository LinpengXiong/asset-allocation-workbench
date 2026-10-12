"use client";

import { useState } from "react";
import framework from "../data/stock-rating-framework.json";

export const stockRatingDimensions = framework.dimensions;
type Factor = (typeof framework.indicators)[number];
const percent = (value: number) => `${Number(value.toFixed(2))}%`;

function StockRatingHeader({ standards = false }: { standards?: boolean }) {
  return <header className="research-header stock-rating-header">
    <div><p className="eyebrow">{standards ? "EQUITY SCORING RULES" : "EQUITY INDICATORS"}</p><h2>{standards ? "评分标准" : "评分指标"}</h2></div>
    <div className="stock-rating-meta"><span>{framework.version} · {framework.indicators.length}个核心因子</span><span>中长线配置 · 一级权重固定</span></div>
  </header>;
}

function DimensionNav({ active, onChange }: { active: string; onChange: (dimension: string) => void }) {
  return <nav className="stock-dimension-nav" aria-label="股票评分维度">{stockRatingDimensions.map((d) => <button type="button" aria-pressed={active === d.name} className={active === d.name ? "active" : ""} onClick={() => onChange(d.name)} key={d.name}>{d.name}<span>{percent(d.weight)}</span></button>)}</nav>;
}

function DimensionBrief({ dimension }: { dimension: string }) {
  const dim = stockRatingDimensions.find((d) => d.name === dimension)!;
  const rows = framework.indicators.filter((f) => f.dimension === dimension);
  return <div className="stock-dimension-brief"><div><strong>{dim.question}</strong><p>{dim.boundary}</p></div><span>{rows.length}项 · 合计{percent(rows.reduce((sum, f) => sum + f.weight, 0))}</span></div>;
}

function EvidenceTable({ factor }: { factor: Factor }) {
  return <div className="table-wrap"><table className="dense-table stock-evidence-table"><caption>{factor.name}跟踪口径</caption><thead><tr><th>跟踪指标</th><th>定义与统计口径</th><th>用途 / 单位</th><th>频率与原始来源</th></tr></thead><tbody>{factor.metrics.map((m, i) => <tr key={`${factor.id}-${i}`}><td><strong>{m.name}</strong></td><td>{m.definition}</td><td>{m.role}<small>{m.unit}</small></td><td>{m.frequency}<small>{m.source}</small></td></tr>)}</tbody></table></div>;
}

function FactorProvenance({ factor }: { factor: Factor }) {
  const refs = framework.sources.filter((s) => factor.sourceRefs.includes(s.id) || factor.sourceRefs.includes(s.url));
  return <details className="stock-factor-provenance"><summary>来源与优选取舍</summary><dl><dt>用户打分卡</dt><dd>{factor.provenance.user}</dd><dt>六维框架初稿</dt><dd>{factor.provenance.draft}</dd><dt>本次取舍</dt><dd>{factor.provenance.decision}</dd></dl>{refs.length > 0 ? <ul>{refs.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a><span>{s.scope}</span></li>)}</ul> : null}</details>;
}

function CommonRules() {
  return <details className="stock-common-rules"><summary>共同评分规则与两表整合说明</summary><p className="stock-rules-status">{framework.status}</p><div className="stock-common-rule-grid">{framework.commonRules.map((r) => <article key={r.title}><h3>{r.title}</h3><p>{r.detail}</p></article>)}</div><div className="table-wrap"><table className="dense-table"><caption>两份框架的优选与调整</caption><thead><tr><th>内容</th><th>本次处理</th><th>取舍原因</th></tr></thead><tbody>{framework.decisions.map((d) => <tr key={d.topic}><td><strong>{d.topic}</strong></td><td>{d.action}</td><td>{d.reason}</td></tr>)}</tbody></table></div></details>;
}

export function StockRatingIndicators({ onViewStandard }: { onViewStandard: (id: string) => void }) {
  const [dimension, setDimension] = useState(stockRatingDimensions[0].name);
  const rows = framework.indicators.filter((f) => f.dimension === dimension);
  return <section className="panel stock-rating-panel" aria-label="股票评分指标">
    <StockRatingHeader />
    <p className="stock-rating-intro">按六个维度查看核心因子，展开跟踪口径，或点击查看对应评分标准。所有权重均占综合评分。</p>
    <DimensionNav active={dimension} onChange={setDimension} />
    <DimensionBrief dimension={dimension} />
    <div className="table-wrap"><table className="dense-table stock-indicator-table"><thead><tr><th>核心因子</th><th>总权重</th><th>重点跟踪</th><th>更新 / 状态</th><th>评分规则</th></tr></thead><tbody>{rows.map((f) => <tr key={f.id}><td><strong>{f.name}</strong><small>{f.id} · {f.question}</small></td><td><b>{percent(f.weight)}</b><small>维度内{percent(f.weight / stockRatingDimensions.find((d) => d.name === f.dimension)!.weight * 100)}</small></td><td><ul>{f.metrics.map((m, i) => <li key={`${f.id}-${i}`}>{m.name}<small>{m.role}</small></li>)}</ul></td><td>{f.frequency}<small>本期数据待采集</small></td><td><button type="button" className="stock-standard-link" onClick={() => onViewStandard(f.id)} aria-label={`查看${f.name}评分标准`}>查看标准 →</button></td></tr>)}</tbody></table></div>
    <div className="stock-evidence-list">{rows.map((f) => <details key={f.id}><summary>{f.name}<span>跟踪口径与来源</span></summary><div className="stock-evidence-body"><p>{f.definition}</p><EvidenceTable factor={f} /><FactorProvenance factor={f} /></div></details>)}</div>
    <p className="research-footnote">本页展示整合后的指标框架；两份Excel中的历史分数不作为当前评分，三级观察项不额外增加权重。</p>
  </section>;
}

export function StockRatingStandards({ selectedRuleId }: { selectedRuleId: string | null }) {
  const initial = framework.indicators.find((f) => f.id === selectedRuleId)?.dimension ?? stockRatingDimensions[0].name;
  const [dimension, setDimension] = useState(initial);
  const rows = framework.indicators.filter((f) => f.dimension === dimension);
  return <section className="panel stock-rating-panel" aria-label="股票评分标准">
    <StockRatingHeader standards />
    <p className="stock-rating-intro">先按明确的原值或证据条件评分，再应用约束。复合因子按固定子权重合成，不按主观信心随意补分。</p>
    <CommonRules />
    <DimensionNav active={dimension} onChange={setDimension} />
    <DimensionBrief dimension={dimension} />
    <div className="stock-rule-list" key={dimension}>{rows.map((f, i) => <details className="stock-rule-card" key={f.id} id={`stock-rule-${f.id}`} open={selectedRuleId ? f.id === selectedRuleId : i === 0}>
      <summary><span className="stock-rule-id">{f.id}</span><div><strong>{f.name}</strong><small>{f.question}</small></div><b>{percent(f.weight)}</b><span className="stock-rule-toggle">评分详情</span></summary>
      <div className="stock-rule-body"><p className="stock-rule-definition">{f.definition}</p><section className="stock-rule-calculation"><h3>计算与判定顺序</h3><p>{f.calculation}</p></section>
        <ol className="stock-grade-list">{f.grades.map((grade, j) => <li key={j}><b>{j + 1}分</b><p>{grade}</p></li>)}</ol>
        <section className="stock-rule-exceptions"><h3>约束与缺数处理</h3><ul>{f.exceptions.map((text, j) => <li key={j}>{text}</li>)}</ul></section>
        <details className="stock-rule-evidence"><summary>查看底层指标定义</summary><EvidenceTable factor={f} /></details><FactorProvenance factor={f} />
      </div>
    </details>)}</div>
    <p className="research-footnote">所有阈值、分量比例和封顶条件均为本次研究试行规则，尚未完成历史检验；来源用于核对定义与披露口径，不证明评分阈值最优。</p>
  </section>;
}
