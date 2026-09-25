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
  assert.equal(data.dataThrough, "2026-08 / 2026-01—08");
  assert.equal(data.macroPillars.length, 4);
  assert.equal(data.macroIndicators.length, 67);
  assert.equal(data.macroFramework.totalIndicators, 67);
  assert.ok(data.macroFramework.verifiedIndicators < data.macroFramework.totalIndicators);
  assert.ok(data.macroIndicators.some((item) => item.status === "待采集" && item.currentValue === null));
  assert.ok(data.macroIndicators.some((item) => item.scoreRules?.score5));
  assert.equal(data.macroHistory.periods.length, 5);
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
