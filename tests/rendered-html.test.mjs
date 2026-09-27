import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the advisory portal password protected", async () => {
  const [page, login, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LoginForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /isAuthorized/);
  assert.match(page, /<LoginForm/);
  assert.match(login, /访问密码/);
  assert.match(login, /数据仅供授权人员查看/);
  assert.match(layout, /资产配置工作台/);
});

test("keeps the five-layer framework and the complete allocation engine", async () => {
  const source = await readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8");
  for (const label of ["宏观", "大类资产", "中观", "微观", "资产配置"]) assert.match(source, new RegExp(label));
  for (const label of ["配置总览", "市场因子", "细分配置", "情景压力", "参数与方法"]) assert.match(source, new RegExp(label));
  assert.match(source, /currentHoldings|item\.current/);
  assert.match(source, /核心会议跟踪与解读/);
});

test("publishes dated, source-backed advisory content", async () => {
  const data = JSON.parse(await readFile(new URL("../app/data/advisory.json", import.meta.url), "utf8"));
  assert.match(data.dataThrough, /指标分项截至 2026-09-24/);
  assert.equal(data.macroPillars.length, 4);
  assert.equal(data.macroIndicators.length, 62);
  assert.equal(data.macroFramework.totalIndicators, 62);
  assert.equal(data.macroFramework.verifiedIndicators, 62);
  assert.ok(data.macroIndicators.every((item) => item.status === "已核验"));
  assert.ok(data.macroIndicators.every((item) => !["M01", "M30", "M32", "M59", "M67"].includes(item.id)));
  const indicator = (id) => data.macroIndicators.find((item) => item.id === id);
  assert.equal(indicator("M02").currentValue, "4.3%");
  assert.match(indicator("M02").period, /Q2（单季同比）/);
  assert.equal(indicator("M04").currentValue, "约1.5%");
  assert.match(indicator("M04").period, /单季同比，推算/);
  assert.equal(indicator("M22").currentValue, "17.6%");
  assert.equal(indicator("M22").period, "2026年1—7月累计");
  assert.equal(indicator("M27").period, "2026年1—8月累计");
  assert.equal(indicator("M49").period, "2026-08（月末）");
  assert.equal(indicator("M60").period, "2026-09-20");
  assert.ok(data.macroIndicators.some((item) => item.scoreRules?.score5));
  assert.deepEqual(data.macroHistory.periods, ["2022", "2023", "2024", "2025"]);
  assert.equal(data.macroHistory.series.length, 12);
  assert.ok(data.macroHistory.series.every((item) => item.values.length === 4 && item.values.every(Number.isFinite)));
  assert.ok(data.macroHistory.series.every((item) => !item.latestIndicatorId || indicator(item.latestIndicatorId)));
  assert.ok(data.macroHistory.annualSources.every((source) => source.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.macroHistory.series.some((item) => item.metric === "社融存量增速" && item.latestIndicatorId === "M49"));
  assert.ok(data.macroHistory.series.some((item) => item.metric === "新建商品房销售面积" && item.latestIndicatorId === "M26"));
  assert.ok(data.macroHistory.series.every((item) => ["经济运行", "增长动力", "金融信贷", "政策制度"].includes(item.group)));
  assert.ok(data.macroHistory.series.every((item) => !item.latestIndicatorId || item.group === indicator(item.latestIndicatorId).primary));
  assert.ok(data.macroHistory.leadingSignals.some((item) => item.label === "制造业 PMI 新订单"));
  assert.ok(data.assetViews.length >= 8);
  assert.ok(data.assetScorecards.length >= 8);
  assert.equal(data.memoEvolution.length, 3);
  assert.deepEqual(data.memoEvolution.map((item) => item.period), ["2025 Q3", "2025 Q4", "2026 中期"]);
  assert.ok(data.equityValuations.some((item) => item.name === "中证A500"));
  assert.ok(data.styleValuations.some((item) => item.style === "红利"));
  assert.ok(data.industries.some((item) => item.name === "信息技术" && Number.isFinite(item.profitGrowth)));
  assert.ok(data.regionalIndicators.some((item) => item.region === "日本"));
  assert.ok(data.regionalIndicators.some((item) => item.region === "韩国"));
  assert.equal(data.productRatingModels.length, 3);
  assert.ok(data.etfCandidates.every((item) => item.score === null));
  assert.equal(data.privateStrategyMatrix.length, 11);
  assert.ok(data.policyMeetings.every((item) => item.url.startsWith("https://")));
});

test("puts verified within-year macro paths before annual context", async () => {
  const [source, data, advisory] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/macro-intrayear.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/data/advisory.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(source, /2026 逐期变化/);
  assert.match(source, /history-annual-details/);
  assert.match(source, /<IntrayearChart/);
  assert.match(source, /onPointerMove=.*nearestIndex/);
  assert.match(source, /onClick=.*setSelectedIndex/);
  assert.match(source, /intrayear-tooltip/);
  assert.equal(data.series.length, 23);
  assert.ok(data.series.every((item) => item.periods.length === item.values.length && item.values.length >= (item.metric === "GDP 平减指数" ? 2 : 6)));
  assert.ok(data.series.every((item) => item.values.every(Number.isFinite)));
  assert.equal(data.series.find((item) => item.metric === "GDP 单季实际增速").values.at(-1), 4.3);
  assert.deepEqual(data.series.find((item) => item.metric === "规模以上工业增加值").periods.slice(0, 2), ["1—2月", "3月"]);
  assert.equal(data.series.find((item) => item.metric === "规模以上工业企业利润").periods.at(-1), "1—7月");
  assert.deepEqual(data.series.find((item) => item.metric === "核心 CPI").values, [0.8, 1.8, 1.1, 1.2, 1.1, 1.0, 0.9, 1.0]);
  const cpi = data.series.find((item) => item.metric === "CPI");
  const ppi = data.series.find((item) => item.metric === "PPI");
  const priceGap = data.series.find((item) => item.metric === "PPI－CPI 剪刀差");
  assert.deepEqual(priceGap.periods, cpi.periods);
  assert.deepEqual(priceGap.periods, ppi.periods);
  assert.deepEqual(priceGap.values, ppi.values.map((value, index) => Number((value - cpi.values[index]).toFixed(1))));
  assert.equal(priceGap.unit, "个百分点");
  assert.deepEqual(priceGap.derivedFrom, ["PPI", "CPI"]);
  assert.match(source, /"CPI", "PPI", "核心 CPI", "PPI－CPI 剪刀差"/);
  assert.deepEqual(data.series.find((item) => item.metric === "民间固定资产投资").values, [-2.6, -2.2, -5.2, -7.1, -8.5, -9.4, -10.1]);
  assert.deepEqual(data.series.find((item) => item.metric === "社融存量增速").values, [8.2, 8.2, 7.9, 7.8, 7.7, 7.4, 7.4, 7.2]);
  assert.deepEqual(data.series.find((item) => item.metric === "GDP 平减指数").values, [-0.1, 1.5]);
  assert.deepEqual(data.series.find((item) => item.metric === "GDP 平减指数").alternate.values, [-0.1, 0.7]);
  assert.match(source, /GDP 平减指数统计口径/);
  assert.match(source, /年初累计同比<\/button>/);
  const economic = data.series.filter((item) => item.group === "经济运行");
  assert.deepEqual([...new Set(economic.map((item) => item.subgroup))].sort(), ["经济增长", "物价水平", "国际收支", "景气指数", "就业市场"].sort());
  assert.equal(economic.find((item) => item.metric === "GDP 平减指数").subgroup, "经济增长");
  assert.equal(economic.find((item) => item.metric === "非制造业 PMI").subgroup, "景气指数");
  assert.equal(economic.find((item) => item.metric === "外汇储备").subgroup, "国际收支");
  const compositePmi = economic.find((item) => item.metric === "综合 PMI 产出指数");
  assert.deepEqual(compositePmi.values, [49.8, 49.5, 50.5, 50.1, 50.5, 50.6, 49.3, 49.5]);
  assert.equal(compositePmi.subgroup, "景气指数");
  assert.equal(compositePmi.values.at(-1).toFixed(1), advisory.macroIndicators.find((item) => item.id === "M18").currentValue);
  const consumerConfidence = economic.find((item) => item.metric === "消费者信心指数");
  assert.deepEqual(consumerConfidence.periods, ["1月", "2月", "3月", "4月", "5月", "6月", "7月"]);
  assert.deepEqual(consumerConfidence.values, [90.6, 91.6, 90, 89, 89.9, 89.4, 89.2]);
  assert.equal(consumerConfidence.subgroup, "景气指数");
  assert.equal(consumerConfidence.unit, "点");
  assert.equal(consumerConfidence.values.at(-1).toFixed(1), advisory.macroIndicators.find((item) => item.id === "M20").currentValue);
  assert.match(consumerConfidence.source, /Wind EDB M0012303/);
  assert.match(source, /metric === "消费者信心指数" \? 100 : metric.includes\("PMI"\) \? 50/);
  assert.match(source, /按五类查看/);
  assert.deepEqual(data.series.find((item) => item.metric === "非制造业 PMI").values, [49.4, 49.5, 50.1, 49.4, 50.1, 50.2, 49.0, 49.0]);
  assert.deepEqual(data.series.find((item) => item.metric === "外汇储备").values, [33991, 34278, 33421, 34105, 34422, 34163, 34188, 34383]);
  assert.deepEqual(data.series.find((item) => item.metric === "国际收支货物贸易差额").values, [1004, 703, 678, 741, 859, 1188, 1103]);
  assert.deepEqual(data.series.find((item) => item.metric === "国际收支服务贸易差额").values, [-176, -184, -243, -148, -180, -193, -191]);
  assert.equal(data.series.filter((item) => item.section === "外部收支").length, 3);
  assert.match(source, /展开国际收支曲线/);
  const growth = data.series.filter((item) => item.group === "增长动力");
  assert.deepEqual([...new Set(growth.map((item) => item.subgroup))].sort(), ["投资", "消费", "工业生产", "房地产"].sort());
  assert.ok(growth.every((item) => item.subgroup));
  assert.ok(!growth.some((item) => item.metric === "货物进出口总额"));
  assert.match(source, /<GoodsTradeCards/);
  assert.match(source, /<PopulationStructureChart/);
  assert.match(source, /<InwardFdiChart/);
  for (const [metric, indicatorId] of [["核心 CPI", "M07"], ["民间固定资产投资", "M38"], ["社融存量增速", "M49"]]) {
    const latest = data.series.find((item) => item.metric === metric).values.at(-1);
    assert.equal(`${latest.toFixed(1)}%`, advisory.macroIndicators.find((item) => item.id === indicatorId).currentValue);
  }
  assert.deepEqual([...new Set(data.series.map((item) => item.group))].sort(), ["经济运行", "增长动力", "金融信贷", "政策制度"].sort());
  assert.match(source, /"经济运行", "增长动力", "金融信贷", "政策制度"/);
  assert.match(source, /后续候选曲线/);
  assert.equal(data.series.find((item) => item.metric === "制造业 PMI").role, "领先观察");
  assert.equal(data.series.find((item) => item.metric === "规模以上工业企业利润").role, "滞后验证");
  assert.ok(data.activitySources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.fiscalSources.every((item) => item.url.includes("mof.gov.cn/")));
  assert.equal(data.coreCpiSources.length, 8);
  assert.equal(data.privateInvestmentSources.length, 7);
  assert.equal(data.creditSources.length, 8);
  assert.equal(data.deflatorSources.length, 3);
  assert.equal(data.nonManufacturingPmiSources.length, 8);
  assert.equal(data.reserveSources.length, 8);
  assert.equal(data.tradeSources.length, 7);
  assert.ok(data.nonManufacturingPmiSources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.reserveSources.every((item) => item.url.startsWith("https://www.safe.gov.cn/")));
  assert.ok(data.tradeSources.every((item) => item.url.startsWith("https://www.safe.gov.cn/")));
  assert.ok(data.coreCpiSources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.privateInvestmentSources.every((item) => item.url.startsWith("https://www.stats.gov.cn/")));
  assert.ok(data.creditSources.every((item) => item.url.startsWith("https://www.pbc.gov.cn/")));
  assert.deepEqual(data.planned.map((item) => item.indicatorId), ["M36", "M54", "M62"]);
});

test("keeps population, inward FDI and four goods-trade views source-backed and separate", async () => {
  const data = JSON.parse(await readFile(new URL("../app/data/macro-additional.json", import.meta.url), "utf8"));
  const source = await readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8");
  assert.equal(data.population.rows.length, 36);
  assert.deepEqual(data.population.rows.map((row) => row[0]), Array.from({ length: 36 }, (_, index) => 1990 + index));
  assert.ok(data.population.rows.every((row) => Math.abs(row[1] + row[2] + row[3] - 100) <= 0.11));
  const counts = data.population.latestCountsWan;
  assert.equal(counts.age0to14 + counts.age15to64 + counts.age65plus, counts.total);
  assert.ok(data.population.rows.at(-1).slice(1).every((share, index) => Math.abs(share - [counts.age0to14, counts.age15to64, counts.age65plus][index] / counts.total * 100) < .001));
  assert.match(data.population.yearbookUrl, /^https:\/\/www\.stats\.gov\.cn\//);
  assert.match(source, /人口结构占比/);
  assert.match(source, /实际使用外资/);
  assert.equal(data.inwardFdi.rows.length, 8);
  assert.ok(data.inwardFdi.rows.every((row, index, rows) => index === 0 || row.amount > rows[index - 1].amount));
  assert.deepEqual([data.inwardFdi.rows.at(-1).amount, data.inwardFdi.rows.at(-1).yoy], [4799.5, -5.3]);
  assert.ok(data.inwardFdi.rows.every((row) => row.url.includes("mofcom.gov.cn/")));
  assert.equal(data.goodsTrade.rows.length, 8);
  assert.ok(data.goodsTrade.rows.every((row) => Math.abs(row.export - row.import - row.surplus) <= .02));
  assert.deepEqual([data.goodsTrade.rows.at(-1).export, data.goodsTrade.rows.at(-1).import, data.goodsTrade.rows.at(-1).surplus], [4014.41, 2823.56, 1190.85]);
  assert.match(data.goodsTrade.sourceUrl, /^https:\/\/data\.mofcom\.gov\.cn\//);
  assert.equal(data.ccfi.rows.length, 8);
  assert.equal(data.ccfi.rows.at(-1).value, 1835.55);
  assert.ok(data.ccfi.rows.every((row) => row.url.startsWith("https://www.mot.gov.cn/")));
  for (const label of ["出口金额与增速", "进口金额与增速", "货物贸易顺差", "出口集装箱运价指数（CCFI）"]) assert.match(source, new RegExp(label.replace(/[()]/g, "\\$&")));
});

test("uses the wine, ochre and warm-gray palette across the workbench", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--teal: #741918;/);
  assert.match(css, /--commodity: #bc9157;/);
  assert.match(css, /--bond: #818a7d;/);
  assert.match(css, /--canvas: #f7f5f1;/);
  for (const selector of [".login-shell", ".topbar", ".research-summary", ".intrayear-line", ".annual-sparkline polyline", ".allocation-intro", ".scenario-fill", ".rating-policy"]) assert.ok(css.includes(selector));
  assert.match(css, /\.intrayear-line[^\n]*stroke: var\(--teal\)/);
  assert.match(css, /\.annual-sparkline polyline[^\n]*stroke: var\(--teal\)/);
  assert.doesNotMatch(css, /--teal: #1f7a7a|--navy: #102a43/);
});

test("keeps the domestic mirror password protected and feature complete", async () => {
  const [html, client, handler, publisher] = await Promise.all([
    readFile(new URL("../cloudbase-proxy/public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../cloudbase-proxy/public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../cloudbase-proxy/index.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/publish-data-cloudbase.mjs", import.meta.url), "utf8"),
  ]);
  for (const label of ["宏观", "大类资产", "中观", "微观", "资产配置"]) assert.match(html, new RegExp(label));
  for (const label of ["配置总览", "市场因子", "细分配置", "情景压力", "参数与方法"]) assert.match(client, new RegExp(label));
  for (const label of ["67-INDICATOR LIBRARY", "三份内参的观点演变", "VALUATION & ODDS", "PRIVATE STRATEGIES", "INTERNAL RATING"]) assert.match(client, new RegExp(label));
  assert.match(handler, /if \(!isAuthorized\(event\)\) return json\(401/);
  assert.match(handler, /advisory = JSON\.parse/);
  assert.match(publisher, /app", "data", "advisory\.json/);
});
