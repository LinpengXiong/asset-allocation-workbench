(() => {
  "use strict";

  const ASSET_NAMES = ["股票", "债券", "商品", "另类"];
  const ASSET_COLORS = { 股票: "var(--stock)", 债券: "var(--bond)", 商品: "var(--commodity)", 另类: "var(--alternative)" };
  const ASSET_PARAMS = {
    股票: { strategic: .6, min: .4, max: .8, sensitivity: .025, threshold: .02 },
    债券: { strategic: .15, min: .1, max: .2, sensitivity: .05, threshold: .01 },
    商品: { strategic: .15, min: .1, max: .2, sensitivity: .05, threshold: .01 },
    另类: { strategic: .1, min: 0, max: .2, sensitivity: .1, threshold: .01 },
  };
  const INDEX_ANCHORS = [
    { point: 3000, position: .8 }, { point: 3500, position: .7 },
    { point: 3800, position: .65 }, { point: 4200, position: .6 },
    { point: 4700, position: .5 }, { point: 5200, position: .4 },
  ];
  const SUB_ASSETS = [
    ["股票", "红利/价值", .3846153846, .25, "股息债券替代、盈利稳定性、价值成长估值差"],
    ["股票", "GARP", .3076923077, .2, "盈利扩散、估值与增速匹配、机构资金"],
    ["股票", "成长", .3076923077, .2, "长端利率、科技政策、风险偏好"],
    ["债券", "利率债", .4, .04, "10Y国债、期限利差、货币政策"],
    ["债券", "高等级信用", .25, .025, "信用利差、流动性、违约风险"],
    ["债券", "可转债", .1, .01, "转股溢价、纯债溢价、权益趋势"],
    ["债券", "REITs", .15, .015, "分派率、利率、底层现金流"],
    ["债券", "境外债", .1, .01, "美债利率、汇率、对冲成本"],
    ["商品", "量化CTA", .5, .1, "跨品种趋势、波动率、模型回撤"],
    ["商品", "黄金", .5, .1, "实际利率、美元、央行购金、ETF"],
    ["另类", "宏观对冲", .4, .02, "尾部风险、期权成本、相关性"],
    ["另类", "宏观及期货", .3, .015, "趋势、基差、保证金与容量"],
    ["另类", "市场中性", .3, .015, "Alpha离散度、对冲成本、风格暴露"],
  ];

  const state = { payload: null, advisory: null, tab: "macro", allocationTab: "overview", refreshing: false };
  const $ = (id) => document.getElementById(id);
  const E = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
  const signedPct = (value) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  const score = (value) => `${value > 0 ? "+" : ""}${Number(value).toFixed(2)}`;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, digits = 10) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;

  function interpolateStockPosition(indexPoint) {
    if (indexPoint <= INDEX_ANCHORS[0].point) return INDEX_ANCHORS[0].position;
    const last = INDEX_ANCHORS[INDEX_ANCHORS.length - 1];
    if (indexPoint >= last.point) return last.position;
    for (let index = 0; index < INDEX_ANCHORS.length - 1; index += 1) {
      const left = INDEX_ANCHORS[index];
      const right = INDEX_ANCHORS[index + 1];
      if (indexPoint >= left.point && indexPoint <= right.point) {
        const progress = (indexPoint - left.point) / (right.point - left.point);
        return left.position + progress * (right.position - left.position);
      }
    }
    return last.position;
  }

  function classify(value) {
    if (value <= -1.5) return "低配";
    if (value <= -.5) return "适度低配";
    if (value < .5) return "标配";
    if (value < 1.5) return "适度高配";
    return "高配";
  }

  function actionFor(difference, threshold) {
    if (Math.abs(difference) < threshold) return "观察";
    return difference > 0 ? "增配" : "减配";
  }

  function signals(input) {
    return Object.fromEntries(ASSET_NAMES.map((asset) => [asset, round(input.factors.filter((factor) => factor.asset === asset).reduce((sum, factor) => sum + factor.weight * factor.score, 0))]));
  }

  function constrainedTargets(indexPoint, signalMap) {
    const stock = clamp(interpolateStockPosition(indexPoint) + ASSET_PARAMS.股票.sensitivity * signalMap.股票, ASSET_PARAMS.股票.min, ASSET_PARAMS.股票.max);
    const otherAssets = ["债券", "商品", "另类"];
    const raw = Object.fromEntries(otherAssets.map((asset) => [asset, Math.max(.001, ASSET_PARAMS[asset].strategic + ASSET_PARAMS[asset].sensitivity * signalMap[asset])]));
    const budget = 1 - stock;
    const rawTotal = Object.values(raw).reduce((sum, value) => sum + value, 0);
    const limited = Object.fromEntries(otherAssets.map((asset) => [asset, clamp((raw[asset] / rawTotal) * budget, ASSET_PARAMS[asset].min, ASSET_PARAMS[asset].max)]));
    const residual = budget - Object.values(limited).reduce((sum, value) => sum + value, 0);
    if (Math.abs(residual) > 1e-10) {
      const capacities = Object.fromEntries(otherAssets.map((asset) => [asset, residual > 0 ? ASSET_PARAMS[asset].max - limited[asset] : limited[asset] - ASSET_PARAMS[asset].min]));
      const total = Object.values(capacities).reduce((sum, value) => sum + value, 0);
      if (total > 0) otherAssets.forEach((asset) => { limited[asset] += residual * capacities[asset] / total; });
    }
    return { 股票: round(stock), 债券: round(limited.债券), 商品: round(limited.商品), 另类: round(limited.另类) };
  }

  function calculateStyleScores(input) {
    const result = { "红利/价值": 0, GARP: 0, 成长: 0 };
    input.styleFactors.forEach((factor) => {
      result["红利/价值"] += factor.score * factor.weight * factor.exposure.dividend;
      result.GARP += factor.score * factor.weight * factor.exposure.garp;
      result.成长 += factor.score * factor.weight * factor.exposure.growth;
    });
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, round(value)]));
  }

  function buildSubAllocations(input, targets, styleScores) {
    const scores = { ...input.subTilts, ...styleScores };
    return SUB_ASSETS.map(([parent, name, base, current, watch]) => {
      const siblings = SUB_ASSETS.filter((entry) => entry[0] === parent);
      const adjusted = siblings.map((entry) => Math.max(.01, entry[2] * (1 + .15 * (scores[entry[1]] || 0))));
      const within = adjusted[siblings.findIndex((entry) => entry[1] === name)] / adjusted.reduce((sum, value) => sum + value, 0);
      const portfolioTarget = within * targets[parent];
      const difference = portfolioTarget - current;
      const tiltScore = scores[name] || 0;
      return { parent, name, baseWithinParent: base, score: tiltScore, targetWithinParent: within, portfolioTarget, currentPortfolio: current, difference, action: actionFor(difference, .005), watch };
    });
  }

  function calculateModel(input) {
    const signalMap = signals(input);
    const targets = constrainedTargets(input.index.value, signalMap);
    const allocations = ASSET_NAMES.map((asset) => {
      const difference = targets[asset] - input.currentHoldings[asset];
      const action = actionFor(difference, ASSET_PARAMS[asset].threshold);
      return {
        asset, current: input.currentHoldings[asset], target: targets[asset], difference,
        signal: signalMap[asset], view: classify(signalMap[asset]), action,
        threshold: ASSET_PARAMS[asset].threshold,
        trigger: action === "观察" ? "阈值内" : action === "增配" ? "需增配" : "需减配",
        rationale: asset === "股票" ? `点位锚=${input.index.value.toFixed(2)}；信号=${signalMap[asset].toFixed(2)}` : `信号=${signalMap[asset].toFixed(2)}；剩余预算内约束分配`,
      };
    });
    const styleScores = calculateStyleScores(input);
    const subAllocations = buildSubAllocations(input, targets, styleScores);
    const stressScenarios = INDEX_ANCHORS.map(({ point }) => ({ indexPoint: point, ...(() => { const next = constrainedTargets(point, { ...signalMap, 股票: 0 }); return { stock: next.股票, bond: next.债券, commodity: next.商品, alternative: next.另类 }; })() }));
    const currentTotal = ASSET_NAMES.reduce((sum, asset) => sum + input.currentHoldings[asset], 0);
    const targetTotal = ASSET_NAMES.reduce((sum, asset) => sum + targets[asset], 0);
    const subTargetTotal = subAllocations.reduce((sum, item) => sum + item.portfolioTarget, 0);
    const boundsOk = allocations.every((item) => item.target >= ASSET_PARAMS[item.asset].min - 1e-8 && item.target <= ASSET_PARAMS[item.asset].max + 1e-8);
    const factorWeightsOk = ASSET_NAMES.every((asset) => Math.abs(input.factors.filter((factor) => factor.asset === asset).reduce((sum, factor) => sum + factor.weight, 0) - 1) < 1e-6);
    const modelOk = Math.abs(currentTotal - 1) < 1e-6 && Math.abs(targetTotal - 1) < 1e-6 && Math.abs(subTargetTotal - 1) < 1e-6 && boundsOk && factorWeightsOk;
    return { input, allocations, subAllocations, styleScores, stressScenarios, checks: { currentTotal, targetTotal, subTargetTotal, boundsOk, factorWeightsOk, status: modelOk ? "模型通过" : "检查约束" } };
  }

  function freshness(payload) {
    const age = Date.now() - Date.parse(payload.collectedAt);
    if (!Number.isFinite(age)) return "更新时间未知";
    const hours = Math.max(0, Math.floor(age / 3600000));
    if (hours < 1) return "刚刚更新";
    if (hours < 24) return `${hours} 小时前更新`;
    return `${Math.floor(hours / 24)} 天前更新`;
  }

  const actionBadge = (action) => `<span class="action ${E(action)}">${E(action)}</span>`;
  const allocationRows = (model) => model.allocations.map((item) => `<tr><td><span class="asset-dot" style="background:${ASSET_COLORS[item.asset]}"></span>${E(item.asset)}</td><td>${pct(item.current)}</td><td><strong>${pct(item.target)}</strong></td><td class="${item.difference > 0 ? "positive" : item.difference < 0 ? "negative" : ""}">${signedPct(item.difference)}</td><td>${score(item.signal)}</td><td>${E(item.view)}</td><td>${actionBadge(item.action)}</td></tr>`).join("");

  function renderOverview(model) {
    const triggerCount = model.allocations.filter((item) => item.action !== "观察").length;
    const change = model.input.index.changePct;
    return `<section class="kpi-grid">
      <article class="kpi-card primary"><p>上证指数</p><strong>${Number(model.input.index.value).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</strong><span class="${Number(change || 0) >= 0 ? "positive" : "negative"}">${change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}</span></article>
      <article class="kpi-card"><p>股票建议仓位</p><strong>${pct(model.allocations[0].target)}</strong><span>点位锚与战术信号共同生成</span></article>
      <article class="kpi-card"><p>组合目标合计</p><strong>${pct(model.checks.targetTotal)}</strong><span>上下限与归一约束</span></article>
      <article class="kpi-card success"><p>模型状态</p><strong>${E(model.checks.status)}</strong><span>${triggerCount} 项触发调仓</span></article>
    </section>
    <section class="two-column"><article class="panel"><div class="section-heading"><div><p class="eyebrow">目标组合</p><h2>大类资产调仓建议</h2></div><span class="muted">阈值抑制频繁交易</span></div><div class="table-wrap"><table><thead><tr><th>资产</th><th>当前</th><th>目标</th><th>差额</th><th>信号</th><th>观点</th><th>执行</th></tr></thead><tbody>${allocationRows(model)}</tbody></table></div></article>
    <article class="panel"><div class="section-heading"><div><p class="eyebrow">仓位对比</p><h2>当前 vs 建议目标</h2></div></div><div class="allocation-bars">${model.allocations.map((item) => `<div class="bar-row"><div class="bar-label"><span>${E(item.asset)}</span><strong>${pct(item.target)}</strong></div><div class="bar-track"><span class="bar-current" style="width:${pct(item.current)};background:${ASSET_COLORS[item.asset]}"></span><span class="bar-target-marker" style="left:${pct(item.target)}"></span></div><div class="bar-legend"><span>当前 ${pct(item.current)}</span><span>目标 ${pct(item.target)}</span></div></div>`).join("")}</div></article></section>
    <section class="panel rationale-panel"><div class="section-heading"><div><p class="eyebrow">审计线索</p><h2>建议依据</h2></div></div><div class="rationale-grid">${model.allocations.map((item) => `<div class="rationale-card"><span>${E(item.asset)}</span><strong>${E(item.rationale)}</strong><p>${E(item.trigger)} · 调仓阈值 ${pct(item.threshold)}</p></div>`).join("")}</div></section>`;
  }

  function renderFactors(model) {
    const sourceMap = Object.fromEntries(model.input.sources.map((source) => [source.id, source]));
    const sections = ASSET_NAMES.map((asset) => `<section class="panel"><div class="section-heading"><div><p class="eyebrow">${E(asset)}信号</p><h2>${E(asset)}因子证据</h2></div><strong class="signal-badge">${score(model.allocations.find((item) => item.asset === asset).signal)}</strong></div><div class="factor-list">${model.input.factors.filter((factor) => factor.asset === asset).map((factor) => `<article class="factor-card"><div class="factor-top"><div><h3>${E(factor.factor)}</h3><p>${E(factor.indicator)}</p></div><span class="score-pill">${factor.score > 0 ? "+" : ""}${factor.score.toFixed(1)}</span></div><div class="factor-meta"><span>权重 ${pct(factor.weight, 0)}</span><span>${E(factor.frequency)}</span><span class="${factor.verified ? "verified" : "unverified"}">${factor.verified ? "已核验" : "待核验"}</span></div><p class="evidence">${E(factor.evidence)}</p><div class="source-links">${factor.sourceIds.map((id) => sourceMap[id] && /^https:\/\//.test(sourceMap[id].url) ? `<a href="${E(sourceMap[id].url)}" target="_blank" rel="noreferrer">${E(sourceMap[id].publisher)} ↗</a>` : "").join("")}</div></article>`).join("")}</div></section>`).join("");
    const styleRows = model.input.styleFactors.map((factor) => `<tr><td>${E(factor.factor)}</td><td>${factor.score.toFixed(1)}</td><td>${pct(factor.weight, 0)}</td><td>${factor.exposure.dividend.toFixed(1)}</td><td>${factor.exposure.garp.toFixed(1)}</td><td>${factor.exposure.growth.toFixed(1)}</td><td>${E(factor.methodology)}</td></tr>`).join("");
    return `<div class="stack">${sections}<section class="panel"><div class="section-heading"><div><p class="eyebrow">股票风格</p><h2>风格轮动信号矩阵</h2></div></div><div class="style-score-grid">${Object.entries(model.styleScores).map(([name, value]) => `<div><span>${E(name)}</span><strong>${score(value)}</strong></div>`).join("")}</div><div class="table-wrap"><table><thead><tr><th>风格因子</th><th>评分</th><th>权重</th><th>红利暴露</th><th>GARP暴露</th><th>成长暴露</th><th>判定口径</th></tr></thead><tbody>${styleRows}</tbody></table></div></section></div>`;
  }

  function renderSubAllocation(model) {
    const rows = model.subAllocations.map((item) => `<tr><td>${E(item.parent)}</td><td><strong>${E(item.name)}</strong></td><td>${pct(item.baseWithinParent)}</td><td>${score(item.score)}</td><td>${pct(item.targetWithinParent)}</td><td>${pct(item.portfolioTarget)}</td><td>${pct(item.currentPortfolio)}</td><td class="${item.difference > 0 ? "positive" : item.difference < 0 ? "negative" : ""}">${signedPct(item.difference)}</td><td>${actionBadge(item.action)}</td><td>${E(item.watch)}</td></tr>`).join("");
    return `<section class="panel"><div class="section-heading"><div><p class="eyebrow">母资产内归一</p><h2>细分方向建议</h2></div><span class="muted">组合目标合计 ${pct(model.checks.subTargetTotal)}</span></div><div class="table-wrap"><table><thead><tr><th>母资产</th><th>细分方向</th><th>母资产内基准</th><th>评分</th><th>母资产内目标</th><th>组合目标</th><th>当前</th><th>差额</th><th>执行</th><th>核心观察</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function renderStress(model) {
    const maxStock = Math.max(...model.stressScenarios.map((item) => item.stock));
    const columns = model.stressScenarios.map((item) => `<div class="scenario-column"><div class="scenario-fill" style="height:${item.stock / maxStock * 100}%"><span>${pct(item.stock, 0)}</span></div><strong>${item.indexPoint}</strong></div>`).join("");
    const rows = model.stressScenarios.map((item) => `<tr><td><strong>${item.indexPoint}</strong></td><td>${pct(item.stock)}</td><td>${pct(item.bond)}</td><td>${pct(item.commodity)}</td><td>${pct(item.alternative)}</td></tr>`).join("");
    return `<div class="two-column stress-layout"><section class="panel"><div class="section-heading"><div><p class="eyebrow">点位路径</p><h2>指数点位与股票建议仓位</h2></div></div><div class="scenario-chart">${columns}</div></section><section class="panel"><div class="section-heading"><div><p class="eyebrow">约束结果</p><h2>大类资产情景表</h2></div></div><div class="table-wrap"><table><thead><tr><th>上证点位</th><th>股票</th><th>债券</th><th>商品</th><th>另类</th></tr></thead><tbody>${rows}</tbody></table></div></section></div>`;
  }

  function renderMethod(model) {
    const params = Object.entries(ASSET_PARAMS).map(([asset, param]) => `<tr><td><strong>${E(asset)}</strong></td><td>${pct(param.strategic)}</td><td>${pct(param.min)}</td><td>${pct(param.max)}</td><td>${pct(param.sensitivity)}</td><td>${pct(param.threshold)}</td></tr>`).join("");
    const sources = model.input.sources.map((source) => /^https:\/\//.test(source.url) ? `<a href="${E(source.url)}" target="_blank" rel="noreferrer"><div><strong>${E(source.title)}</strong><span>${E(source.publisher)} · ${new Date(source.observedAt).toLocaleString("zh-CN")}</span></div><span>打开来源 ↗</span></a>` : "").join("");
    return `<div class="stack"><section class="panel"><div class="section-heading"><div><p class="eyebrow">模型参数</p><h2>大类资产约束</h2></div></div><div class="table-wrap"><table><thead><tr><th>资产</th><th>战略中枢</th><th>下限</th><th>上限</th><th>信号敏感度/分</th><th>调仓阈值</th></tr></thead><tbody>${params}</tbody></table></div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">点位锚</p><h2>上证指数—股票基础仓位</h2></div></div><div class="anchor-grid">${INDEX_ANCHORS.map((item) => `<div><strong>${item.point}</strong><span>${pct(item.position, 0)}</span></div>`).join("")}</div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">治理原则</p><h2>更新、复核与边界</h2></div></div><ol class="method-list"><li><strong>股票先定总仓位：</strong>点位分段线性插值，基本面、流动性、趋势与风险信号只做有限修正。</li><li><strong>剩余预算再分配：</strong>债券、商品、另类先形成各自原始目标，再在非股票预算内按相对强弱分配。</li><li><strong>上下限硬约束：</strong>所有目标不得突破产品约束，残差按可用空间二次分配并归一到100%。</li><li><strong>阈值抑制换手：</strong>偏离不足阈值时只观察，达到阈值才生成增配或减配动作。</li><li><strong>证据化评分：</strong>定时任务记录来源、时间与结论；证据不足保持原值或中性，不猜测。</li><li><strong>人工复核边界：</strong>极端行情可临时触发，但政策、地缘和执行约束仍应由负责人复核。</li></ol></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">数据来源</p><h2>本期证据清单</h2></div></div><div class="source-list">${sources || `<div class="muted">本期暂无可打开的来源链接。</div>`}</div></section></div>`;
  }

  function advisoryHeader(eyebrow, title, summary) {
    return `<section class="advisory-hero"><div><p class="eyebrow">${E(eyebrow)}</p><h2>${E(title)}</h2><p>${E(summary)}</p></div><div class="hero-meta"><span>研究数据截至</span><strong>${E(state.advisory.dataThrough)}</strong><small>缺失数据不推测</small></div></section>`;
  }

  function renderMacro() {
    const data = state.advisory;
    const pillars = data.macroPillars.map((item) => `<article class="insight-card"><div class="card-kicker"><span>${E(item.name)}</span><strong>${E(item.weight)}</strong></div><h3>${E(item.signal)} · ${E(item.direction)}</h3><p>${E(item.evidence)}</p><small>作用：${E(item.role)}<br>覆盖 ${E(item.coverage)} · 观察：${E(item.watch)}</small></article>`).join("");
    const history = data.macroHistory.series.map((item) => `<tr><td><strong>${E(item.metric)}</strong><span class="table-sub">${E(item.unit)}</span></td>${item.values.map((value) => `<td>${E(Number(value).toFixed(1))}</td>`).join("")}<td>${E(item.interpretation)}</td></tr>`).join("");
    const indicators = data.macroIndicators.map((item) => `<tr><td>${E(item.id)}</td><td><strong>${E(item.primary)}</strong><span class="table-sub">${E(item.secondary)}</span></td><td><strong>${E(item.name)}</strong><span class="table-sub ${item.status === "已核验" ? "verified-text" : "pending-text"}">${E(item.status)}</span></td><td>${E(item.frequency)}</td><td><strong>${E(item.currentValue || "—")}</strong><span class="table-sub">${E(item.period || "—")}</span></td><td>${E(item.prior || "—")}<span class="table-sub">${E(item.trend || "—")}</span></td><td>${item.score == null ? "—" : `<span class="macro-score s${E(item.score)}">${E(item.score)}</span>`}</td><td>${E(item.purpose)}<span class="table-sub">${E(item.assetMeaning || "待核验后补充")}</span></td><td>${E(item.currentSource || item.expectedSource)}</td></tr>`).join("");
    const transmission = data.assetTransmission.map((item) => `<tr><td><strong>${E(item.driver)}</strong></td><td>${E(item.current)}</td><td>${E(item.equity)}</td><td>${E(item.bond)}</td><td>${E(item.commodity)}</td><td>${E(item.gold)}</td><td>${E(item.alternatives)}</td></tr>`).join("");
    const scenarios = data.scenarios.map((item) => `<article class="scenario-card"><span>${E(item.name)}</span><h3>${E(item.description)}</h3><p><strong>触发：</strong>${E(item.trigger)}</p><p><strong>动作：</strong>${E(item.action)}</p></article>`).join("");
    const meetings = data.policyMeetings.map((item) => `<article class="meeting-row"><time>${E(item.date)}</time><div><h3>${E(item.title)}</h3><p>${E(item.core)}</p><small>配置映射：${E(item.mapping)}</small></div><a href="${E(item.url)}" target="_blank" rel="noreferrer">官方原文 ↗</a></article>`).join("");
    const sources = data.sources.map((item) => item.url ? `<a href="${E(item.url)}" target="_blank" rel="noreferrer"><div><strong>${E(item.label)}</strong><span>${E(item.date)} · ${E(item.scope)}</span></div><span>打开来源 ↗</span></a>` : `<div class="source-static"><div><strong>${E(item.label)}</strong><span>${E(item.date)} · ${E(item.scope)}</span></div><span>内部资料</span></div>`).join("");
    return `<div class="stack">${advisoryHeader("MACRO REGIME", `${data.macroState} · ${data.regime}`, data.coreConflict)}
      <section class="note-strip">${E(data.macroNote)}</section>
      <section class="insight-grid">${pillars}</section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">HISTORICAL REGIME</p><h2>2022—2026 关键宏观序列</h2></div><span class="muted">${E(data.macroHistory.note)}</span></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>指标</th>${data.macroHistory.periods.map((p) => `<th>${E(p)}</th>`).join("")}<th>专业解读</th></tr></thead><tbody>${history}</tbody></table></div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">67-INDICATOR LIBRARY</p><h2>Excel 全量指标、当前值与评分</h2></div><span class="muted">已核验 ${E(data.macroFramework.verifiedIndicators)} / ${E(data.macroFramework.totalIndicators)}</span></div><div class="table-wrap indicator-table"><table class="dense-table"><thead><tr><th>ID</th><th>一级/二级</th><th>三级指标</th><th>频率</th><th>本期值</th><th>历史/方向</th><th>分</th><th>用途/资产含义</th><th>来源</th></tr></thead><tbody>${indicators}</tbody></table></div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">MACRO TO ASSET</p><h2>宏观变量如何传导到资产</h2></div></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>驱动</th><th>当前</th><th>权益</th><th>债券</th><th>商品</th><th>黄金</th><th>另类</th></tr></thead><tbody>${transmission}</tbody></table></div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">SCENARIO MATRIX</p><h2>基准、上行与下行情景</h2></div></div><div class="scenario-grid">${scenarios}</div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">POLICY TRACKER</p><h2>核心会议跟踪与配置映射</h2></div><span class="muted">政策跟踪是宏观输入，不是最终站点</span></div><div class="meeting-list">${meetings}</div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">PRIMARY SOURCES</p><h2>本期宏观证据</h2></div></div><div class="source-list">${sources}</div></section></div>`;
  }

  function renderAssets() {
    const data = state.advisory;
    const snapshots = data.marketSnapshots.map((item) => `<article class="market-card"><span>${E(item.name)}</span><strong class="${String(item.ytd).startsWith("−") ? "negative" : "positive"}">${E(item.ytd)}</strong><small>YTD · ${E(item.asOf)}</small></article>`).join("");
    const dimensions = data.assetRatingDimensions.map((item) => `<article class="dimension-card"><strong>${E(item.weight)}</strong><span>${E(item.name)}</span><p>${E(item.question)}</p></article>`).join("");
    const scorecards = data.assetScorecards.map((item) => `<tr><td><strong>${E(item.asset)}</strong></td><td><span class="stance">${E(item.stance)}</span></td><td>${E(item.macro)}</td><td>${E(item.valuation)}</td><td>${E(item.carry)}</td><td>${E(item.trend)}</td><td>${E(item.liquidity)}</td><td>${E(item.risk)}</td><td><strong>${E(item.conclusion)}</strong></td></tr>`).join("");
    const memoEvolution = data.memoEvolution.map((item) => `<tr><td><strong>${E(item.period)}</strong><span class="table-sub">${E(item.source)}</span></td><td>${E(item.chinaEquity)}</td><td>${E(item.overseasEquity)}</td><td>${E(item.domesticBond)}</td><td>${E(item.overseasBond)}</td><td>${E(item.cta)}</td><td>${E(item.evidence)}</td><td><strong>${E(item.review)}</strong></td></tr>`).join("");
    const valuations = data.equityValuations.map((item) => `<tr><td><strong>${E(item.name)}</strong></td><td>${E(item.erp)}</td><td>${E(item.pe)}</td><td>${E(item.pePct)}</td><td>${E(item.pb)}</td><td>${E(item.pbPct)}</td><td>${E(item.ps)}</td><td>${E(item.psPct)}</td><td>${E(item.roe)}</td><td>${E(item.dividend)}</td><td>${E(item.read)}</td></tr>`).join("");
    const styles = data.styleValuations.map((item) => `<tr><td><strong>${E(item.style)}</strong></td><td>${E(item.erp)}</td><td>${E(item.pe)} / ${E(item.pePct)}%</td><td>${E(item.pb)} / ${E(item.pbPct)}%</td><td>${E(item.roe)}</td><td>${E(item.dividend)}</td><td>${E(item.revenueGrowth)}</td><td>${E(item.profitGrowth)}</td><td><span class="stance">${E(item.view)}</span></td><td>${E(item.logic)}</td></tr>`).join("");
    return `<div class="stack">${advisoryHeader("CROSS-ASSET", "大类资产表现、估值赔率与建议", "从宏观匹配、估值、盈利或 Carry、趋势、流动性和尾部风险推导观点。")} 
      <section class="market-grid">${snapshots}</section>
      <section class="dimension-grid">${dimensions}</section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">MEMO EVOLUTION</p><h2>三份内参的观点演变</h2></div><span class="muted">历史观点用于复核，不等于当前建议</span></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>时点/资料</th><th>中国权益</th><th>境外权益</th><th>境内债</th><th>境外债</th><th>CTA/黄金</th><th>当期证据</th><th>观点演变</th></tr></thead><tbody>${memoEvolution}</tbody></table></div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">ASSET SCORECARD</p><h2>大类资产完整推导表</h2></div><span class="muted">不替代第五部分组合约束</span></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>资产</th><th>观点</th><th>宏观</th><th>估值/赔率</th><th>盈利/Carry</th><th>趋势/资金</th><th>流动性</th><th>风险</th><th>实施</th></tr></thead><tbody>${scorecards}</tbody></table></div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">VALUATION & ODDS</p><h2>中国、港股与美股估值赔率</h2></div><span class="muted">内参截至 2026-07-18</span></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>指数</th><th>ERP%</th><th>PE</th><th>PE分位%</th><th>PB</th><th>PB分位%</th><th>PS</th><th>PS分位%</th><th>ROE%</th><th>股息%</th><th>判断</th></tr></thead><tbody>${valuations}</tbody></table></div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">STYLE ODDS</p><h2>价值、成长与红利</h2></div></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>风格</th><th>ERP%</th><th>PE/分位</th><th>PB/分位</th><th>ROE%</th><th>股息%</th><th>收入%</th><th>利润%</th><th>观点</th><th>推导</th></tr></thead><tbody>${styles}</tbody></table></div></section></div>`;
  }

  function renderMeso() {
    const data = state.advisory;
    const regions = data.regionalIndicators.map((item) => `<tr><td><strong>${E(item.region)}</strong></td><td>${E(item.growth)}</td><td>${E(item.inflation)}</td><td>${E(item.rates)}</td><td>${E(item.earnings)}</td><td>${E(item.valuation)}</td><td>${E(item.industries)}</td><td><span class="stance">${E(item.stance)}</span></td><td>${E(item.missing)}</td></tr>`).join("");
    const lenses = data.mesoLenses.map((item, index) => `<article class="insight-card"><div class="card-kicker"><span>0${index + 1}</span><strong>${E(item.lens)}</strong></div><h3>${E(item.metrics)}</h3><p>${E(item.decision)}</p></article>`).join("");
    const styles = data.styles.map((item) => `<article class="style-card"><div><span>${E(item.factor)}</span><strong>${E(item.reading)}</strong></div><h3>${E(item.signal)}</h3><p>${E(item.action)}</p></article>`).join("");
    const industries = data.industries.map((item) => `<tr><td><strong>${E(item.name)}</strong></td><td>${E(item.erp)}</td><td>${E(item.pe == null ? "—" : item.pe)} / ${E(item.pePct == null ? "—" : `${item.pePct}%`)}</td><td>${E(item.pb)} / ${E(item.pbPct)}%</td><td>${E(item.roe)}</td><td>${E(item.dividend)}</td><td>${E(item.revenueGrowth)}</td><td>${E(item.profitGrowth)}</td><td><span class="stance">${E(item.stance)}</span></td><td>${E(item.logic)}</td></tr>`).join("");
    return `<div class="stack">${advisoryHeader("MESO LAYER", "区域、风格与产业中观框架", "盈利、估值、供需、资本开支、资金拥挤与全球映射六层交叉。")} 
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">REGIONAL MAP</p><h2>中国、日韩、美国与全球同表比较</h2></div><span class="muted">缺失数据明确留空</span></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>区域</th><th>增长</th><th>通胀</th><th>利率</th><th>盈利</th><th>估值</th><th>产业</th><th>观点</th><th>待补数据</th></tr></thead><tbody>${regions}</tbody></table></div></section>
      <section class="insight-grid six-lenses">${lenses}</section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">STYLE MONITOR</p><h2>中国市场风格仪表盘</h2></div></div><div class="style-monitor-grid">${styles}</div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">INDUSTRY MATRIX</p><h2>11 个行业：估值、质量与盈利同表</h2></div><span class="muted">估值 2026-07-18；盈利 2026-03-31</span></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>行业</th><th>ERP%</th><th>PE/分位</th><th>PB/分位</th><th>ROE%</th><th>股息%</th><th>收入%</th><th>利润%</th><th>观点</th><th>判断</th></tr></thead><tbody>${industries}</tbody></table></div></section></div>`;
  }

  function renderMicro() {
    const data = state.advisory;
    const coverage = data.productCoverage.map((item) => `<span>${E(item)}</span>`).join("");
    const benchmarks = data.benchmarks.map((item) => `<tr><td><strong>${E(item.name)}</strong></td><td class="negative">${E(item.mtd)}</td><td class="${String(item.ytd).startsWith("−") ? "negative" : "positive"}">${E(item.ytd)}</td><td>${E(item.sharpe)}</td><td class="negative">${E(item.drawdown)}</td></tr>`).join("");
    const implementation = data.implementationMap.map((item) => `<tr><td><strong>${E(item.objective)}</strong></td><td>${E(item.macro)}</td><td>${E(item.asset)}</td><td>${E(item.meso)}</td><td><span class="stance">${E(item.preferred)}</span></td><td>${E(item.candidates)}</td><td><strong>${E(item.action)}</strong></td></tr>`).join("");
    const etfs = data.etfCandidates.map((item) => `<tr><td><strong>${E(item.code)}</strong><span class="table-sub">${E(item.name)}</span></td><td>${E(item.role)}</td><td>${E(item.benchmark)}</td><td><span class="stance">${E(item.currentView)}</span></td><td>${E(item.aum || "—")}</td><td>${E(item.trackingError || "—")}</td><td>${E(item.avgTurnover || "—")}</td><td>${E(item.totalFee || "—")}</td><td>${E(item.score || "—")}</td><td>${E(item.missing)}<span class="table-sub"><a href="${E(item.source)}" target="_blank" rel="noreferrer">交易所来源 ↗</a></span></td></tr>`).join("");
    const privateRows = data.privateStrategyMatrix.map((item) => `<tr><td><strong>${E(item.strategy)}</strong></td><td>${E(item.mustSee)}</td><td>${E(item.macroLink)}</td><td>${E(item.currentUse)}</td><td class="pending-text">${E(item.status)}</td></tr>`).join("");
    const rating = data.productRatingModels.map((model) => `<article class="rating-card"><h3>${E(model.type)}</h3><p>${E(model.grade)}</p>${model.dimensions.map((item) => `<div><span>${E(item[0])}</span><b>${E(item[1])}%</b><small>${E(item[2])}</small></div>`).join("")}</article>`).join("");
    return `<div class="stack">${advisoryHeader("MICRO LAYER", "公募、ETF 与私募产品评价", "分工具建立指标、评级和准入门，并把宏观—资产—中观观点落实到产品。")} 
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">PRODUCT UNIVERSE</p><h2>已覆盖的 11 类策略</h2></div><span class="muted">产品池更新日 2026-07-24</span></div><div class="tag-cloud">${coverage}</div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">TOP-DOWN TO PRODUCT</p><h2>宏观—资产—中观—产品实施链</h2></div></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>目标</th><th>宏观</th><th>资产</th><th>中观</th><th>工具</th><th>候选</th><th>动作</th></tr></thead><tbody>${implementation}</tbody></table></div></section>
      <section class="two-column micro-layout"><article class="panel"><div class="section-heading"><div><p class="eyebrow">MARKET CONTEXT</p><h2>产品评价基准压力</h2></div></div><div class="table-wrap"><table><thead><tr><th>基准</th><th>MTD</th><th>YTD</th><th>Sharpe</th><th>近1年回撤</th></tr></thead><tbody>${benchmarks}</tbody></table></div></article><article class="note-strip warning"><strong>${E(data.ratingPolicy.title)}</strong><br>${E(data.ratingPolicy.dataGate)}</article></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">PUBLIC VEHICLES</p><h2>公开 ETF 候选与待补数据</h2></div><span class="muted">缺数据不评分</span></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>代码/产品</th><th>角色</th><th>基准</th><th>判断</th><th>规模</th><th>跟踪</th><th>成交</th><th>费率</th><th>分</th><th>缺口/来源</th></tr></thead><tbody>${etfs}</tbody></table></div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">PRIVATE STRATEGIES</p><h2>11 类私募策略评价方法</h2></div></div><div class="table-wrap"><table class="dense-table"><thead><tr><th>策略</th><th>必须分析</th><th>宏观/中观连接</th><th>当前用途</th><th>状态</th></tr></thead><tbody>${privateRows}</tbody></table></div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">INTERNAL RATING</p><h2>ETF、主动公募、私募分别评级</h2></div></div><div class="rating-grid">${rating}</div></section></div>`;
  }

  function renderAllocation(model) {
    const labels = { overview: "配置总览", factors: "市场因子", suballocation: "细分配置", stress: "情景压力", method: "参数与方法" };
    const renderer = { overview: renderOverview, factors: renderFactors, suballocation: renderSubAllocation, stress: renderStress, method: renderMethod }[state.allocationTab];
    const buttons = Object.entries(labels).map(([key, label]) => `<button data-allocation-tab="${key}" class="${state.allocationTab === key ? "active" : ""}">${label}</button>`).join("");
    return `<div class="stack">${advisoryHeader("PORTFOLIO ENGINE", "资产配置与调仓建议", "保留持仓、因子、细分资产、压力测试和参数方法，并接受前四层研究输入。")}<nav class="tabs allocation-tabs" aria-label="资产配置页面">${buttons}</nav><div>${renderer(model)}</div></div>`;
  }

  function render() {
    if (!state.payload || !state.advisory) return;
    const model = calculateModel(state.payload);
    const renderer = { macro: renderMacro, assets: renderAssets, meso: renderMeso, micro: renderMicro, allocation: () => renderAllocation(model) }[state.tab];
    $("content").innerHTML = renderer();
    $("freshness").textContent = freshness(state.payload);
    $("data-date").textContent = `数据日 ${state.payload.asOf}`;
    const statusLabels = { verified: "本期数据已核验", partial: "部分数据已核验", seed: "初始模板数据" };
    $("data-banner").className = `data-banner ${state.payload.status}`;
    $("data-status").textContent = statusLabels[state.payload.status] || "数据状态";
    $("data-note").textContent = state.payload.notes?.[0] || "数据已同步";
  }

  function showLogin(message = "") {
    $("app-view").hidden = true;
    $("login-view").hidden = false;
    $("login-error").textContent = message;
    window.setTimeout(() => $("password").focus(), 0);
  }

  function showApp() {
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    render();
  }

  async function loadData({ silent = false } = {}) {
    if (!silent) $("content").innerHTML = `<div class="panel loading-panel"><span class="loading-dot"></span>正在加载最新数据…</div>`;
    const response = await fetch("/api/data", { cache: "no-store" });
    if (response.status === 401) { showLogin(); return false; }
    if (!response.ok) throw new Error("数据服务暂时不可用");
    const result = await response.json();
    const changed = state.payload && state.payload.collectedAt !== result.payload.collectedAt;
    state.payload = result.payload;
    state.advisory = result.advisory;
    showApp();
    if (changed) {
      $("sync-message").textContent = "已同步最新数据";
      window.setTimeout(() => { $("sync-message").textContent = ""; }, 3000);
    }
    return true;
  }

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    $("login-error").textContent = "";
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("password").value }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "授权失败");
      $("password").value = "";
      await loadData();
    } catch (error) {
      $("login-error").textContent = error.message || "授权失败，请重试。";
    } finally {
      button.disabled = false;
    }
  });

  $("tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    state.tab = button.dataset.tab;
    document.querySelectorAll("#tabs button").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });

  $("content").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-allocation-tab]");
    if (!button) return;
    state.allocationTab = button.dataset.allocationTab;
    render();
  });

  $("refresh-button").addEventListener("click", async () => {
    if (state.refreshing) return;
    state.refreshing = true;
    $("refresh-button").disabled = true;
    $("refresh-button").textContent = "同步中…";
    try { await loadData({ silent: true }); }
    catch { $("sync-message").textContent = "同步失败，将自动重试"; }
    finally { state.refreshing = false; $("refresh-button").disabled = false; $("refresh-button").textContent = "同步最新"; }
  });

  $("logout-button").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    state.payload = null;
    state.advisory = null;
    showLogin();
  });

  window.setInterval(() => {
    if (!$("app-view").hidden && document.visibilityState === "visible") loadData({ silent: true }).catch(() => {});
  }, 60000);

  loadData().catch(() => showLogin("数据服务暂时不可用，请稍后重试。"));
})();
