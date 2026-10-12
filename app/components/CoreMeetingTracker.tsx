"use client";

import { useEffect, useState } from "react";
import tracker from "../data/core-meetings.json";
import rollingAnalysis from "../data/core-meeting-rolling-analysis.json";
import comparisonUpdates from "../data/core-meeting-comparison-updates.json";

type Workbook = { sourceName: string; status: string; sheets: { name: string; grid: string[][] }[] };
type Sheet = Workbook["sheets"][number];
type ComparisonUpdate = { header: string; cells: string[]; trends: string[]; mappings: string[]; sourceUrl: string };

function appendVerifiedComparisons(sheet: Sheet): { sheet: Sheet; updated: boolean } {
  const updates = (comparisonUpdates.updates as Record<string, ComparisonUpdate[]>)[sheet.name] ?? [];
  const headerRow = sheet.name === "跨年对比矩阵" ? 0 : 2;
  let grid = sheet.grid.map((row) => [...row]);
  for (const update of updates) {
    const headers = grid[headerRow];
    const trendIndex = headers.findIndex((cell) => /演进趋势|变化趋势/.test(cell));
    const mappingIndex = headers.findIndex((cell) => /投研映射|投资启示/.test(cell));
    const dataRows = grid.length - headerRow - 1;
    if (trendIndex < 0 || mappingIndex < 0 || !update.header.trim() || !/^https:\/\//.test(update.sourceUrl)
      || [update.cells, update.trends, update.mappings].some((items) => items.length !== dataRows)) continue;
    grid = grid.map((row, rowIndex) => {
      const next = [...row];
      next.splice(trendIndex, 0, rowIndex === headerRow ? update.header : rowIndex > headerRow ? update.cells[rowIndex - headerRow - 1] : "");
      if (rowIndex > headerRow) {
        next[trendIndex + 1] = update.trends[rowIndex - headerRow - 1];
        next[mappingIndex + 1] = update.mappings[rowIndex - headerRow - 1];
      }
      return next;
    });
  }
  return { sheet: { ...sheet, grid }, updated: grid.some((row, index) => row.length > sheet.grid[index].length) };
}

function rollingComparisonSheet(sheet: Sheet): Sheet {
  const appended = appendVerifiedComparisons(sheet);
  sheet = appended.sheet;
  const headerRow = sheet.name === "跨年对比矩阵" ? 0 : 2;
  const headers = sheet.grid[headerRow] ?? [];
  const trendIndex = headers.findIndex((cell) => /演进趋势|变化趋势/.test(cell));
  const periodStart = sheet.name === "全国两会" ? 2 : 1;
  if (trendIndex <= periodStart) return sheet;

  const periodIndices = Array.from({ length: trendIndex - periodStart }, (_, index) => periodStart + index);
  const periodYear = (index: number) => Number(headers[index].match(/\d{4}/)?.[0] ?? 0);
  const recentIndices = periodIndices.sort((a, b) => periodYear(a) - periodYear(b) || a - b).slice(-3);
  const lastColumn = Math.max(...sheet.grid.map((row) => row.length));
  const trailingIndices = Array.from({ length: lastColumn - trendIndex }, (_, index) => trendIndex + index)
    .filter((index) => sheet.grid.slice(headerRow).some((row) => Boolean(row[index]?.trim())));
  const columns = [...Array.from({ length: periodStart }, (_, index) => index), ...recentIndices, ...trailingIndices];
  const recentHeaders = recentIndices.map((index) => headers[index]);
  const fiveYearAnalysisReady = sheet.name === "五年规划" && !appended.updated
    && recentHeaders.every((header, index) => header === rollingAnalysis.fiveYear.periods[index])
    && rollingAnalysis.fiveYear.rows.length === sheet.grid.length - 4;
  const removedOlderPeriod = periodIndices.length > recentIndices.length;

  return {
    ...sheet,
    grid: sheet.grid.map((row, rowIndex) => {
      const visible = columns.map((index) => row[index] ?? "");
      if (sheet.name === "五年规划" && rowIndex === 0) visible[0] = "五年规划政策对比框架（最近三轮）";
      if (sheet.name === "五年规划" && rowIndex === sheet.grid.length - 1) {
        visible[0] = "使用说明：当前展示最近三轮五年规划；演进趋势与投研映射只比较这三轮。早期规划仍保存在用户原稿中；原稿内容尚未逐项核验。";
      }
      if (rowIndex === headerRow) {
        const trendPosition = columns.indexOf(trendIndex);
        visible[trendPosition] = sheet.name === "五年规划" && (fiveYearAnalysisReady || appended.updated) ? "十五年演进趋势" : sheet.name === "跨年对比矩阵" ? "近三年变化趋势" : "最近三次演进趋势";
        const mappingPosition = columns.findIndex((index) => /投研映射|投资启示/.test(headers[index]));
        if (mappingPosition !== -1 && sheet.name === "五年规划") visible[mappingPosition] = "投研映射（最近三轮）";
      } else if (rowIndex > headerRow && removedOlderPeriod) {
        const trendPosition = columns.indexOf(trendIndex);
        const mappingPosition = columns.findIndex((index) => /投研映射|投资启示/.test(headers[index]));
        if (fiveYearAnalysisReady && rowIndex >= 3 && rowIndex <= 18) {
          const analysis = rollingAnalysis.fiveYear.rows[rowIndex - 3];
          visible[trendPosition] = analysis.trend;
          if (mappingPosition !== -1) visible[mappingPosition] = analysis.mapping;
        } else if (!appended.updated && (visible[trendPosition] || mappingPosition !== -1 && visible[mappingPosition])) {
          visible[trendPosition] = "最近三次分析待核验更新";
          if (mappingPosition !== -1) visible[mappingPosition] = "最近三次投研映射待核验更新";
        }
      }
      return visible;
    }),
  };
}

const focusTerms = [
  "供给侧结构性改革", "全国统一大市场", "现代化产业体系", "科技自立自强", "新质生产力",
  "高质量发展", "扩大内需", "防范化解风险", "约束性指标", "适度宽松", "更加积极",
  "稳中求进", "绿色转型", "产业升级", "因城施策", "逆周期调节", "跨周期调节",
];

type FocusMatch = { start: number; end: number; kind: "direction" | "target"; priority: number };

function HighlightedText({ text }: { text: string }) {
  const direction: FocusMatch[] = [];
  const targets: FocusMatch[] = [];
  for (const match of text.matchAll(/首次(?:提出|明确|部署)[：:]?[^，。；;\n]{2,18}/g)) {
    direction.push({ start: match.index, end: match.index + match[0].length, kind: "direction", priority: 0 });
  }
  for (const term of focusTerms) {
    let start = text.indexOf(term);
    while (start !== -1) {
      direction.push({ start, end: start + term.length, kind: "direction", priority: 1 });
      start = text.indexOf(term, start + term.length);
    }
  }
  for (const match of text.matchAll(/\d+(?:\.\d+)?(?:%|万亿元|万亿|亿吨|万人|个百分点)/g)) {
    const start = match.index;
    if (/(?:目标|达到|提高|降低|控制|不低于|超过|大于|增长|占比)/.test(text.slice(Math.max(0, start - 14), start))) {
      targets.push({ start, end: start + match[0].length, kind: "target", priority: 2 });
    }
  }
  direction.sort((a, b) => a.priority - b.priority || a.start - b.start || b.end - a.end);
  targets.sort((a, b) => a.start - b.start);
  const chosen: FocusMatch[] = [];
  const add = (candidate?: FocusMatch) => {
    if (candidate && chosen.length < 2 && chosen.every((item) => candidate.end <= item.start || candidate.start >= item.end)) chosen.push(candidate);
  };
  add(direction[0]);
  add(targets.find((candidate) => chosen.every((item) => candidate.end <= item.start || candidate.start >= item.end)));
  for (const candidate of [...direction, ...targets]) add(candidate);
  if (!chosen.length) return text;
  chosen.sort((a, b) => a.start - b.start);
  let cursor = 0;
  const parts = chosen.flatMap((item, index) => {
    const before = text.slice(cursor, item.start);
    cursor = item.end;
    return [before, <mark className={`core-meetings-focus core-meetings-focus-${item.kind}`} key={`${item.start}-${index}`}>{text.slice(item.start, item.end)}</mark>];
  });
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function OriginalSheet({ sheet, sourceName, rolling = false }: { sheet: Sheet; sourceName: string; rolling?: boolean }) {
  const displaySheet = rolling ? rollingComparisonSheet(sheet) : sheet;
  const columnCount = Math.max(1, ...displaySheet.grid.map((row) => row.length));
  const labelWidth = columnCount === 1 ? 100 : 12;
  const contentWidth = columnCount === 1 ? 0 : (100 - labelWidth) / (columnCount - 1);
  return <section className="core-workbook" aria-label={`${sheet.name}${rolling ? "最近三次对照" : "原表"}`}>
    <div className="core-workbook-heading"><div><span>{rolling ? "最近三次 · 原稿及后续更新" : "用户原稿 · 完整对照"}</span><h4>{sheet.name}</h4></div><small>{rolling ? "只展示最近三次及对应趋势、投研映射；早期内容保留在原稿文件中" : `保留原表的全部 ${sheet.grid.length} 行和列`}{"；桌面端并排展示各列，页面向下展开"}</small></div>
    <p className="core-workbook-warning">{rolling ? "最近三次对照依据用户原稿整理；五年规划的趋势与投研映射按最近三轮重写，后续正式会议另行核验更新。" : "原稿逐格呈现。"}原稿尚未逐项与官方原文复核。酒红色重点仅帮助阅读，不代表内容已核验。其中历史数值、演进趋势和投研映射不作为已核验数据或投资建议；已核验会议事实请看上方独立摘要。</p>
    <div className="core-workbook-scroll" tabIndex={0} aria-label={`${sheet.name}${rolling ? "最近三次对照" : "完整表格"}，窄屏时可横向滚动`}>
      <table className="core-workbook-table"><caption>{sheet.name}，来自用户提供的《{sourceName}》</caption><colgroup>
        {Array.from({ length: columnCount }, (_, index) => <col key={index} style={{ width: `${index === 0 ? labelWidth : contentWidth}%` }} />)}
      </colgroup><tbody>
        {displaySheet.grid.map((row, rowIndex) => {
          const isIntroRow = rowIndex < 2 && row.length > 1 && row[0] && row.slice(1).every((cell) => !cell);
          const isNoteRow = rowIndex > 2 && row[0]?.startsWith("使用说明：") && row.slice(1).every((cell) => !cell);
          const isLabelRow = rowIndex === 2 && !["总览", "使用说明", "跨年对比矩阵"].includes(sheet.name) || rowIndex === 0 && ["总览", "跨年对比矩阵"].includes(sheet.name);
          return <tr key={rowIndex} className={isIntroRow || isNoteRow ? "core-workbook-intro-row" : isLabelRow ? "core-workbook-label-row" : undefined}>
            {isIntroRow || isNoteRow ? <td colSpan={row.length}>{row[0]}</td> : row.map((cell, cellIndex) => <td key={cellIndex}>{cell ? !isLabelRow && (cellIndex > 0 || sheet.name === "总览" && rowIndex > 7) ? <HighlightedText text={cell} /> : cell : "\u00a0"}</td>)}
          </tr>;
        })}
      </tbody></table>
    </div>
  </section>;
}

function MeetingOverview({ sheet, sourceName }: { sheet: Sheet; sourceName: string }) {
  const meetings = sheet.grid.slice(1, 7);
  const notes = sheet.grid.slice(10).map((row) => row[0]?.trim()).filter((note): note is string => Boolean(note));
  const layers = Array.from({ length: Math.ceil(notes.length / 2) }, (_, index) => ({ title: notes[index * 2], detail: notes[index * 2 + 1] }));

  return <section className="core-overview" aria-label="会议分工总览">
    <div className="core-overview-heading"><h4>会议分工总览</h4><p>按会议定位看全局，再沿政策层级追踪部署、确认与调节。</p></div>
    <div className="core-overview-grid">
      {meetings.map((row, index) => <article key={`${row[0]}-${index}`}>
        <div className="core-overview-card-head"><h5>{row[0]?.trim()}</h5><span>{row[1]}</span></div>
        <p>{row[2]}</p><strong>{row[3]}</strong><p><HighlightedText text={row[4]} /></p>
      </article>)}
    </div>
    <h4 className="core-overview-subtitle">政策层级与会议衔接</h4>
    <div className="core-overview-layer-grid">
      {layers.map((layer, index) => <article key={`${layer.title}-${index}`}><h5><HighlightedText text={layer.title} /></h5><p><HighlightedText text={layer.detail ?? ""} /></p></article>)}
    </div>
    <details className="core-overview-original"><summary>查看总览完整原表</summary><OriginalSheet sheet={sheet} sourceName={sourceName} /></details>
  </section>;
}

export function CoreMeetingTracker() {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [workbookError, setWorkbookError] = useState(false);
  const [selectedId, setSelectedId] = useState("overview");
  useEffect(() => { let active = true; import("../data/core-meetings-workbook.json").then(({ default: data }) => { if (active) setWorkbook(data); }).catch(() => { if (active) setWorkbookError(true); }); return () => { active = false; }; }, []);
  const selected = tracker.meetings.find((meeting) => meeting.id === selectedId);
  const selectedSheet = workbook?.sheets.find((sheet) => sheet.name === (selected?.name ?? "总览"));
  const latest = [...tracker.meetings].sort((a, b) => b.latest.date.localeCompare(a.latest.date)).slice(0, 3);
  const instructions = workbook?.sheets.find((sheet) => sheet.name === "使用说明");
  const matrix = workbook?.sheets.find((sheet) => sheet.name === "跨年对比矩阵");

  return <section className="core-meetings" aria-label="核心会议跟踪">
    <div className="core-meetings-head">
      <div><p className="eyebrow">POLICY MEETING WATCH</p><h3>核心会议</h3><p>总览、六类会议逐次对比、演进趋势与投研映射；官方摘要和用户原稿分层阅读</p></div>
      <span>官方摘要复核至 {tracker.reviewedAt}</span>
    </div>
    <div className="core-meetings-recent" aria-label="最近已核验会议">
      {latest.map((meeting) => <button type="button" key={meeting.id} onClick={() => setSelectedId(meeting.id)}>
        <time dateTime={meeting.latest.date}>{meeting.latest.date}</time><strong>{meeting.name}</strong><span>{meeting.latest.title}</span>
      </button>)}
    </div>
    <div className="core-meetings-layout">
      <nav aria-label="会议原表目录" className="core-meetings-nav">
        <button type="button" aria-current={selectedId === "overview" ? "true" : undefined} onClick={() => setSelectedId("overview")}><strong>总览</strong><small>会议定位与职能</small></button>
        {tracker.meetings.map((meeting) => <button type="button" key={meeting.id} aria-current={selectedId === meeting.id ? "true" : undefined} onClick={() => setSelectedId(meeting.id)}>
          <strong>{meeting.name}</strong><small>{meeting.scope}</small>
        </button>)}
      </nav>
      <div className="core-meetings-content" aria-live="polite">
        {selected ? <article className="core-meetings-detail">
          <div className="core-meetings-title"><div><span>{selected.scope} · {selected.latest.status} · <time dateTime={selected.latest.date}>{selected.latest.date}</time></span><h4>{selected.name} · 最近官方核验</h4><p>{selected.purpose}。{selected.window}</p></div></div>
          <div className="core-meetings-dimensions"><strong>对比维度</strong>{selected.dimensions.map((dimension) => <span key={dimension}>{dimension}</span>)}</div>
          <h5>{selected.latest.title}</h5>
          <div className="core-meetings-analysis">
            <section><h6>官方事实</h6><ul>{selected.latest.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></section>
            <section><h6>政策信号 · 研究归纳</h6><p>{selected.latest.signal}</p></section>
            <section><h6>投资传导 · 待验证</h6><p>{selected.latest.assetLens}</p></section>
          </div>
          <div className="core-meetings-followup"><strong>后续核验</strong>{selected.latest.followUp.map((item) => <span key={item}>{item}</span>)}</div>
          <div className="core-meetings-followup"><strong>板块观察 · 待验证</strong>{selected.sectorWatch.map((item) => <span key={item}>{item}</span>)}</div>
          <div className="core-meetings-source"><span>{selected.latest.publisher} · 发布于 {selected.latest.publishedAt}</span><a href={selected.latest.sourceUrl} target="_blank" rel="noreferrer">查看原始发布 ↗</a></div>
          {selected.archive.length > 0 ? <details className="core-meetings-archive"><summary>历次已核验会议（{selected.archive.length}）</summary>{(selected.archive as (typeof selected.latest)[]).map((entry) => <article key={`${entry.date}-${entry.title}`}><time dateTime={entry.date}>{entry.date}</time><strong>{entry.title}</strong><p>{entry.signal}</p><a href={entry.sourceUrl} target="_blank" rel="noreferrer">官方原文 ↗</a></article>)}</details> : null}
        </article> : <p className="core-meetings-overview-note">先看会议分工，再点选上方会议阅读各次对照、演进趋势和投研映射。</p>}
        {selectedSheet && workbook ? selected ? <OriginalSheet sheet={selectedSheet} sourceName={workbook.sourceName} rolling /> : <MeetingOverview sheet={selectedSheet} sourceName={workbook.sourceName} /> : <p className="core-meetings-overview-note">{workbookError ? "原表加载失败，请刷新页面后重试。" : "完整原表正在加载…"}</p>}
      </div>
    </div>
    {matrix && workbook ? <details className="core-meetings-matrix"><summary>跨年对比矩阵 · 最近三年（原表尚未填值）</summary><OriginalSheet sheet={matrix} sourceName={workbook.sourceName} rolling /></details> : null}
    {instructions && workbook ? <details className="core-meetings-matrix"><summary>原表使用说明</summary><OriginalSheet sheet={instructions} sourceName={workbook.sourceName} /></details> : null}
    <p className="core-meetings-note">{tracker.basis}</p>
  </section>;
}
