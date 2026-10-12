"use client";

import { useState } from "react";
import tracker from "../data/macro-policy-tracker.json";

const categories = ["产业政策", "制度建设"] as const;

export function PolicyTracker() {
  const [topicId, setTopicId] = useState(tracker.topics[0].id);
  const [activeTrack, setActiveTrack] = useState("全部");
  const topic = tracker.topics.find((item) => item.id === topicId) ?? tracker.topics[0];
  const tracks = tracker.taxonomy[topic.category];
  const visibleTopics = tracker.topics.filter((item) => item.category === topic.category && (activeTrack === "全部" || item.track === activeTrack));
  const recentEvents = tracker.topics
    .flatMap((item) => item.events.map((event) => ({ ...event, topic: item })))
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 6);

  const selectTopic = (id: string) => {
    const selected = tracker.topics.find((item) => item.id === id);
    if (!selected) return;
    setTopicId(id);
    setActiveTrack(selected.track);
  };

  return <section className="policy-track" aria-label="产业政策与制度建设跟踪">
    <div className="policy-track-header">
      <div><h4>产业政策与制度建设</h4><p>增量成长与供给侧改革并重；市场、要素、财税金融、企业治理和开放制度全景跟踪</p></div>
      <span>官方来源核验至 {tracker.updated}</span>
    </div>

    <div className="policy-track-coverage" aria-label="政策覆盖框架">
      {categories.map((category) => <article key={category}>
        <strong>{category}</strong><span>{tracker.topics.filter((item) => item.category === category).length} 个主题</span>
        <p>{tracker.taxonomy[category].join(" · ")}</p>
      </article>)}
    </div>

    <div className="policy-track-recent">
      <h5>最新动态</h5>
      <div className="policy-track-recent-list">{recentEvents.map((event) => <button type="button" key={`${event.topic.id}-${event.date}-${event.title}`} onClick={() => selectTopic(event.topic.id)} aria-label={`查看${event.topic.title}：${event.title}`}>
        <time dateTime={event.date}>{event.date}</time><span>{event.topic.track} · {event.kind}</span><strong>{event.title}</strong>
      </button>)}</div>
    </div>

    <div className="policy-track-categories" role="group" aria-label="政策类型">
      {categories.map((category) => <button type="button" key={category} aria-pressed={topic.category === category} onClick={() => {
        setTopicId(tracker.topics.find((item) => item.category === category)!.id);
        setActiveTrack("全部");
      }}>{category} · {tracker.topics.filter((item) => item.category === category).length}</button>)}
    </div>

    <div className="policy-track-filters" role="group" aria-label={`${topic.category}跟踪方向`}>
      {["全部", ...tracks].map((track) => <button type="button" key={track} aria-pressed={activeTrack === track} onClick={() => {
        setActiveTrack(track);
        const first = tracker.topics.find((item) => item.category === topic.category && (track === "全部" || item.track === track));
        if (first) setTopicId(first.id);
      }}>{track}{track === "全部" ? "" : ` · ${tracker.topics.filter((item) => item.category === topic.category && item.track === track).length}`}</button>)}
    </div>

    <div className="policy-track-layout">
      <nav className="policy-track-topics" aria-label={`${topic.category}主题`}>
        {visibleTopics.map((item) => <button type="button" key={item.id} aria-current={topic.id === item.id ? "true" : undefined} onClick={() => setTopicId(item.id)}>
          <strong>{item.title}</strong><span>{item.track} · {item.phase}</span>
        </button>)}
      </nav>

      <article className="policy-track-detail" aria-live="polite">
        <div className="policy-track-detail-head"><div><span>{topic.category} · {topic.track} · {topic.phase}</span><h5>{topic.title}</h5><p>{topic.summary}</p></div></div>
        <p className="policy-track-focus"><strong>重点观察</strong>{topic.focus}</p>
        <div className="policy-track-impact"><strong>投资传导</strong><div>{topic.marketImpact.map((item) => <span key={item}>{item}</span>)}</div></div>
        <ol className="policy-track-timeline">{topic.events.map((event) => <li key={`${event.date}-${event.title}`}>
          <div className="policy-track-event-head"><time dateTime={event.date}>{event.date}</time><span>{event.kind}</span></div>
          <h6>{event.title}</h6><p>{event.summary}</p>
          <div className="policy-track-event-source"><span>{event.agency} · 发布于 {event.publishedAt}</span><a href={event.url} target="_blank" rel="noreferrer">查看官方原文 ↗</a></div>
        </li>)}</ol>
        <div className="policy-track-observation"><strong>后续验证</strong><p>{topic.observation}</p><div>{topic.metrics.map((metric) => <span key={metric}>{metric}</span>)}</div></div>
      </article>
    </div>

    {topic.category === "产业政策" ? <div className="policy-track-lenses" aria-label="产业政策横向观察">
      <h5>跨主线核验</h5>
      <div className="policy-track-lens-grid">{tracker.industryLenses.map((lens) => <article key={lens.title}>
        <h6>{lens.title}</h6><p>{lens.description}</p><div>{lens.signals.map((signal) => <span key={signal}>{signal}</span>)}</div>
        <a href={lens.url} target="_blank" rel="noreferrer">查看官方依据 ↗</a>
      </article>)}</div>
      <p className="policy-track-future"><strong>{tracker.futureWatchlist.title}</strong>{tracker.futureWatchlist.description}<a href={tracker.futureWatchlist.url} target="_blank" rel="noreferrer">官方部署 ↗</a></p>
    </div> : null}

    <details className="policy-track-sources"><summary>查看跟踪口径与官方栏目</summary><p>{tracker.basis}</p><div>{tracker.sourceIndexes.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div></details>
  </section>;
}
