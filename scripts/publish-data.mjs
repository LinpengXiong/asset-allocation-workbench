import fs from "node:fs/promises";

async function loadEnv(path) {
  const values = {};
  const text = await fs.readFile(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

const payloadPath = process.argv[2];
const envPath = process.argv[3] ?? ".collector.env";
if (!payloadPath) throw new Error("Usage: node scripts/publish-data.mjs <payload.json> [env-file]");
const local = await loadEnv(envPath);
const siteUrl = process.env.SITE_URL ?? local.SITE_URL;
const updateToken = process.env.UPDATE_TOKEN ?? local.UPDATE_TOKEN;
if (!siteUrl || !updateToken) throw new Error("SITE_URL and UPDATE_TOKEN are required");
const payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/update`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${updateToken}` },
  body: JSON.stringify(payload),
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`Publish failed (${response.status}): ${result.error ?? "unknown error"}`);
console.log(`Published dataset ${payload.asOf}${result.duplicate ? " (already current)" : ""}.`);
