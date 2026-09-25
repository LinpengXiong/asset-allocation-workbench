export type MappingTarget = {
  id: string;
  name: string;
  frequency?: string;
  expectedSource?: string;
  unit?: string;
  target?: string;
};

export type MappingSeries = {
  series_id: string;
  name: string;
  frequency?: string;
  unit?: string;
  source?: string;
  has_data?: boolean;
  [key: string]: unknown;
};

export type MappingDecision = {
  seriesId: string;
  targetId: string;
  targetName: string;
  enabled: boolean;
  confidence: number;
  reasons: string[];
  blockers: string[];
};

const FREQUENCY_ALIASES: Record<string, string> = {
  日: "D", 日度: "D", daily: "D", d: "D",
  周: "W", 周度: "W", weekly: "W", w: "W",
  月: "M", 月度: "M", monthly: "M", m: "M",
  季: "Q", 季度: "Q", quarterly: "Q", q: "Q",
  年: "A", 年度: "A", annual: "A", yearly: "A", a: "A",
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[（）()【】\[\]、，,：:；;“”"'·/\\_-]/g, " ")
    .replace(/同比|环比|当期|累计|全国|中国/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

function frequencyCode(value: unknown) {
  const normalized = normalizeText(value);
  return FREQUENCY_ALIASES[normalized] ?? normalized.toUpperCase();
}

function tokenOverlap(left: string, right: string) {
  const tokens = left.match(/[\u4e00-\u9fff]{2,}|[a-z]{2,}|\d+(?:\.\d+)?/g) ?? [];
  return tokens.filter((token) => right.includes(token)).length;
}

function sourceMatch(expected: string | undefined, actual: string | undefined) {
  if (!expected || !actual) return false;
  const expectedTokens = normalizeText(expected).split(/[/；;,，\s]+/).filter(Boolean);
  const actualText = normalizeText(actual);
  return expectedTokens.some((token) => token.length >= 2 && actualText.includes(token));
}

export function mapCaixinSeries(targets: MappingTarget[], series: MappingSeries[]): MappingDecision[] {
  return targets.flatMap((target) => {
    const candidates = series.map((item) => {
      const targetText = normalizeText(target.name);
      const seriesText = normalizeText(item.name);
      const overlap = tokenOverlap(targetText, seriesText);
      const exactName = targetText.length >= 3 && (seriesText.includes(targetText) || targetText.includes(seriesText));
      const sameFrequency = frequencyCode(target.frequency) === frequencyCode(item.frequency);
      const sameUnit = !target.unit || !item.unit || normalizeText(target.unit) === normalizeText(item.unit);
      const sameSource = sourceMatch(target.expectedSource, item.source);
      const reasons = [];
      const blockers = [];
      let confidence = Math.min(0.5, overlap * 0.12) + (exactName ? 0.65 : 0) + (sameFrequency ? 0.1 : 0) + (sameUnit ? 0.05 : 0) + (sameSource ? 0.05 : 0);
      if (exactName) reasons.push("名称高度重合");
      if (sameFrequency) reasons.push("频率一致"); else blockers.push("频率不一致或缺失");
      if (sameUnit) reasons.push("单位一致或目标未指定单位"); else blockers.push("单位不一致");
      if (sameSource) reasons.push("来源一致");
      if (item.has_data !== true) blockers.push("has_data 不是 true");
      if (!item.series_id) blockers.push("缺少 series_id");
      if (!exactName && overlap < 2) blockers.push("名称匹配不足");
      const enabled = confidence >= 0.82 && blockers.length === 0;
      if (!enabled) confidence = Math.min(confidence, 0.81);
      return { item, confidence, reasons, blockers };
    }).sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];
    const ambiguous = candidates[1] && best && best.confidence - candidates[1].confidence < 0.12;
    if (!best) return [];
    if (ambiguous) best.blockers.push("存在相近候选，需人工确认");
    return [{
      seriesId: best.item.series_id,
      targetId: target.id,
      targetName: target.name,
      enabled: !ambiguous && best.confidence >= 0.82 && best.blockers.length === 0,
      confidence: Number(best.confidence.toFixed(2)),
      reasons: best.reasons,
      blockers: best.blockers,
    }];
  });
}
