import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const codes = [
  "U6096599", "M0325601", "M5481116", "M5786898", "S0036034",
  "S2707411", "M0000606", "M0000607", "M0000608", "M0000609",
  "M5405502", "M1006337", "M0041653", "S0059744",
  "S0059749", "S0000066", "S6432680",
];
const cli = process.env.WIND_CLI_PATH || path.join(process.env.HOME, ".agents/skills/wind-mcp-skill/scripts/cli.mjs");
const node = process.env.WIND_NODE_PATH || process.execPath;
const output = process.env.WIND_MACRO_VALUES || path.join(process.cwd(), "output", "wind-macro-values.json");
const metrics = [];

async function query(batch) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [cli, "call", "economic_data", "query_economic_indicator_data",
      JSON.stringify({ question: batch.join(","), observation: "5" })],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.slice(0, 400) || `Wind CLI exit ${code}`));
      try {
        const envelope = JSON.parse(stdout);
        if (envelope.ok === false || envelope.isError) throw new Error(`${envelope.code ?? "backend_error"}: ${envelope.message ?? "Wind 调用失败"}`);
        const body = JSON.parse(envelope.content?.find((item) => item.type === "text")?.text ?? "{}");
        if (!Array.isArray(body.metrics)) throw new Error("Wind 返回内容缺少 metrics");
        resolve(body.metrics);
      } catch (error) { reject(error); }
    });
  });
}

try {
  for (let index = 0; index < codes.length; index += 5) {
    const batch = codes.slice(index, index + 5);
    const rows = await query(batch);
    metrics.push(...rows);
    console.error(`${Math.min(index + 5, codes.length)}/${codes.length} codes, ${rows.length} series`);
  }
} finally {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify({ fetchedAt: new Date().toISOString(), requestedCodes: codes, metrics }, null, 2)}\n`);
  console.log(JSON.stringify({ requested: codes.length, received: metrics.length, output }));
}
