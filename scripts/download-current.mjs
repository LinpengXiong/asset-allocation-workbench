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

const outputPath = process.argv[2] ?? "collector/latest-payload.json";
const envPath = process.argv[3] ?? ".collector.env";
const local = await loadEnv(envPath);
const siteUrl = process.env.SITE_URL ?? local.SITE_URL;
const updateToken = process.env.UPDATE_TOKEN ?? local.UPDATE_TOKEN;
if (!siteUrl || !updateToken) throw new Error("SITE_URL and UPDATE_TOKEN are required");
const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/update`, {
  headers: { authorization: `Bearer ${updateToken}` },
});
const result = await response.json().catch(() => ({}));
if (!response.ok || !result.payload) throw new Error(`Download failed (${response.status}): ${result.error ?? "unknown error"}`);
await fs.writeFile(outputPath, `${JSON.stringify(result.payload, null, 2)}\n`, "utf8");
console.log(`Downloaded current dataset ${result.payload.asOf}.`);
