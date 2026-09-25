import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { buildWindAuditRecord, parseWindEnvelope } from "../lib/wind.ts";

const [, , question, outputPath = "output/wind-audit.json"] = process.argv;
if (!question) throw new Error("Usage: node --experimental-strip-types scripts/wind-sync.mjs '<economic indicator question>' [audit-output.json]");

const cliPath = process.env.WIND_CLI_PATH || resolve(process.env.WIND_SKILL_DIR || `${process.env.HOME}/.agents/skills/wind-mcp-skill`, "scripts/cli.mjs");
const nodePath = process.env.WIND_NODE_PATH || process.execPath;
const args = [cliPath, "call", "economic_data", "search_economic_indicator", JSON.stringify({ question })];

const raw = await new Promise((resolvePromise, reject) => {
  const child = spawn(nodePath, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolvePromise(stdout) : reject(new Error(`Wind CLI failed (${code}): ${stderr.slice(0, 500)}`)));
});

const parsed = parseWindEnvelope(raw);
const audit = { ...buildWindAuditRecord(question, parsed.metrics), cliMeta: parsed.cliMeta };
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({ provider: "wind", metrics: audit.metrics.length, output: outputPath }));
