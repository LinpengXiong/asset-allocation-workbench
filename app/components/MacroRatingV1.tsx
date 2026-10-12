"use client";

import { Fragment, useEffect, useState } from "react";
import framework from "../data/macro-rating-v1.json";
import current from "../data/macro-rating-current.json";
import history from "../data/macro-rating-history.json";
import { evaluateMacroRating, scoreIndicator } from "../../lib/macro-rating.mjs";
import { evaluateMacroResearchRating, resolveMacroAssessment } from "../../lib/macro-rating-research.mjs";
import { summarizePillarWeights, formatTotalWeight, describePillarRole, macroRatingScopeNote, macroRatingTimelinessNote } from "../../lib/macro-rating-summary.mjs";
import { validateStandaloneProfitBreadthObservation } from "../../lib/macro-profit-breadth.mjs";
import { continuousScoreDetails } from "../../lib/macro-scoring-continuous.mjs";

const result = evaluateMacroRating(framework, current);
const research = evaluateMacroResearchRating(framework, current).research;
const percent = (value: number) => formatTotalWeight(value);
type Observation = { value: number; period: string; releaseDate: string; verifiedAt?: string; unit?: string; verified: boolean; sourceUrl: string; rationale?: string;
  leverageRatio?: number; yearAgoLeverageRatio?: number; scoringInputs?: Record<string, unknown>; scoringMatrix?: unknown; rawEvidence?: Record<string, unknown> };
type MacroRule = (typeof framework.indicators)[number];
type ScoreAnchor = [number, number];
type ScoreComponent = { key: string; label: string; weight: number; anchors: ScoreAnchor[]; unit?: string; basis?: string; input?: string; anchorUnit?: string; scoreTransform?: "calendar-month-average" };
type ComponentDetails = { points?: number; components?: { key?: string; value: number; points: number; weight: number; scoreValue?: number; scoreUnit?: string; scoreTransform?: string }[] };
const observations = current.observations as Record<string, Observation | null>;
const currentDetails = current as { asOf: string | null; reviewSummary?: string; sourceStatus?: string; evidenceLimitations?: { reason: string }[]; gaps?: { id: string; reason: string }[] };
const ratedCount = result.pillars.reduce((sum, item) => sum + item.verifiedCount, 0);
const missingRules = framework.indicators.filter((item) => scoreIndicator(item, observations[item.id], current.asOf, framework.freshness) === null);
type ResearchAssessment = { points: number; status: string; period: string; reviewDate: string; rationale: string; confidence: string; thresholdComparison: string; unknowns: string[]; counterEvidence: string[]; evidence: { finding: string; sourceUrl: string; releaseDate: string; originalPublisher: string }[] };
type Snapshot = { type: string; period: string; asOf: string; version: string; economic: number | null; growth: number | null; credit: number | null; policy: number | null; score: number | null; grade: string; coverage: number; evidence: string; validation: string;
  research?: { count: number; countTotal: number; coverage: number; score: number | null; pillars?: { name: string; score: number | null; researchCount: number }[] };
  framework?: { indicators: MacroRule[] };
  rows?: { id: string; name: string; points: number | null; researchPoints?: number | null; researchAssessment?: ResearchAssessment | null; weight: number; gap: string | null; observation: Observation | null; scoringDetails?: ComponentDetails | null }[] };
const snapshots = history.snapshots as Snapshot[];
export const formatScore = (value: number | null) => typeof value === "number" && Number.isFinite(value) ? (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2) : "—";
const formatRaw = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? String(Number(value.toPrecision(10))) : typeof value === "string" && value.trim() ? value : "—";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const textValue = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const isFormalSnapshot = (item: Snapshot) => item.type === "正式评级" && Math.abs(item.coverage - 1) < 1e-9 && typeof item.score === "number" && Number.isFinite(item.score);
const pillars = Object.keys(framework.pillars);
const pillarWeightSummary = Object.entries(framework.pillars).map(([name, weight]) => `${name}${formatTotalWeight(weight)}`).join(" / ");
const formatObservationValue = (item: { id: string; mode?: string; unit: string }, observation: Observation) => item.mode === "原文研判"
  ? `${formatScore(observation.value)} 分` : `${item.id === "G19" ? formatScore(observation.value) : formatRaw(observation.value)}${item.unit}`;
const sheetNames = ["评分总览", "评分指标", "评分标准", "评分记录"] as const;
export const macroRatingHeadline = result.formalScore === null
  ? research.count > 0 && research.score !== null ? `研究观察 ${formatScore(research.score)}/5 · 核验${percent(result.coverage)}`
    : `${result.status === "暂定" ? "暂定观察" : "资料不足"} · 覆盖${percent(result.coverage)}`
  : `${result.grade} · ${formatScore(result.formalScore)}/5`;

function MacroResearchAssessment({ assessment }: { assessment: ResearchAssessment | null }) {
  if (!assessment) return null;
  return <div className="macro-v1-rating-note">
    <strong>研究暂评 {formatScore(assessment.points)} 分 · 置信度{assessment.confidence}</strong>
    <span>复核 {assessment.reviewDate} · 原值仍待完整核验，不填写估算原值、不增加核验覆盖率。</span>
    <span>{assessment.rationale}</span><span>{assessment.thresholdComparison}</span>
    <span>待核实：{assessment.unknowns.join("；")}</span><span>反证与限制：{assessment.counterEvidence.join("；")}</span>
    {assessment.evidence.map((item, index) => <span key={index}><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.originalPublisher}原文 ↗</a> · 发布 {item.releaseDate} · {item.finding}</span>)}
  </div>;
}

function MacroRuleRequirements({ item }: { item: (typeof framework.indicators)[number] }) {
  const requirements = "requirements" in item ? item.requirements : undefined;
  const displayRequirements = Array.isArray(requirements) ? requirements.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
  if (!displayRequirements.length) return null;
  return <p><strong>录入与核验要求：</strong>{displayRequirements.join("；")}</p>;
}

function MacroRuleBasis({ item }: { item: (typeof framework.indicators)[number] }) {
  const scoringBasis = "scoringBasis" in item && typeof item.scoringBasis === "string" ? item.scoringBasis : null;
  const thresholdStatus = "thresholdStatus" in item && typeof item.thresholdStatus === "string" ? item.thresholdStatus : null;
  return <>
    <p><strong>评分依据：</strong>{scoringBasis ?? "待补充本指标的经济机制、评分方向与阈值依据，不以既有权重替代依据。"}</p>
    <p><strong>阈值状态：</strong>{thresholdStatus ?? "研究试行边界，尚未完成跨资产历史检验。"}</p>
    <MacroCalibrationNote item={item} />
  </>;
}

function MacroCalibrationNote({ item }: { item: MacroRule }) {
  const value = (item as unknown as Record<string, unknown>).calibration;
  if (!isRecord(value)) return null;
  const limitations = Array.isArray(value.limitations) ? value.limitations.filter((entry): entry is string => typeof entry === "string") : [];
  const comparisons = Array.isArray(value.comparisons) ? value.comparisons.filter(isRecord) : [];
  const evidenceSources = Array.isArray(value.evidenceSources) ? value.evidenceSources.filter(isRecord) : [];
  const range = isRecord(value.precisionRange) ? value.precisionRange : null;
  return <details className="macro-v1-rating-note" aria-label={`${item.name}尺度校准说明`}>
    <summary>尺度校准 · {textValue(value.decision) ?? "保留"}</summary>
    <p><strong>本次取舍：</strong>{textValue(value.reason) ?? "保留现有尺度，等待足够可比历史。"}</p>
    <p><strong>样本范围：</strong>{textValue(value.sampleSummary) ?? "无足够可比历史，不宣称完成历史校准。"}</p>
    {comparisons.length ? <div className="table-wrap"><table className="dense-table"><caption>同样本下的评分尺度对比（不是投资收益或经济误报率）</caption><thead><tr><th>方案</th><th>诊断摘要</th></tr></thead><tbody>{comparisons.map((entry, index) => <tr key={index}><td>{textValue(entry.label) ?? `方案${index + 1}`}</td><td>{textValue(entry.summary) ?? "没有足够样本，不给出验证结论。"}</td></tr>)}</tbody></table></div> : null}
    {limitations.length ? <p><strong>验证限制：</strong>{limitations.join("；")}</p> : null}
    {evidenceSources.length ? <p><strong>官方机制依据：</strong>{evidenceSources.map((source, index) => <span key={index}>{index ? "；" : ""}<a href={textValue(source.url) ?? "#"} target="_blank" rel="noreferrer">{textValue(source.title) ?? "官方原文"}</a>{textValue(source.note) ? `：${textValue(source.note)}` : ""}</span>)}。这些材料解释经济机制，不提供官方评分参考点。</p> : null}
    {range ? <p><strong>已知原值舍入影响：</strong>原值约±{formatRaw(range.rawBound)}{textValue(range.unit)}时，单项得分约{formatRaw(range.minimum)}—{formatRaw(range.maximum)}；只反映已记录舍入界，不是统计置信区间或全部误差范围。</p> : null}
    <p>历史统计使用当前可得修订版本；评分反转与饱和只是尺度诊断，不能直接称为经济预警误报。信息截止日和原值不因校准改变，分数差异属于方法修订。</p>
  </details>;
}

function MacroCalibrationOverview() {
  const review = (framework as unknown as Record<string, unknown>).calibrationReview;
  if (!isRecord(review)) return null;
  return <div className="macro-v1-rating-note" aria-label="本版评分尺度校准">
    <strong>{textValue(review.summary) ?? `尺度复核 ${formatRaw(review.reviewedCount)} 项 · 调整 ${formatRaw(review.adjustedCount)} 项 · 保留 ${formatRaw(review.retainedCount)} 项`}</strong>
    {textValue(review.scope) ? <span>{textValue(review.scope)}</span> : null}
    <span>逐项展开可查看样本范围、候选对比和保留或调整的理由。短样本不强行收窄；政策与杠杆证据项不制造小数精度。</span>
    <span>{textValue(review.method)}</span>
  </div>;
}

function readScoreAnchors(value: unknown): ScoreAnchor[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const anchors: ScoreAnchor[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "number" || !Number.isFinite(entry[0]) || typeof entry[1] !== "number" || !Number.isFinite(entry[1]) || entry[1] < 1 || entry[1] > 5) return null;
    if (anchors.length && entry[0] <= anchors[anchors.length - 1][0]) return null;
    anchors.push([entry[0], entry[1]]);
  }
  return anchors;
}

function readScoreComponents(value: unknown): ScoreComponent[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const components: ScoreComponent[] = [];
  const keys = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== "string" || !entry.key.trim() || keys.has(entry.key) || typeof entry.label !== "string" || !entry.label.trim() || typeof entry.weight !== "number" || !Number.isFinite(entry.weight) || entry.weight <= 0 || entry.weight > 1) return null;
    if (entry.scoreTransform !== undefined && entry.scoreTransform !== "calendar-month-average"
      || entry.scoreTransform === "calendar-month-average" && (entry.unit !== "亿元" || entry.anchorUnit !== "亿元/月")) return null;
    const anchors = readScoreAnchors(entry.anchors);
    if (!anchors) return null;
    keys.add(entry.key);
    components.push({ key: entry.key, label: entry.label, weight: entry.weight, anchors, ...(typeof entry.unit === "string" ? { unit: entry.unit } : {}), ...(typeof entry.basis === "string" ? { basis: entry.basis } : {}), ...(typeof entry.input === "string" ? { input: entry.input } : {}), ...(typeof entry.anchorUnit === "string" ? { anchorUnit: entry.anchorUnit } : {}), ...(entry.scoreTransform === "calendar-month-average" ? { scoreTransform: entry.scoreTransform } : {}) });
  }
  return Math.abs(components.reduce((sum, entry) => sum + entry.weight, 0) - 1) < 1e-9 ? components : null;
}

function weightedScoreComponents(item: MacroRule): ScoreComponent[] | null {
  const rule = item as unknown as Record<string, unknown>;
  const scoring = isRecord(rule.scoring) ? rule.scoring : null;
  return scoring?.method === "weighted-components" ? readScoreComponents(scoring.components) : null;
}

function visibleScoreComponents(item: MacroRule): ScoreComponent[] | null {
  return (item as unknown as Record<string, unknown>).displayComponents === true ? weightedScoreComponents(item) : null;
}

function hasRetainedLoanPrimaryValue(item: MacroRule) {
  const components = visibleScoreComponents(item);
  return ["F01", "F02"].includes(item.id) && item.unit === "亿元" && components?.length === 2
    && components.every((component) => component.unit === "亿元" && component.input === `observation.scoringInputs.${component.key}`);
}

function componentInput(component: ScoreComponent, observation: Observation | null | undefined) {
  const value = component.input === "observation.value" ? observation
    : component.input === undefined || component.input === `observation.scoringInputs.${component.key}` ? observation?.scoringInputs?.[component.key] : null;
  return isRecord(value) ? value : null;
}

function componentScoreDetails(component: ScoreComponent, input: Record<string, unknown> | null, details: ComponentDetails | null | undefined) {
  const saved = details?.components?.find((entry) => entry.key === component.key);
  if (!input || typeof input.value !== "number" || !Number.isFinite(input.value) || !saved
    || typeof saved.points !== "number" || !Number.isFinite(saved.points) || saved.points < 1 || saved.points > 5
    || typeof saved.value !== "number" || !Number.isFinite(saved.value) || typeof saved.weight !== "number" || !Number.isFinite(saved.weight)
    || Math.abs(saved.value - input.value) >= 1e-6 || Math.abs(saved.weight - component.weight) >= 1e-9) return null;
  if (component.scoreTransform === "calendar-month-average") {
    const month = typeof input.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.period) ? Number(input.period.slice(5)) : null;
    if (month === null || input.unit !== "亿元" || saved.scoreTransform !== component.scoreTransform
      || saved.scoreUnit !== component.anchorUnit || typeof saved.scoreValue !== "number" || !Number.isFinite(saved.scoreValue)
      || Math.abs(saved.scoreValue - input.value / month) >= 1e-6) return null;
  }
  return saved;
}

function MacroComponentScoreInput({ component, input, details }: { component: ScoreComponent; input: Record<string, unknown> | null; details: ComponentDetails | null | undefined }) {
  if (component.scoreTransform !== "calendar-month-average") return null;
  const saved = componentScoreDetails(component, input, details);
  const month = typeof input?.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.period) ? Number(input.period.slice(5)) : null;
  return <span style={{ display: "grid", gap: 3 }} aria-label={`${component.label}评分输入`}><small>评分输入：{saved ? `${formatRaw(saved.scoreValue)}${saved.scoreUnit}` : "待核验，不补算"}</small><small>累计差 ÷ 已过月份{month ? `（${month}个月）` : "（月份待核验）"}；原值亿元保持不变。</small></span>;
}

function componentPeriod(component: ScoreComponent, input: Record<string, unknown> | null) {
  const period = textValue(input?.period);
  const basis = component.basis ?? textValue(input?.basis) ?? "";
  if (period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && basis.includes("累计")) return `${period.slice(0, 4)}-01—${period}`;
  const raw = isRecord(input?.rawEvidence) ? input.rawEvidence : null;
  if (component.key === "quarterYoyChange" && isRecord(raw?.current) && isRecord(raw?.preceding)
    && typeof raw.current.period === "string" && /^\d{4}-Q[1-4]$/.test(raw.current.period)
    && typeof raw.preceding.period === "string" && /^\d{4}-Q[1-4]$/.test(raw.preceding.period)) return `${raw.preceding.period} → ${raw.current.period}`;
  const sourceParts = Array.isArray(raw?.components) ? raw.components : Array.isArray(input?.components) ? input.components : [];
  const periods = sourceParts.map((part) => isRecord(part) ? textValue(part.period) : null);
  const monthIndex = (value: string | null) => value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) : null;
  const indexes = periods.map(monthIndex);
  if (basis.includes("近3月") && [3, 6].includes(periods.length) && periods.at(-1) === period
    && indexes.every((value, index) => value !== null && (index === 0 || value === (indexes[index - 1] ?? -2) + 1))) {
    if (periods.length === 3) return `${periods[0]}—${periods[2]}`;
    if (component.key === "nonOverlappingThreeMonthChange") return `${periods[0]}—${periods[2]} → ${periods[3]}—${periods[5]}`;
  }
  return period ?? "待核验";
}

/** Visible subrows allocate an existing indicator's weight; they are never extra indicators. */
export function MacroScoreComponentRows({ item, observation, details, onViewStandard, allComponents = false }: {
  item: MacroRule; observation: Observation | null | undefined; details: ComponentDetails | null | undefined; onViewStandard?: (ruleId: string) => void; allComponents?: boolean;
}) {
  const components = allComponents ? weightedScoreComponents(item) : visibleScoreComponents(item);
  if (!components) return null;
  return <>{components.map((component) => {
    const input = componentInput(component, observation);
    const points = componentScoreDetails(component, input, details)?.points ?? null;
    const source = textValue(input?.sourceUrl);
    return <tr key={component.key} className="macro-score-component-row" data-macro-component={component.key} data-macro-parent={item.id} aria-label={`${item.name} · ${component.label}`}>
      <td><strong>{component.label}</strong><small>计分子项</small>{onViewStandard ? <small><button type="button" onClick={() => onViewStandard(item.id)} aria-label={`查看${item.name}${component.label}评分标准`}>查看子项标准</button></small> : null}</td>
      <td><strong>{formatTotalWeight(item.weight * component.weight)}</strong><small>项内 {percent(component.weight)} · 已包含在父项</small></td>
      <td>{componentPeriod(component, input)}</td>
      <td>{input && typeof input.value === "number" && Number.isFinite(input.value) ? `${formatRaw(input.value)}${textValue(input.unit) ?? component.unit ?? ""}` : "—"}<small>{component.basis ?? textValue(input?.basis) ?? "口径待核验"}</small>{item.id === "E01" && component.key === "quarterYoyChange" ? <small>同比增速较前季变动，不是实际GDP季调环比。</small> : null}<MacroComponentScoreInput component={component} input={input} details={details} /></td>
      <td>{points === null ? "待核验，不计分" : `${formatScore(points)} 分`}</td>
      <td>{source ? <a href={source} target="_blank" rel="noreferrer">子项原文 ↗</a> : "待补原文"}{textValue(input?.releaseDate) ? <small>发布 {textValue(input?.releaseDate)} · 核验 {textValue(input?.verifiedAt) ?? "未记录"}</small> : null}</td>
    </tr>;
  })}</>;
}

export function MacroCompositeFormula({ item, observation, details, points }: { item: MacroRule; observation: Observation | null | undefined; details: ComponentDetails | null | undefined; points: number | null }) {
  const components = weightedScoreComponents(item);
  if (!components) return <div className="macro-score-composition" aria-label={`${item.name}合成公式`}><strong>合成待核验</strong><p>分量定义或固定配比不完整，不补算。</p></div>;
  const scores = components.map((component) => componentScoreDetails(component, componentInput(component, observation), details));
  const weightedTotal = scores.every((score) => score !== null)
    ? scores.reduce((sum, score, index) => sum + (score?.points ?? 0) * components[index].weight, 0) : null;
  const complete = points !== null && typeof details?.points === "number" && Number.isFinite(details.points)
    && Math.abs(details.points - points) < 1e-6 && weightedTotal !== null && Math.abs(weightedTotal - details.points) < 1e-6;
  return <div className="macro-score-composition" aria-label={`${item.name}合成公式`}>
    {complete ? <><p><strong>合成：</strong>{scores.map((score, index) => `${formatScore(score?.points ?? null)} × ${percent(components[index].weight)}`).join(" ＋ ")} ＝ {formatScore(points)} 分</p><small>按未舍入分量合成，上式仅显示两位小数。</small></> : <><strong>合成待核验</strong><p>固定配比：{components.map((component) => `${component.label}得分 × ${percent(component.weight)}`).join(" ＋ ")}。</p><small>本期分量原值、得分或合成结果尚未完整核验，不展示完整数值算式、不补分或重分权。</small></>}
  </div>;
}

export function MacroVisibleScoreComponents({ item, observation, details }: { item: MacroRule; observation: Observation | null | undefined; details: ComponentDetails | null | undefined }) {
  if (!visibleScoreComponents(item)) return null;
  return <div className="table-wrap macro-v1-input-table" aria-label={`${item.name}可见子项`}><p>子项分列 · 各子项折算权重合计为父项 {formatTotalWeight(item.weight)}，不另加总权重。</p>{hasRetainedLoanPrimaryValue(item) ? <p>当前两项均为同比多增或少增金额，不是贷款余额或同比百分比；保留的历史近3月主值不参与本版双口径合成。</p> : null}<table className="dense-table"><thead><tr><th>评分子项</th><th>折算总分权重</th><th>统计期</th><th>原值与口径</th><th>子项得分</th><th>原始来源</th></tr></thead><tbody><MacroScoreComponentRows item={item} observation={observation} details={details} /></tbody></table></div>;
}

function MacroDualBasisPending() {
  const review = (framework as unknown as Record<string, unknown>).dualBasisReview;
  const pending = isRecord(review) && Array.isArray(review.pending) ? review.pending.filter(isRecord) : [];
  if (!pending.length) return null;
  const rows = pending.map((item) => {
    const id = textValue(item.id);
    const rule = framework.indicators.find((entry) => entry.id === id);
    const observation = id ? observations[id] : null;
    const points = rule ? scoreIndicator(rule, observation, current.asOf, framework.freshness) : null;
    const period = observation?.period;
    const cumulativePeriod = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? `${period.slice(0, 4)}-01—${period}` : period ?? "待核验";
    return { item, id, rule, observation, points, cumulativePeriod };
  });
  const scoredCount = rows.filter((row) => row.points !== null).length;
  return <section className="macro-v1-rating-note" aria-label="双口径计划未启用清单">
    <strong>官方累计已计分 · 单月补充待核验</strong>
    <span>{scoredCount ? `${scoredCount}项现已采用官方累计数据参与本期评分；` : "累计数据的核验与计分状态见下表；"}这里待补仅指新增单月。现有可核验口径及其得分继续保留，不用累计增速相减伪造单月同比，尚未核验的单月不补值、不补分。</span>
    <div className="table-wrap"><table className="dense-table"><thead><tr><th>待补单月的指标</th><th>已采用的官方累计数据</th><th>建议累计 / 当月配比</th><th>新增单月待核验原因</th></tr></thead><tbody>{rows.map(({ item, id, rule, observation, points, cumulativePeriod }, index) => <tr key={id ?? index} data-macro-pending={id ?? undefined}>
      <td>{textValue(item.name) ?? rule?.name ?? "指标待确认"}</td>
      <td>{rule && observation ? <><strong>{formatObservationValue(rule, observation)}</strong><small style={{ display: "block" }}>年初累计 · {cumulativePeriod} · {points === null ? "待核验，不计分" : `${formatScore(points)} 分，已参与本期评分`}</small>{observation.sourceUrl ? <a href={observation.sourceUrl} target="_blank" rel="noreferrer">官方累计原文 ↗</a> : "原始来源待核验"}<small style={{ display: "block" }}>发布 {observation.releaseDate} · 现有总分权重 {formatTotalWeight(rule.weight)}</small></> : "尚无可展示的已核验累计观测，不补原值或得分"}</td>
      <td>{textValue(item.proposedAllocation) ?? "配比待核验"}<small style={{ display: "block" }}>待核验，未用于计分</small></td>
      <td>新增单月：{textValue(item.reason)?.replace(/计划未启用/g, "新增单月口径未启用") ?? "可比单月原值仍待完整核验"}</td>
    </tr>)}</tbody></table></div>
  </section>;
}

function MacroScoreCurve({ anchors, label, unit, transformedInput = false }: { anchors: ScoreAnchor[]; label: string; unit: string; transformedInput?: boolean }) {
  const minimum = anchors[0][0];
  const maximum = anchors[anchors.length - 1][0];
  const x = (value: number) => 32 + ((value - minimum) / (maximum - minimum)) * 286;
  const y = (value: number) => 116 - ((value - 1) / 4) * 96;
  return <div aria-label={`${label}评分锚点`}>
    <svg viewBox="0 0 350 144" role="img" aria-label={`${label}连续评分曲线，锚点间线性插值`} style={{ display: "block", width: "100%", maxWidth: 520, height: "auto" }}>
      <title>{`${label}连续评分曲线`}</title>
      <line x1="32" x2="318" y1={y(3)} y2={y(3)} stroke="var(--line)" strokeDasharray="4 4" />
      <line x1="32" x2="32" y1="20" y2="116" stroke="var(--line)" />
      {[1, 3, 5].map((value) => <text key={value} x="23" y={y(value) + 4} textAnchor="end" fontSize="10" fill="currentColor">{formatScore(value)}</text>)}
      <polyline points={anchors.map(([value, points]) => `${x(value)},${y(points)}`).join(" ")} fill="none" stroke="var(--teal)" strokeWidth="2" />
      {anchors.map(([value, points], index) => <circle key={index} cx={x(value)} cy={y(points)} r="3" fill="var(--teal)"><title>{`${formatRaw(value)}${unit} → ${formatScore(points)} 分`}</title></circle>)}
      <text x="32" y="136" fontSize="10" fill="currentColor">{formatRaw(minimum)}{unit}</text>
      <text x="318" y="136" textAnchor="end" fontSize="10" fill="currentColor">{formatRaw(maximum)}{unit}</text>
    </svg>
    <div className="table-wrap"><table className="dense-table"><thead><tr><th>{transformedInput ? "评分输入参照点" : "原值评分参照点"}{unit ? `（${unit}）` : "（按该分量口径）"}</th><th>对应分量得分</th></tr></thead><tbody>{anchors.map(([value, points], index) => <tr key={index}><td>{formatRaw(value)}</td><td>{formatScore(points)} 分</td></tr>)}</tbody></table></div>
  </div>;
}

function MacroEvidenceRecord({ record, label }: { record: unknown; label: string }) {
  if (!isRecord(record)) return <p><strong>{label}：</strong>尚无可展示的原始证据；不据此补分。</p>;
  const source = textValue(record.sourceUrl);
  const raw = typeof record.value === "number" && record.basis === "年初累计分行业利润改善广度" ? formatScore(record.value) : formatRaw(record.value);
  const value = typeof record.value === "number" || typeof record.value === "string" ? `${raw}${textValue(record.unit) ?? ""}` : null;
  return <p><strong>{textValue(record.metric) ?? label}：</strong>{value ?? textValue(record.finding) ?? textValue(record.summary) ?? "已记录证据，未另设量化原值"}{textValue(record.period) ? ` · ${record.period}` : ""}{textValue(record.basis) ? <><br />口径：{String(record.basis)}</> : null}{textValue(record.originalPublisher) ? <><br />原发布方：{String(record.originalPublisher)}</> : null}{textValue(record.releaseDate) ? ` · 发布 ${record.releaseDate}` : ""}{textValue(record.verifiedAt) ? ` · 核验 ${record.verifiedAt}` : ""}{source ? <> · <a href={source} target="_blank" rel="noreferrer">原始来源 ↗</a></> : null}</p>;
}

export function MacroProfitBreadthSummary({ observation, asOf = current.asOf }: { observation: Observation | null | undefined; asOf?: string | null }) {
  if (!observation || validateStandaloneProfitBreadthObservation(observation, asOf) === null) return <small>行业明细待完整核验；缺失行业不算下降，不缩小41行业分母。</small>;
  const rows = (observation.rawEvidence?.industries as Record<string, unknown>[]);
  let improving = 0, declining = 0, flat = 0;
  for (const row of rows) {
    if (typeof row.officialYoyPct === "number") {
      if (row.officialYoyPct > 0) improving += 1;
      else if (row.officialYoyPct < 0) declining += 1;
      else flat += 1;
    } else if (isRecord(row.officialSpecialChange)) {
      if (["turnaround", "lossReduction"].includes(String(row.officialSpecialChange.type))) improving += 1;
      else declining += 1;
    }
  }
  return <small aria-label="行业利润改善广度本期摘要"><strong>改善 {improving}/41 行业</strong> · 下降 {declining}/41 行业 · 持平 {flat}/41 行业<br />改善包含增长、扭亏或减亏；下降包含利润下降、增亏或由盈转亏。利润下降不等于亏损，仅代表全国规模以上工业企业。</small>;
}

function MacroEvidenceGroup({ group, label }: { group: unknown; label: string }) {
  if (!isRecord(group)) return null;
  const evidence = Array.isArray(group.evidence) ? group.evidence : [];
  const limitations = Array.isArray(group.limitations) ? group.limitations.filter((value): value is string => typeof value === "string") : textValue(group.limitations) ? [String(group.limitations)] : [];
  return <section aria-label={label}><p><strong>{label}</strong></p>{evidence.map((record, index) => <MacroEvidenceRecord key={index} record={record} label={`${label}原始证据`} />)}{limitations.length ? <p>局限：{limitations.join("；")}</p> : null}</section>;
}

function MacroDerivedEvidence({ evidence }: { evidence: Record<string, unknown> }) {
  const rawFormula = textValue(evidence.formula);
  const formula = rawFormula === "current.value - preceding.value" ? "本季单季实际同比 − 前季单季实际同比" : rawFormula;
  return <>
    {formula ? <p>公式：{formula}</p> : null}
    {isRecord(evidence.current) ? <MacroEvidenceRecord record={evidence.current} label="本季单季实际同比原值" /> : null}
    {isRecord(evidence.preceding) ? <MacroEvidenceRecord record={evidence.preceding} label="前季单季实际同比原值" /> : null}
    {typeof evidence.reportedYoyPct === "number" ? <p>官方直接公布的可比同比：{formatRaw(evidence.reportedYoyPct)}%</p> : null}
    {typeof evidence.currentProfitMargin === "number" ? <p>当期营业收入利润率：{formatRaw(evidence.currentProfitMargin)}{textValue(evidence.unit) ?? "%"}</p> : null}
    {typeof evidence.currentReceivablesDays === "number" ? <p>当期应收账款平均回收期：{formatRaw(evidence.currentReceivablesDays)}{textValue(evidence.unit) ?? "天"}</p> : null}
    {typeof evidence.reportedYoyChange === "number" ? <p>官方直接公布的同比变动：{formatRaw(evidence.reportedYoyChange)}{textValue(evidence.reportedChangeUnit) ?? "（单位待核验）"}</p> : null}
    {textValue(evidence.aggregation) ? <p>统计范围：{String(evidence.aggregation)}</p> : null}
    {evidence.notDerivedFromPublishedAmounts === true ? <p>采用本期原文直接公布的可比增速，不从不同报告中的刊载金额相减。</p> : null}
    {textValue(evidence.comparability) ? <p>可比性说明：{String(evidence.comparability)}</p> : null}
    {isRecord(evidence.currentNominal) ? <>
      <p>平减指数同比复算：（本季现价GDP ÷ 上年同季现价GDP ÷（实际GDP同比指数 ÷ 100）− 1）× 100；三季必须采用同一修订版本。</p>
      {textValue(evidence.revisionVersion) ? <p>原值修订版本：{String(evidence.revisionVersion)}</p> : null}
      <MacroEvidenceRecord record={evidence.currentNominal} label="该季现价GDP" />
      <MacroEvidenceRecord record={evidence.priorNominal} label="上年同季现价GDP" />
      <MacroEvidenceRecord record={evidence.realGrowth} label="该季实际GDP同比" />
      <MacroEvidenceRecord record={evidence.realYoyIndex} label="该季实际GDP同比指数" />
    </> : null}
    {Array.isArray(evidence.industries) ? <>
      <p>固定41个工业大类，按官方累计可比同比及负基期特殊事实计算改善广度；利润下降不等于亏损，行业合计盈利不代表所有企业盈利。</p>
      {isRecord(evidence.growthContribution) ? <><MacroEvidenceRecord record={evidence.growthContribution} label="电子行业对总利润增长的贡献率（不是利润总额份额）" /><p>贡献集中仅作结构解释，不因这一数值再额外扣分。</p></> : null}
      <div className="table-wrap"><table className="dense-table"><caption>分行业原值 · {evidence.industries.length}/41行业；不代表服务业或全部企业</caption>
        <thead><tr><th>工业行业</th><th>利润总额（亿元）</th><th>可比同比或官方特殊事实</th></tr></thead>
        <tbody>{evidence.industries.filter(isRecord).map((row, index) => <tr key={index}><td>{textValue(row.name) ?? "行业待核验"}</td><td>{typeof row.profit === "number" ? formatRaw(row.profit) : "缺失"}</td><td>{typeof row.officialYoyPct === "number" ? `${formatRaw(row.officialYoyPct)}%` : isRecord(row.officialSpecialChange) ? textValue(row.officialSpecialChange.originalText) ?? "负基期特殊变化待核验" : "待核验"}</td></tr>)}</tbody>
      </table></div>
    </> : null}
    {Array.isArray(evidence.components) ? evidence.components.map((record, index) => <MacroEvidenceRecord key={index} record={record} label="派生计算原值" />) : null}
  </>;
}

export function MacroScoringMatrixEvidence({ matrix, states }: { matrix: unknown; states?: Record<string, unknown>[] }) {
  if (!isRecord(matrix)) return <p><strong>杠杆证据矩阵：</strong>本期尚无完整矩阵可展示，不以杠杆率高低单独打分。</p>;
  const domestic = isRecord(matrix.domestic) ? matrix.domestic : null;
  const international = isRecord(matrix.international) ? matrix.international : null;
  const benchmark = isRecord(international?.benchmark) ? international.benchmark : null;
  const counterEvidence = isRecord(matrix.counterEvidence) ? matrix.counterEvidence : null;
  const servicing = isRecord(matrix.servicing) ? matrix.servicing : null;
  const denominator = isRecord(domestic?.nominalGdpEffect) ? domestic.nominalGdpEffect : null;
  const matchedState = states?.find((entry) => entry.code === matrix.matchedState);
  const benchmarkLimitations = Array.isArray(international?.limitations) ? international.limitations.filter((value): value is string => typeof value === "string") : textValue(international?.limitations) ? [String(international?.limitations)] : [];
  return <div className="macro-v1-matrix-evidence"><p><strong>本期杠杆约束证据矩阵</strong>{textValue(matrix.reviewDate) ? ` · 复核 ${matrix.reviewDate}` : ""}</p>{matchedState ? <p>匹配证据状态：{String(matchedState.label)} · {formatScore(typeof matrix.computedScore === "number" ? matrix.computedScore : null)} 分</p> : null}{textValue(matrix.objective) ? <p>评价目标：{String(matrix.objective)}</p> : null}{textValue(matrix.scoreReason) ? <p>匹配理由：{String(matrix.scoreReason)}</p> : null}
    <section aria-label="国内杠杆与分母背景"><p><strong>国内杠杆与分母背景</strong></p><MacroEvidenceRecord record={domestic?.current} label="本季杠杆率" /><MacroEvidenceRecord record={domestic?.yearAgo} label="上年同季杠杆率" /><MacroEvidenceRecord record={domestic?.quarterAgo} label="上季度杠杆率" /><MacroEvidenceRecord record={domestic?.debtGrowth} label="债务增速" />{typeof domestic?.yearOnYearChangePp === "number" ? <p>同比变动：{formatRaw(domestic.yearOnYearChangePp)}个百分点；仅作同源复算，不将低杠杆机械等同高分。</p> : null}{textValue(denominator?.summary) ? <p>名义GDP分母效应：{String(denominator?.summary)}</p> : null}{Array.isArray(denominator?.evidence) ? denominator.evidence.map((record, index) => <MacroEvidenceRecord key={index} record={record} label="分母效应证据" />) : null}</section>
    <section aria-label="国际基准及其局限"><p><strong>国际基准及其局限</strong></p><p>主要参照：{matrix.primaryReference === "BIS-emerging-ex-China" ? "BIS同源同季新兴经济体（剔除中国）" : "按本版规则预先指定的同源部门对照组"}；国际相对位置只作负担背景，不是安全阈值或直接偿债能力评分，国内和国际统计口径不混算。</p><MacroEvidenceRecord record={international?.china} label="BIS中国同源杠杆率" />{benchmark ? <p>对照经济体 {formatRaw(benchmark.n)} 个 · 中位数 {formatRaw(benchmark.median)}% · 中国相对位置 {formatRaw(benchmark.percentile)} 百分位</p> : null}{benchmarkLimitations.length ? <p>基准局限：{benchmarkLimitations.join("；")}</p> : null}{isRecord(international?.classification) ? <MacroEvidenceRecord record={international.classification} label="对照组分类依据" /> : null}{Array.isArray(international?.peers) ? <details><summary>检视同源对照原值 · {international.peers.length}个经济体</summary>{international.peers.map((record, index) => <MacroEvidenceRecord key={index} record={record} label="对照经济体杠杆率" />)}</details> : null}</section>
    <MacroEvidenceGroup group={matrix.incomeOrProfit} label="收入或盈利承接" /><MacroEvidenceGroup group={servicing} label="偿债负担与代理证据" />{servicing?.proxyOnly === true || servicing?.directSectorData === false ? <p><strong>偿债资料限制：</strong>目前使用代理证据；没有同口径部门直接偿债率，不能把新贷利率或私人非金融部门合计DSR当作居民、企业各自的直接偿付数据。</p> : null}<MacroEvidenceGroup group={matrix.pressure} label="资产与需求约束" />
    {counterEvidence ? <section aria-label="正反证据"><p><strong>正反证据</strong></p>{Array.isArray(counterEvidence.positive) ? counterEvidence.positive.map((record, index) => <MacroEvidenceRecord key={`positive-${index}`} record={record} label="缓和约束的证据" />) : null}{Array.isArray(counterEvidence.negative) ? counterEvidence.negative.map((record, index) => <MacroEvidenceRecord key={`negative-${index}`} record={record} label="约束或反向证据" />) : null}{Array.isArray(counterEvidence.limitations) ? <p>研判局限：{counterEvidence.limitations.filter((value): value is string => typeof value === "string").join("；")}</p> : textValue(counterEvidence.limitations) ? <p>研判局限：{String(counterEvidence.limitations)}</p> : null}</section> : null}
  </div>;
}

export function MacroRuleScoring({ item, observation, details }: { item: MacroRule; observation: Observation | null | undefined; details?: ComponentDetails | null }) {
  const rawScoring: unknown = "scoring" in item ? item.scoring : undefined;
  const scoring = isRecord(rawScoring) ? rawScoring : null;
  const description = textValue(scoring?.description);
  if (scoring?.method === "piecewise-linear") {
    const anchors = readScoreAnchors(scoring.anchors);
    if (!anchors) return <p><strong>连续评分方法待核验：</strong>锚点缺失或格式不符合要求；不以旧五档文案代替连续算法。</p>;
    return <div className="macro-v1-continuous-rule"><p><strong>连续评分标准：</strong>按下列原值—得分锚点逐段线性插值；区间内得分连续变化，超出首尾锚点沿用相邻端点得分，结果范围为1.00—5.00分。显示两位小数，计算保留原始精度，不先把原值取整或重新分档。</p>{description ? <p>{description}</p> : null}<p>区间算法：s = s₀ + (x − x₀) ÷ (x₁ − x₀) × (s₁ − s₀)。下表是真实计算锚点，不是五个离散分档；1—5仍用于解释较弱至较强条件。</p><MacroScoreCurve anchors={anchors} label={item.name} unit={item.unit} />{item.id === "G19" ? <><MacroEvidenceRecord record={observation} label="本期行业利润改善广度原值" /><MacroProfitBreadthSummary observation={observation} />{isRecord(observation?.rawEvidence) ? <details><summary>检视41行业原表与改善广度依据</summary><MacroDerivedEvidence evidence={observation.rawEvidence} /></details> : null}</> : null}</div>;
  }
  if (scoring?.method === "weighted-components") {
    const components = readScoreComponents(scoring.components);
    if (!components) return <p><strong>复合评分方法待核验：</strong>分量、权重或曲线不完整；不以单一原值或旧五档文案补算。</p>;
    const scoreDetails = details === undefined && components.some((component) => component.scoreTransform)
      ? continuousScoreDetails(item, observation, current.asOf) : details;
    return <div className="macro-v1-continuous-rule"><p><strong>分量加权连续评分：</strong>各分量按自身锚点逐段线性插值后，按固定项内权重合计。下方参照点对应各分量得分，不是综合单项分。项内权重合计100%，并非占宏观总分的权重；缺少规定原值或口径核验不通过，不自动重分权或补分。超出曲线首尾锚点沿用相邻端点得分，合成后显示两位小数，计算不提前取整。</p>{description ? <p>{description}</p> : null}{item.id === "G02" && !components.some((component) => component.key === "industryProfitImprovementBreadth") && framework.indicators.some((rule) => rule.id === "G19") ? <p>盈利增长与质量单独评分；行业改善广度见独立指标 G19，不在本项重复计分。</p> : null}{components.map((component) => {
      const duplicate = observation?.scoringInputs?.[component.key];
      const input = componentInput(component, observation);
      const unit = component.anchorUnit ?? textValue(input?.unit) ?? component.unit ?? "";
      const rawEvidence = isRecord(input?.rawEvidence) ? input.rawEvidence : isRecord(input?.gdpDeflatorEvidence) ? input.gdpDeflatorEvidence : component.input === "observation.value" && isRecord(duplicate) && isRecord(duplicate.rawEvidence) ? duplicate.rawEvidence : null;
      return <section key={component.key} aria-label={`${component.label}评分分量`}><p><strong>{component.label} · 固定项内权重 {percent(component.weight)}</strong>{visibleScoreComponents(item) ? <><br />折算总分权重 {formatTotalWeight(item.weight * component.weight)} · 已包含在父项，不另加权</> : null}{component.basis ? <><br />分量口径：{component.basis}</> : null}</p><MacroEvidenceRecord record={input} label={`${component.label}本期原值`} />{component.scoreTransform ? <p><MacroComponentScoreInput component={component} input={input} details={scoreDetails} /><br />下面横轴为评分输入（{unit}），不是累计原始金额；除以已过月份仅统一年内不同月份的评分尺度，不生成滚动分量。</p> : null}<MacroScoreCurve anchors={component.anchors} label={component.label} unit={unit} transformedInput={Boolean(component.scoreTransform)} />{rawEvidence ? <details><summary>检视{component.label}派生原值与公式</summary><MacroDerivedEvidence evidence={rawEvidence} /></details> : null}</section>;
    })}</div>;
  }
  if (rawScoring !== undefined && rawScoring !== null && scoring?.method !== "evidence-matrix" && scoring?.method !== "evidence-rubric") return <p><strong>评分方法待核验：</strong>当前规则没有可确认的展示算法；不自动当作整数五档评分，也不补算当前分。</p>;
  const isMatrix = scoring?.method === "evidence-matrix";
  const states = isMatrix && Array.isArray(scoring?.states) ? scoring.states.filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.score === "number" && Number.isFinite(entry.score) && entry.score >= 1 && entry.score <= 5 && Boolean(textValue(entry.code)) && Boolean(textValue(entry.label)) && Boolean(textValue(entry.description))) : [];
  const evidenceRequirements = Array.isArray(scoring?.evidenceRequirements) ? scoring.evidenceRequirements.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
  return <div className="macro-v1-evidence-rule"><p><strong>五档评分标准：</strong>{isMatrix ? "证据矩阵在1—5分语义下按预设条件匹配；半档只能由固定证据状态触发，不是对分析者信心做任意插值。" : item.mode === "原文研判" || scoring?.method === "evidence-rubric" ? "按完整证据选择整数档位，不由文件数量、措辞强弱或主观小数插值产生分数。" : "本项沿用五档离散规则，不对相邻档自行插值。"}</p>{description ? <p>{description}</p> : null}<ol>{item.grades.map((grade, index) => <li key={index}><b>{formatScore(index + 1)} 分</b><span>{grade}</span></li>)}</ol>{states.length ? <div className="table-wrap"><table className="dense-table"><caption>预设证据状态与半档触发条件</caption><thead><tr><th>得分与状态</th><th>必须满足的证据条件</th></tr></thead><tbody>{states.map((state) => <tr key={String(state.code)}><td>{formatScore(Number(state.score))} 分 · {String(state.label)}</td><td>{String(state.description)}</td></tr>)}</tbody></table></div> : null}{evidenceRequirements.length ? <p><strong>矩阵证据门槛：</strong>{evidenceRequirements.join("；")}</p> : null}{isMatrix ? <MacroScoringMatrixEvidence matrix={observation?.scoringMatrix} states={states} /> : null}</div>;
}

function MacroPillarWeights({ pillar }: { pillar: string }) {
  const summary = summarizePillarWeights(framework, pillar);
  const profitRules = framework.indicators.filter((item) => ["G02", "G19"].includes(item.id));
  return <div className="macro-v1-rating-note macro-v1-weight-summary" aria-label={`${pillar}权重划分`}>
    <strong>{pillar} · {summary.count}项 · 总分权重{formatTotalWeight(summary.weight)}</strong>
    <div className="macro-v1-weight-groups">{summary.groups.map((group) => {
      return <p key={group.name}><strong>{group.name}</strong><span>{group.count}项 · 总分权重 {formatTotalWeight(group.weight)}</span></p>;
    })}</div>
    <details className="macro-rating-help"><summary>{pillar === "宏观调控" ? "权重口径与政策研判说明" : "权重口径说明"}</summary><div className="macro-v1-rating-note"><span>以上均为占宏观总分的权重；细分权重按当前评分指标自动汇总，不是组内百分比。权重与评分标准仍属试行，未核验指标不默认补中性分；符合单独证据门槛的研究暂评须明确标注。</span><span>{describePillarRole(pillar).kind}：{describePillarRole(pillar).description}</span>{pillar === "增长动力" && profitRules.length === 2 ? <span>盈利增长与质量、行业利润改善广度分别计分；两项合计占宏观总分 {formatTotalWeight(profitRules.reduce((sum, item) => sum + item.weight, 0))}，总量和质量不重复计入广度。</span> : null}{pillar === "宏观调控" ? <MacroPolicyMethod /> : null}</div></details>
  </div>;
}

function MacroPolicyMethod() {
  return <>
    <span>{framework.policyMethod.summary} {framework.policyMethod.highScore}</span>
    <span>{framework.policyMethod.review} {framework.policyMethod.continuity}</span>
    <span>原文研判不是自动量化结果：须记录评价范围、实施条件、正反证据与判断理由；公开证据不足保持待核验，不补中性分。{framework.policyMethod.interpretation}</span>
    {framework.researchAssessmentPolicy.enabled ? <span><strong>{framework.researchAssessmentPolicy.label}：</strong>{framework.researchAssessmentPolicy.definition} {framework.researchAssessmentPolicy.aggregation}</span> : <span>本版没有研究暂评计分项；准备金使用完整十二个月普遍调整事件账本核验，不沿用旧两端利率暂评。</span>}
  </>;
}

function MacroRatingPageHeader({ kicker, title, lead, detail }: { kicker: string; title: string; lead: string; detail: string }) {
  return <header className="research-header macro-rating-page-header"><div><p className="eyebrow">{kicker} · {framework.version}</p><h2>{title}</h2></div><div className="macro-rating-guide"><p className="macro-rating-guide-lead">{lead}</p><p className="macro-rating-guide-detail">{detail}</p></div></header>;
}

function MacroRatingPageMeta() {
  return <><div className="macro-v1-summary"><strong>试行规则 · {pillarWeightSummary}</strong><span>截止 {current.asOf ?? "未设置"} · 已核验 {ratedCount} / {framework.indicators.length} 项 · 覆盖 {percent(result.coverage)}</span></div>{missingRules.length || research.count > 0 ? <p className="macro-rating-notice" role="status">原值待核验 {missingRules.length} 项{research.count > 0 ? ` · 研究暂评 ${research.count} 项，不计入核验覆盖率` : ""}；缺项不补中性分。</p> : null}</>;
}

function MacroCurrentReviewDetails() {
  return <><div className="macro-v1-rating-note"><strong>本期宏观观察 · {current.asOf ?? "尚未设置截止日"} · {framework.version}</strong><span>{currentDetails.reviewSummary ?? "等待逐项原始数据及证据核验；不补中性分。"}</span></div>{currentDetails.sourceStatus ? <p>{currentDetails.sourceStatus}</p> : null}<ul>{currentDetails.evidenceLimitations?.map((item, index) => <li key={index}>{item.reason}</li>)}</ul>{missingRules.length ? <details className="macro-v1-aux"><summary>原值待补证据 · {missingRules.length} 项{research.count > 0 ? `（已单列暂评${research.count}项）` : "（不默认补分）"}</summary><ul>{missingRules.map((item) => <li key={item.id}><strong>{item.name}</strong>：{currentDetails.gaps?.find((gap) => gap.id === item.id)?.reason ?? "尚无通过本版统计口径及证据核验的观测"}<MacroResearchAssessment assessment={resolveMacroAssessment(framework, current, item).assessment as ResearchAssessment | null} /></li>)}</ul></details> : null}</>;
}

function MacroRatingMethodDetails() {
  return <div className="macro-v1-rating-note"><span>{framework.purpose} 每月观察、每季复核。</span><span>当前 {framework.version} 规则：{framework.status}。逐项标准见本页；本期旧版分数不参与新评级。</span><span>基本面与信用归一分：经济运行、增长动力、金融信贷的已核验贡献除以已核验权重，归一到1—5分；部分覆盖时仅是观察分，不补空值。</span><span>宏观调控支持与制度分：独立观察货币传导、实际财政支出、产业政策与制度条件；支持加码并不等于实体经济已经改善。政策高分不自动判定实际经济改善，最终产出和盈利效果由其他维度后续验证。</span><span>100% 权重核验后才发布正式总分和档位；总覆盖至少 85%、每支柱至少 70% 时仅作暂定观察；不足则显示“资料不足”。缺项不按中性分补齐。</span>{research.count > 0 ? <span>本期 {research.countTotal} / {framework.indicators.length} 项已评分，其中 {ratedCount} 项原值核验、{research.count} 项研究暂评。研究观察分仅按原权重合计，不增加核验覆盖率，不发布正式档位；依据变化或量化缺口补齐后重新复核。</span> : null}<span>{macroRatingTimelinessNote}</span><span>{macroRatingScopeNote}</span></div>;
}

export function MacroRatingWorkbook() {
  const [sheet, setSheet] = useState<(typeof sheetNames)[number]>("评分总览");
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const viewStandard = (ruleId: string) => {
    setSelectedRuleId(ruleId);
    setSheet("评分标准");
  };
  return <div className="macro-rating-workbook">
    <nav className="macro-rating-sheets" aria-label="宏观评级子表">{sheetNames.map((name) => <button key={name} type="button" className={sheet === name ? "active" : ""} onClick={() => setSheet(name)}>{name}</button>)}</nav>
    {sheet === "评分总览" ? <MacroRatingSummary /> : null}
    {sheet === "评分指标" ? <MacroRatingInputs onViewStandard={viewStandard} /> : null}
    {sheet === "评分标准" ? <MacroRatingIndicators selectedRuleId={selectedRuleId} /> : null}
    {sheet === "评分记录" ? <MacroRatingHistory /> : null}
  </div>;
}

export function MacroRatingInputs({ onViewStandard }: { onViewStandard: (ruleId: string) => void }) {
  const [pillar, setPillar] = useState(pillars[0]);
  const rows = framework.indicators.filter((item) => item.pillar === pillar);
  return <section className="macro-v1-sheet">
    <MacroRatingPageHeader kicker="SCORING INDICATORS" title="评分指标" lead="核对当期数据与评分，点击指标查看对应标准" detail="按维度核对统计期、原值与来源；未核验项不补分" />
    <MacroRatingPageMeta />
    <div className="filter-row"><div>{pillars.map((name) => <button key={name} type="button" className={pillar === name ? "active" : ""} onClick={() => setPillar(name)}>{name}</button>)}</div><span>{rows.length} 项核心指标</span></div>
    <MacroPillarWeights pillar={pillar} />
    <div className="table-wrap macro-v1-input-table"><table className="dense-table"><thead><tr><th>指标</th><th>总分权重</th><th>统计期</th><th>观测值／原文分</th><th>核验与评分</th><th>原始来源／理由</th></tr></thead><tbody>{rows.map((item) => {
      const observation = observations[item.id];
      const points = scoreIndicator(item, observation, current.asOf, framework.freshness);
      const resolved = resolveMacroAssessment(framework, current, item);
      const assessment = resolved.assessment as ResearchAssessment | null;
      const componentsVisible = weightedScoreComponents(item);
      const composite = item.scoring?.method === "weighted-components";
      const retainedPrimary = hasRetainedLoanPrimaryValue(item);
      const details = componentsVisible && points !== null ? continuousScoreDetails(item, observation, current.asOf) : null;
      return <Fragment key={item.id}><tr className="macro-score-parent-row"><td><strong>{item.name}</strong><small>{item.id} · {item.group} · {item.frequency}</small>{componentsVisible ? <small>合成项 · 下方子项权重已包含在本项，不重复相加</small> : null}<small><button type="button" onClick={() => onViewStandard(item.id)} aria-label={`查看${item.name}评分标准`}>查看评分标准</button></small></td><td>{formatTotalWeight(item.weight)}</td><td>{observation?.period ?? assessment?.period ?? "待录入"}{retainedPrimary ? <small>当前计分时期见分列子项</small> : null}</td><td>{observation ? <>{retainedPrimary ? "历史主值：" : ""}{formatObservationValue(item, observation)}</> : assessment ? "原值待核验" : "—"}{item.id === "G19" ? <MacroProfitBreadthSummary observation={observation} /> : null}{observation?.leverageRatio !== undefined ? <small>杠杆率 {formatRaw(observation.leverageRatio)}% · 上年同期 {formatRaw(observation.yearAgoLeverageRatio)}%</small> : null}{observation?.scoringInputs ? <small>{retainedPrimary ? "历史主值仅供回溯，不参与当前双口径合成；累计与最新单月原值、得分见下方。" : componentsVisible ? "各口径原值与子项得分分列在下方；本行显示保留的主观测值与合成得分。" : "分量定义待核验，不以单个主值补算复合得分。"}</small> : null}{observation?.scoringMatrix ? <small>国际基准、国内承接与反证见对应评分标准。</small> : null}</td><td>{assessment ? <>{formatScore(assessment.points)} 分 · 研究暂评<small>置信度{assessment.confidence} · 不计入核验覆盖率</small></> : points === null ? "待核验，不计分" : `${formatScore(points)} 分`}{retainedPrimary ? <small>当前双口径合成分</small> : null}</td><td>{observation?.sourceUrl ? <a href={observation.sourceUrl} target="_blank" rel="noreferrer">原文 ↗</a> : assessment?.evidence[0] ? <a href={assessment.evidence[0].sourceUrl} target="_blank" rel="noreferrer">暂评原始依据 ↗</a> : "待补原文"}{observation ? <small>发布 {observation.releaseDate} · 核验 {observation.verifiedAt ?? "未记录"}</small> : null}{observation?.rationale || assessment ? <details className="macro-rating-row-evidence"><summary>评分理由与核验详情</summary>{observation?.rationale ? <p>{observation.rationale}</p> : null}{assessment ? <><p>{assessment.rationale}</p><p>{assessment.thresholdComparison}</p></> : null}</details> : null}</td></tr><MacroScoreComponentRows item={item} observation={observation} details={details} onViewStandard={onViewStandard} allComponents />{composite ? <tr data-macro-formula={item.id} className="macro-score-formula-row"><td colSpan={6}><MacroCompositeFormula item={item} observation={observation} details={details} points={points} /></td></tr> : null}</Fragment>;
    })}</tbody></table></div>
    <MacroDualBasisPending />
    <details className="macro-rating-help"><summary>口径与核验说明</summary><p>按维度核对统计期、数值或政策原文分、发布日期、来源与理由。未核验原值保持空白，不默认补中性分；有独立证据的研究暂评分另列。</p><p>信息截止日：{current.asOf ?? "尚未建立本期"}；已核验 {ratedCount} / {framework.indicators.length} 项，另有研究暂评 {research.count} 项。网页暂不提供直接写入；原值、发布日期、派生计算和研判证据须逐项核对后才参与总览。研究暂评分只进入单列研究观察分，不冒充原值核验评分。本页仅列入计分指标；计划清单不参与计算。新旧指标采用独立编号，不能沿用被替换指标的观测值。{macroRatingTimelinessNote}</p></details>
  </section>;
}

export function MacroRatingIndicators({ selectedRuleId }: { selectedRuleId: string | null }) {
  const [pillar, setPillar] = useState(() => framework.indicators.find((item) => item.id === selectedRuleId)?.pillar ?? pillars[0]);
  useEffect(() => {
    if (!selectedRuleId) return;
    const selected = document.getElementById(`macro-rule-${selectedRuleId}`);
    if (selected instanceof HTMLDetailsElement) {
      selected.open = true;
      selected.scrollIntoView({ block: "nearest" });
    } else selected?.scrollIntoView({ block: "nearest" });
  }, [selectedRuleId, pillar]);
  const visible = [pillar];
  return <section className="macro-v1-sheet macro-v1">
    <MacroRatingPageHeader kicker="SCORING RULES" title="评分标准" lead="按维度查看评分口径与依据" detail="双口径子项直接分列；其余指标展开查看标准" />
    <MacroRatingPageMeta />
    <details className="macro-rating-help"><summary>评级方法、发布门槛与适用范围</summary><MacroRatingMethodDetails /></details>
    <details className="macro-rating-help"><summary>本版尺度校准说明</summary><MacroCalibrationOverview /></details>
    <div className="filter-row"><div>{pillars.map((item) => <button key={item} type="button" className={pillar === item ? "active" : ""} onClick={() => setPillar(item)}>{item}</button>)}</div></div>
    <MacroPillarWeights pillar={pillar} />
    {visible.map((name) => <div className="macro-v1-pillar" key={name}>
      <h3>{name} <span>{percent(framework.pillars[name as keyof typeof framework.pillars])} · {framework.indicators.filter((item) => item.pillar === name).length} 项</span></h3>
      <div className="macro-v1-list">{framework.indicators.filter((item) => item.pillar === name).map((item) => {
        const observation = observations[item.id];
        const points = scoreIndicator(item, observation, current.asOf, framework.freshness);
        const resolved = resolveMacroAssessment(framework, current, item);
        const assessment = resolved.assessment as ResearchAssessment | null;
        if (visibleScoreComponents(item)) return <section className="macro-v1-item" key={item.id} id={`macro-rule-${item.id}`} aria-label={`${item.name}分列评分标准`}>
          <header style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "10px 13px" }}><span className="macro-v1-id">{item.id}</span><span className="macro-v1-item-name" style={{ flex: 1, minWidth: 160 }}><strong>{item.name}</strong><small>{item.group} · {item.frequency} · 合成项，子项不另加总权重</small></span><span className="macro-v1-weight">{formatTotalWeight(item.weight)}</span><span className="macro-v1-pending">{points === null ? "待核验" : `${formatScore(points)} 分`}</span></header>
          <div className="macro-v1-details"><MacroVisibleScoreComponents item={item} observation={observation} details={points !== null ? continuousScoreDetails(item, observation, current.asOf) : null} /><MacroRuleScoring item={item} observation={observation} details={points !== null ? continuousScoreDetails(item, observation, current.asOf) : null} /><details className="macro-rating-row-evidence"><summary>完整评分依据与核验要求</summary><p>{item.definition}</p><MacroRuleBasis item={item} /><MacroRuleRequirements item={item} />{observation?.rationale ? <p>评分理由：{observation.rationale}</p> : null}{"sourceUrl" in item && item.sourceUrl ? <p><a href={item.sourceUrl} target="_blank" rel="noreferrer">口径与原始发布入口 ↗</a></p> : null}</details><MacroResearchAssessment assessment={assessment} /></div>
        </section>;
        return <details className="macro-v1-item" key={item.id} id={`macro-rule-${item.id}`}>
          <summary><span className="macro-v1-id">{item.id}</span><span className="macro-v1-item-name"><strong>{item.name}</strong><small>{item.group} · {item.frequency} · {item.unit}</small>{["G02", "G19"].includes(item.id) && observation ? <small>本期原值 {formatObservationValue(item, observation)} · {observation.period}</small> : null}{item.id === "G19" ? <MacroProfitBreadthSummary observation={observation} /> : null}</span><span className="macro-v1-weight">{formatTotalWeight(item.weight)}</span><span className="macro-v1-pending">{assessment ? `${formatScore(assessment.points)} 分 · 暂评` : points === null ? observation ? "待核验" : "未录入" : `${formatScore(points)} 分`}</span></summary>
          <div className="macro-v1-details"><p>{item.definition}</p><MacroRuleBasis item={item} /><MacroRuleRequirements item={item} /><MacroRuleScoring item={item} observation={observation} />{"sourceUrl" in item && item.sourceUrl ? <p><a href={item.sourceUrl} target="_blank" rel="noreferrer">口径与原始发布入口 ↗</a> · 此链接不代表已录入本期数据。</p> : null}<p>本期：{observation ? `${formatObservationValue(item, observation)} · ${observation.period} · ${points === null ? "未通过核验，不计分" : `已核验 ${formatScore(points)} 分`}` : assessment ? `${assessment.period} · 研究暂评 ${formatScore(assessment.points)} 分；量化原值仍待核验。` : "尚无可核验观测值、统计期及原文；不计分。"}</p>{observation?.sourceUrl ? <a href={observation.sourceUrl} target="_blank" rel="noreferrer">查看原始来源 ↗</a> : null}{observation?.rationale ? <p>评分理由：{observation.rationale}</p> : null}<MacroResearchAssessment assessment={assessment} /></div>
        </details>;
      })}</div>
    </div>)}
    <MacroDualBasisPending />
    <details className="macro-rating-help"><summary>口径与核验说明</summary><p>{framework.indicators.length} 项评分指标。与“评分指标”共享同一套规则；双口径子项直接分列，其他指标展开后可查看权重、统计口径、评分依据、阈值状态、连续锚点或五档证据标准。复合指标逐项展示固定分量权重、原值及证据，杠杆指标展示国际基准与资料局限。本期观测与标准逐项联动，不沿用旧版分数。</p><p>本表采用 {framework.version} 试行规则：四大类总分权重为 {pillarWeightSummary}。增长动力减少投资和消费口径交叉，纳入工业产能利用率；金融信贷不再重复计入社融总量，杠杆约束按对应指标总分权重观察；财政执行观察实际累计名义支出同比，不把预算完成比例当作财政刺激。产业与制度区分方向、实施条件和执行进展。新指标独立编号，不继承旧指标数值。权重、连续锚点、固定复合分量及五档证据边界均为研究试行配置，并非跨资产回测最优值。数据来源按官方原始发布 → Wind → 财新数据 API 核验。{macroRatingTimelinessNote}</p></details>
  </section>;
}

export function MacroRatingSummary() {
  const fundamentals = result.pillars.filter((item) => item.name !== "宏观调控");
  const fundamentalCoverage = fundamentals.reduce((sum, item) => sum + item.verifiedWeight, 0);
  const fundamentalScore = fundamentalCoverage ? fundamentals.reduce((sum, item) => sum + item.contribution, 0) / fundamentalCoverage : null;
  const fundamentalWeight = fundamentals.reduce((sum, item) => sum + item.weight, 0);
  const policy = result.pillars.find((item) => item.name === "宏观调控");
  const hasResearchScore = research.count > 0 && research.score !== null;
  const overallScore = result.formalScore ?? (hasResearchScore ? research.score : null);
  const overallLabel = result.formalScore !== null ? result.grade : hasResearchScore ? "研究观察 · 含暂评，非正式评级" : result.status === "暂定" ? "暂定观察 · 未发布正式总分" : "资料不足 · 未发布正式总分";
  const hasIncompleteEvidence = result.formalScore === null || missingRules.length > 0 || research.count > 0;
  return <section className="macro-summary">
    <header className="research-header macro-summary-header"><div><p className="eyebrow">MACRO RATING</p><h2>评分总览</h2></div><div className="macro-summary-meta"><span>信息截止 {current.asOf ?? "尚未设置"}</span><span>{ratedCount} / {framework.indicators.length} 项核验</span><span>{framework.version} · 试行</span></div></header>
    <div className="macro-summary-score-grid" aria-label="综合评级、基本面信用与政策支持分开观察">
      <article className="macro-summary-score-card macro-summary-overall"><h3>综合评级</h3><strong className="macro-summary-score-value">{formatScore(overallScore)}<small> / 5</small></strong><p className="macro-summary-grade">{overallLabel}</p><small>已核验权重 {percent(result.coverage)}</small>{research.count > 0 ? <small>评分覆盖 {percent(research.coverage)} · 含研究暂评 {research.count} 项</small> : null}</article>
      <article className="macro-summary-score-card"><h3>基本面与信用</h3><strong className="macro-summary-score-value">{formatScore(fundamentalScore)}<small> / 5</small></strong><p>已实现条件与信用约束</p><small>占综合权重 {percent(fundamentalWeight)} · 核验覆盖 {percent(fundamentalWeight ? fundamentalCoverage / fundamentalWeight : 0)}</small>{fundamentalCoverage < fundamentalWeight - 1e-9 ? <small>仅为已覆盖观察分，不补空值</small> : null}</article>
      <article className="macro-summary-score-card"><h3>政策支持</h3><strong className="macro-summary-score-value">{formatScore(policy?.observedScore ?? null)}<small> / 5</small></strong><p>支持加码不等于经济复苏</p><small>占综合权重 {percent(policy?.weight ?? 0)} · 核验覆盖 {percent(policy?.coverage ?? 0)}</small>{(policy?.coverage ?? 0) < 1 ? <small>仅为原值核验部分，暂评另列</small> : null}</article>
    </div>
    {hasIncompleteEvidence ? <div className="macro-summary-alert" role="status"><strong>{research.count > 0 ? `含研究暂评 ${research.count} 项，非正式评级` : "尚未满足正式总分发布门槛"}</strong><span>原值待补证据 {missingRules.length} 项 · 核验覆盖 {percent(result.coverage)}；缺项不按中性分补齐。{research.count > 0 ? "暂评已单列计分，但不增加核验覆盖率、不代表全部原值已核验。" : ""}</span></div> : null}
    <div className="macro-summary-pillars" aria-label="四大类评分与核验覆盖">{result.pillars.map((item) => {
      const researchPillar = research.pillars.find((entry) => entry.name === item.name);
      return <article key={item.name}><div className="macro-summary-pillar-heading"><h3>{item.name}</h3><span>{percent(item.weight)}</span></div><strong className="macro-summary-pillar-score">{formatScore(item.observedScore)}<small> / 5</small></strong><p>{describePillarRole(item.name).description}</p><small>{item.count} 项指标 · 已核验 {item.verifiedCount} 项 · 核验覆盖 {percent(item.coverage)}</small>{item.coverage < 1 ? <small>原值核验观察分，非完整维度评级</small> : null}{researchPillar?.researchCount ? <small>含暂评 {researchPillar.researchCount} 项的维度分 {formatScore(researchPillar.score)} / 5 · 非正式评级</small> : null}</article>;
    })}</div>
    <p className="macro-summary-observation">观察重点：结合四维差异理解综合分，政策支持不等于经济复苏。</p>
    <p className="research-footnote">已保留评分记录 {snapshots.length} 期，其中正式评级 {snapshots.filter(isFormalSnapshot).length} 期。</p>
  </section>;
}

function snapshotPrimaryValueLabel(snapshot: Snapshot, row: NonNullable<Snapshot["rows"]>[number]) {
  const frozenRule = snapshot.framework?.indicators.find((rule) => rule.id === row.id);
  return frozenRule && hasRetainedLoanPrimaryValue(frozenRule) ? "历史主值：" : "";
}

function MacroSnapshotScoreComponents({ snapshot, row }: { snapshot: Snapshot; row: NonNullable<Snapshot["rows"]>[number] }) {
  const frozenRule = snapshot.framework?.indicators.find((rule) => rule.id === row.id);
  if (!frozenRule || !visibleScoreComponents(frozenRule)) return null;
  return <MacroVisibleScoreComponents item={frozenRule} observation={row.observation} details={row.points !== null ? row.scoringDetails : null} />;
}

export function MacroRatingHistory() {
  return <section className="macro-v1-sheet"><MacroRatingPageHeader kicker="RATING ARCHIVE" title="评分记录" lead="按时间回看各期评分与依据" detail="新评分只追加，旧记录默认保留" />
    <p className="macro-rating-notice">已保留 {snapshots.length} 期 · 最新记录在前 · 评分方法试行</p>
    <details className="macro-rating-help"><summary>本期观察、来源与局限</summary><MacroCurrentReviewDetails /></details>
    {snapshots.length === 0 ? <div className="macro-v1-empty"><strong>暂无 {framework.version} 评分记录</strong><p>不复制旧版初评，也不生成空白评级。</p></div> : <>
      <div className="table-wrap macro-v1-input-table"><table className="dense-table"><thead><tr><th>类型／评价期</th><th>截止日／规则</th><th>经济运行</th><th>增长动力</th><th>金融信贷</th><th>宏观调控</th><th>综合分／评分类型</th><th>核验／评分覆盖</th><th>政策依据／验证点</th></tr></thead><tbody>{snapshots.toReversed().map((item, index) => <tr key={index}><td>{item.type}<small>{item.period}</small></td><td>{item.asOf}<small>{item.version}</small></td><td>{formatScore(item.economic)}</td><td>{formatScore(item.growth)}</td><td>{formatScore(item.credit)}</td><td>{item.research?.count ? <>{formatScore(item.research.pillars?.find((entry) => entry.name === "宏观调控")?.score ?? null)}<small>含暂评 · 原值核验部分 {formatScore(item.policy)}</small></> : formatScore(item.policy)}</td><td>{!isFormalSnapshot(item) && item.research?.count && item.research.score !== null ? <><strong>{formatScore(item.research.score)} / 5</strong><small>研究观察 · 含暂评{item.research.count}项</small></> : formatScore(isFormalSnapshot(item) ? item.score : null)}<small>{isFormalSnapshot(item) ? item.grade : "未发布正式档位"}</small></td><td>核验 {percent(item.coverage)}{item.research?.count ? <small>评分 {percent(item.research.coverage)} · 含暂评{item.research.count}项</small> : null}</td><td><details className="macro-rating-row-evidence"><summary>本期依据与验证点</summary><p><strong>评分依据：</strong>{item.evidence}</p><p><strong>验证点：</strong>{item.validation}</p></details></td></tr>)}</tbody></table></div>
      {snapshots.toReversed().map((item) => item.rows ? <details className="macro-v1-aux" key={`${item.asOf}-${item.version}`}><summary>{item.asOf} · {item.version} 原始证据与缺口快照</summary><ul>{item.rows.map((row) => <li key={row.id}><strong>{row.name}</strong> · 总分权重 {formatTotalWeight(row.weight)} · {row.points === null ? row.researchPoints ? `${formatScore(row.researchPoints)} 分 · 研究暂评` : "未计分" : `${formatScore(row.points)} 分`}{row.observation ? <> · {row.observation.period} · {snapshotPrimaryValueLabel(item, row)}{row.id === "G19" ? formatScore(row.observation.value) : formatRaw(row.observation.value)}{row.observation.unit ?? ""} · 发布 {row.observation.releaseDate} · <a href={row.observation.sourceUrl} target="_blank" rel="noreferrer">原文 ↗</a><p>{row.observation.rationale}</p>{row.id === "G19" ? <MacroProfitBreadthSummary observation={row.observation} asOf={item.asOf} /> : null}</> : null}<MacroSnapshotScoreComponents snapshot={item} row={row} />{row.gap ? <p>原值核验缺口：{row.gap}</p> : null}<MacroResearchAssessment assessment={row.researchAssessment ?? null} /></li>)}</ul></details> : null)}
    </>}
    <details className="macro-rating-help"><summary>同截止日的版本比较</summary><p>同一信息截止日，不同规则版本的分数变化不等于经济变化。连续曲线、复合分量和证据矩阵可能产生不同分数；应按同版标准复算历史后再比较趋势，不能把方法修订当成新的宏观改善或恶化。综合评级档位不因本期观点而调整。</p></details>
    <details className="macro-rating-help"><summary>口径与核验说明</summary><p>评分记录默认全部保留；新评分与规则修订只追加，不覆盖或自动裁剪。只有用户明确指定要删除哪些记录时才删除，并保留可恢复备份；此前已获准删除的记录不自动恢复。各期保留截止日、规则版本、四维得分、覆盖率和原始证据。同截止日的规则版本变化不等于经济变化，不把不同方法的分数直接连接成趋势。</p><p>最新记录在前。全部指标按本版规则核验后显示综合分和档位；评分方法仍属试行，完整核验不等于权重已完成回测。含研究暂评时单独标注，不冒充核验评分。</p></details>
  </section>;
}
