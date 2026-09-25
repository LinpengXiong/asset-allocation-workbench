export type WindMetric = {
  code: string;
  name: string;
  unit?: string;
  source?: string;
  freq?: string;
  updateDate?: string;
  beginDate?: string;
  endDate?: string;
  [key: string]: unknown;
};

export type WindEnvelope = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
  cli_meta?: Record<string, unknown>;
  ok?: boolean;
  code?: string;
  message?: string;
};

export function parseWindEnvelope(raw: string): { metrics: WindMetric[]; cliMeta?: Record<string, unknown> } {
  const envelope = JSON.parse(raw) as WindEnvelope;
  if (envelope.ok === false || envelope.isError) throw new Error(envelope.message || envelope.code || "Wind CLI returned an error");
  const text = envelope.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Wind CLI response has no text payload");
  const data = JSON.parse(text) as { metrics?: WindMetric[] };
  if (!Array.isArray(data.metrics)) throw new Error("Wind response metrics is not an array");
  return { metrics: data.metrics, cliMeta: envelope.cli_meta };
}

export function normalizeWindSourceId(code: string) {
  return `wind-edb-${code}`;
}

export function buildWindAuditRecord(question: string, metrics: WindMetric[], fetchedAt = new Date().toISOString()) {
  return {
    provider: "wind",
    kind: "economic_data",
    question,
    fetchedAt,
    metrics: metrics.map((metric) => ({
      code: metric.code,
      name: metric.name,
      unit: metric.unit,
      source: metric.source,
      frequency: metric.freq,
      updateDate: metric.updateDate,
      beginDate: metric.beginDate,
      endDate: metric.endDate,
      sourceId: normalizeWindSourceId(metric.code),
    })),
  };
}
