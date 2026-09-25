import assert from "node:assert/strict";
import test from "node:test";
import { WindMcpError, callWindIndexPrice } from "../lib/wind-mcp.ts";

test("calls initialize then index price tool without exposing key", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response("data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"text\":\"{\\\"rows\\\":[] }\"}]}}\n\n", { headers: { "content-type": "text/event-stream" } });
  };
  await callWindIndexPrice({ apiKey: "test-only-secret", fetchImpl }, { windcode: "000300.SH" });
  assert.equal(calls[0].method, "initialize");
  assert.equal(calls[1].params.name, "get_index_price_indicators");
  assert.deepEqual(calls[1].params.arguments, { windcode: "000300.SH" });
});

test("does not call upstream when Worker Secret is absent", async () => {
  await assert.rejects(() => callWindIndexPrice({ apiKey: "" }, { windcode: "000300.SH" }), (error) => error instanceof WindMcpError && error.code === "not_configured");
});
