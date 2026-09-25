import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DOMESTIC_SITE_URL = "https://asset-allocation-cn-d7bm4ee66816-1460131405.ap-shanghai.app.tcloudbase.com";
const FUNCTION_NAME = "asset-allocation-cn";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proxyRoot = path.join(projectRoot, "cloudbase-proxy");
const validator = path.join(projectRoot, "scripts", "validate-payload.mjs");
const sourceArg = process.argv[2];

if (!sourceArg) {
  throw new Error("Usage: node scripts/publish-data-cloudbase.mjs <payload.json>");
}

const sourcePath = path.resolve(process.cwd(), sourceArg);
const targetPath = path.join(proxyRoot, "latest-payload.json");
const advisorySourcePath = path.join(projectRoot, "app", "data", "advisory.json");
const advisoryTargetPath = path.join(proxyRoot, "advisory.json");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || `exit ${code}`})`));
    });
  });
}

async function verifyDeployment(expectedRevision, expectedAdvisoryRevision) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(`${DOMESTIC_SITE_URL}/api/health?ts=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json();
      if (response.ok && result.ok && result.dataRevision === expectedRevision && result.advisoryRevision === expectedAdvisoryRevision) {
        return result;
      }
      lastError = new Error(`health check returned ${response.status}, data ${result.dataRevision || "missing"}, advisory ${result.advisoryRevision || "missing"}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Domestic deployment could not be verified: ${lastError?.message || "unknown error"}`);
}

await run(process.execPath, [validator, sourcePath], { cwd: projectRoot });

const payloadBytes = await fs.readFile(sourcePath);
const advisoryBytes = await fs.readFile(advisorySourcePath);
const revision = crypto.createHash("sha256").update(payloadBytes).digest("hex");
const advisoryRevision = crypto.createHash("sha256").update(advisoryBytes).digest("hex");
const temporaryPath = `${targetPath}.tmp-${process.pid}`;
const temporaryAdvisoryPath = `${advisoryTargetPath}.tmp-${process.pid}`;
await fs.writeFile(temporaryPath, payloadBytes);
await fs.writeFile(temporaryAdvisoryPath, advisoryBytes);
await fs.rename(temporaryPath, targetPath);
await fs.rename(temporaryAdvisoryPath, advisoryTargetPath);

await run(
  "npx",
  ["-y", "-p", "@cloudbase/cli@latest", "tcb", "fn", "deploy", FUNCTION_NAME, "--force"],
  { cwd: proxyRoot },
);

const health = await verifyDeployment(revision, advisoryRevision);
console.log(`Domestic site verified: ${health.asOf}, data ${revision.slice(0, 12)}, advisory ${advisoryRevision.slice(0, 12)}.`);
