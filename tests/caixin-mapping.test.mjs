import assert from "node:assert/strict";
import test from "node:test";
import { mapCaixinSeries } from "../lib/caixin-mapping.ts";

test("enables only an exact, populated, same-frequency and same-unit match", () => {
  const [decision] = mapCaixinSeries([
    { id: "M02", name: "GDP同比增速", frequency: "季度", unit: "%", expectedSource: "国家统计局" },
  ], [{ series_id: "702", name: "中国GDP同比增速", frequency: "Q", unit: "%", source: "国家统计局", has_data: true }]);
  assert.equal(decision.enabled, true);
  assert.equal(decision.seriesId, "702");
});

test("keeps missing data, unit mismatch, and ambiguous matches disabled", () => {
  const decisions = mapCaixinSeries([
    { id: "M01", name: "GDP总量", frequency: "季度", unit: "亿元" },
    { id: "M02", name: "GDP同比增速", frequency: "季度", unit: "%" },
  ], [
    { series_id: "1", name: "GDP总量", frequency: "Q", unit: "元", has_data: true },
    { series_id: "2", name: "GDP同比增速", frequency: "Q", unit: "%", has_data: false },
    { series_id: "3", name: "GDP同比增速", frequency: "Q", unit: "%", has_data: true },
    { series_id: "4", name: "GDP同比增速", frequency: "Q", unit: "%", has_data: true },
  ]);
  assert.equal(decisions.every((item) => item.enabled === false), true);
  assert.match(decisions[0].blockers.join("/"), /单位不一致/);
  assert.match(decisions[1].blockers.join("/"), /人工确认/);
});
