import { readFile, writeFile } from "node:fs/promises";
import { mapCaixinSeries } from "../lib/caixin-mapping.ts";

const [, , inputPath, outputPath = "output/caixin-mapping-report.json"] = process.argv;
if (!inputPath) throw new Error("Usage: node --experimental-strip-types scripts/caixin-map.mjs <metadata.json> [report.json]");
const input = JSON.parse(await readFile(inputPath, "utf8"));
const targets = input.targets ?? input.macroIndicators ?? [];
const series = input.series ?? input.data ?? [];
const decisions = mapCaixinSeries(targets, series);
const report = {
  generatedAt: new Date().toISOString(),
  source: input.source ?? "local metadata export",
  policy: "仅 confidence >= 0.82 且无阻塞项的序列启用；不改写现有 payload/D1",
  summary: {
    targets: targets.length,
    candidates: series.length,
    enabled: decisions.filter((item) => item.enabled).length,
    disabled: decisions.filter((item) => !item.enabled).length,
  },
  decisions,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
