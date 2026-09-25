import assert from "node:assert/strict";
import test from "node:test";
import { buildWindAuditRecord, normalizeWindSourceId, parseWindEnvelope } from "../lib/wind.ts";

test("parses Wind CLI envelope without exposing credentials", () => {
  const result = parseWindEnvelope(JSON.stringify({
    content: [{ type: "text", text: JSON.stringify({ metrics: [{ code: "M1", name: "GDP", freq: "季" }] }) }],
    cli_meta: { server_type: "economic_data" },
  }));
  assert.equal(result.metrics[0].code, "M1");
  assert.equal(normalizeWindSourceId("M1"), "wind-edb-M1");
  assert.doesNotMatch(JSON.stringify(buildWindAuditRecord("GDP", result.metrics)), /API_KEY|token|secret/i);
});

test("rejects Wind error envelopes", () => {
  assert.throws(() => parseWindEnvelope(JSON.stringify({ ok: false, code: "AUTH_ERROR", message: "credentials unavailable" })), /credentials unavailable/);
});
