import {
  ASSET_NAMES,
  type AssetAllocation,
  type AssetName,
  type MarketInputPayload,
  type ModelSnapshot,
  type StressScenario,
  type SubAllocation,
} from "./types";

const ASSET_PARAMS: Record<
  AssetName,
  { strategic: number; min: number; max: number; sensitivity: number; threshold: number }
> = {
  股票: { strategic: 0.6, min: 0.4, max: 0.8, sensitivity: 0.025, threshold: 0.02 },
  债券: { strategic: 0.15, min: 0.1, max: 0.2, sensitivity: 0.05, threshold: 0.01 },
  商品: { strategic: 0.15, min: 0.1, max: 0.2, sensitivity: 0.05, threshold: 0.01 },
  另类: { strategic: 0.1, min: 0, max: 0.2, sensitivity: 0.1, threshold: 0.01 },
};

const INDEX_ANCHORS = [
  { point: 3000, position: 0.8 },
  { point: 3500, position: 0.7 },
  { point: 3800, position: 0.65 },
  { point: 4200, position: 0.6 },
  { point: 4700, position: 0.5 },
  { point: 5200, position: 0.4 },
] as const;

const SUB_ASSETS = [
  { parent: "股票", name: "红利/价值", base: 0.3846153846, current: 0.25, watch: "股息债券替代、盈利稳定性、价值成长估值差" },
  { parent: "股票", name: "GARP", base: 0.3076923077, current: 0.2, watch: "盈利扩散、估值与增速匹配、机构资金" },
  { parent: "股票", name: "成长", base: 0.3076923077, current: 0.2, watch: "长端利率、科技政策、风险偏好" },
  { parent: "债券", name: "利率债", base: 0.4, current: 0.04, watch: "10Y国债、期限利差、货币政策" },
  { parent: "债券", name: "高等级信用", base: 0.25, current: 0.025, watch: "信用利差、流动性、违约风险" },
  { parent: "债券", name: "可转债", base: 0.1, current: 0.01, watch: "转股溢价、纯债溢价、权益趋势" },
  { parent: "债券", name: "REITs", base: 0.15, current: 0.015, watch: "分派率、利率、底层现金流" },
  { parent: "债券", name: "境外债", base: 0.1, current: 0.01, watch: "美债利率、汇率、对冲成本" },
  { parent: "商品", name: "量化CTA", base: 0.5, current: 0.1, watch: "跨品种趋势、波动率、模型回撤" },
  { parent: "商品", name: "黄金", base: 0.5, current: 0.1, watch: "实际利率、美元、央行购金、ETF" },
  { parent: "另类", name: "宏观对冲", base: 0.4, current: 0.02, watch: "尾部风险、期权成本、相关性" },
  { parent: "另类", name: "宏观及期货", base: 0.3, current: 0.015, watch: "趋势、基差、保证金与容量" },
  { parent: "另类", name: "市场中性", base: 0.3, current: 0.015, watch: "Alpha离散度、对冲成本、风格暴露" },
] as const satisfies ReadonlyArray<{
  parent: AssetName;
  name: string;
  base: number;
  current: number;
  watch: string;
}>;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round = (value: number, digits = 10) => {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};

export function interpolateStockPosition(indexPoint: number): number {
  if (indexPoint <= INDEX_ANCHORS[0].point) return INDEX_ANCHORS[0].position;
  const last = INDEX_ANCHORS[INDEX_ANCHORS.length - 1];
  if (indexPoint >= last.point) return last.position;

  for (let index = 0; index < INDEX_ANCHORS.length - 1; index += 1) {
    const left = INDEX_ANCHORS[index];
    const right = INDEX_ANCHORS[index + 1];
    if (indexPoint >= left.point && indexPoint <= right.point) {
      const progress = (indexPoint - left.point) / (right.point - left.point);
      return left.position + progress * (right.position - left.position);
    }
  }
  return last.position;
}

function classify(signal: number) {
  if (signal <= -1.5) return "低配";
  if (signal <= -0.5) return "适度低配";
  if (signal < 0.5) return "标配";
  if (signal < 1.5) return "适度高配";
  return "高配";
}

function actionFor(difference: number, threshold: number): "增配" | "减配" | "观察" {
  if (Math.abs(difference) < threshold) return "观察";
  return difference > 0 ? "增配" : "减配";
}

function calculateSignals(input: MarketInputPayload): Record<AssetName, number> {
  return Object.fromEntries(
    ASSET_NAMES.map((asset) => [
      asset,
      round(
        input.factors
          .filter((factor) => factor.asset === asset)
          .reduce((sum, factor) => sum + factor.weight * factor.score, 0),
      ),
    ]),
  ) as Record<AssetName, number>;
}

function constrainedTargets(indexPoint: number, signals: Record<AssetName, number>) {
  const stockParam = ASSET_PARAMS.股票;
  const stockBase = interpolateStockPosition(indexPoint);
  const stock = clamp(
    stockBase + stockParam.sensitivity * signals.股票,
    stockParam.min,
    stockParam.max,
  );
  const nonStockAssets: AssetName[] = ["债券", "商品", "另类"];
  const raw = Object.fromEntries(
    nonStockAssets.map((asset) => [
      asset,
      Math.max(0.001, ASSET_PARAMS[asset].strategic + ASSET_PARAMS[asset].sensitivity * signals[asset]),
    ]),
  ) as Record<Exclude<AssetName, "股票">, number>;
  const budget = 1 - stock;
  const rawTotal = Object.values(raw).reduce((sum, value) => sum + value, 0);
  const limited = Object.fromEntries(
    nonStockAssets.map((asset) => {
      const firstPass = (raw[asset] / rawTotal) * budget;
      const param = ASSET_PARAMS[asset];
      return [asset, clamp(firstPass, param.min, param.max)];
    }),
  ) as Record<Exclude<AssetName, "股票">, number>;

  const residual = budget - Object.values(limited).reduce((sum, value) => sum + value, 0);
  if (Math.abs(residual) > 1e-10) {
    const capacities = Object.fromEntries(
      nonStockAssets.map((asset) => [
        asset,
        residual > 0
          ? ASSET_PARAMS[asset].max - limited[asset]
          : limited[asset] - ASSET_PARAMS[asset].min,
      ]),
    ) as Record<Exclude<AssetName, "股票">, number>;
    const capacityTotal = Object.values(capacities).reduce((sum, value) => sum + value, 0);
    if (capacityTotal > 0) {
      for (const asset of nonStockAssets) {
        limited[asset] += residual * (capacities[asset] / capacityTotal);
      }
    }
  }

  return {
    股票: round(stock),
    债券: round(limited.债券),
    商品: round(limited.商品),
    另类: round(limited.另类),
  } satisfies Record<AssetName, number>;
}

function styleScores(input: MarketInputPayload) {
  const result = { "红利/价值": 0, GARP: 0, 成长: 0 };
  for (const factor of input.styleFactors) {
    result["红利/价值"] += factor.score * factor.weight * factor.exposure.dividend;
    result.GARP += factor.score * factor.weight * factor.exposure.garp;
    result.成长 += factor.score * factor.weight * factor.exposure.growth;
  }
  return {
    "红利/价值": round(result["红利/价值"]),
    GARP: round(result.GARP),
    成长: round(result.成长),
  };
}

function buildSubAllocations(
  input: MarketInputPayload,
  targets: Record<AssetName, number>,
  styles: ReturnType<typeof styleScores>,
): SubAllocation[] {
  const scoreByName: Record<string, number> = { ...input.subTilts, ...styles };
  return SUB_ASSETS.flatMap((entry) => {
    const siblings = SUB_ASSETS.filter((candidate) => candidate.parent === entry.parent);
    const adjusted = siblings.map((candidate) => {
      const score = scoreByName[candidate.name] ?? 0;
      return Math.max(0.01, candidate.base * (1 + 0.15 * score));
    });
    const adjustedTotal = adjusted.reduce((sum, value) => sum + value, 0);
    const ownIndex = siblings.findIndex((candidate) => candidate.name === entry.name);
    const withinParent = adjusted[ownIndex] / adjustedTotal;
    const portfolioTarget = withinParent * targets[entry.parent];
    const difference = portfolioTarget - entry.current;
    const score = scoreByName[entry.name] ?? 0;
    return [{
      parent: entry.parent,
      name: entry.name,
      baseWithinParent: entry.base,
      score: round(score),
      targetWithinParent: round(withinParent),
      parentTarget: targets[entry.parent],
      portfolioTarget: round(portfolioTarget),
      currentPortfolio: entry.current,
      difference: round(difference),
      view: classify(score),
      action: actionFor(difference, 0.005),
      watch: entry.watch,
    }];
  });
}

function buildStressScenarios(signals: Record<AssetName, number>): StressScenario[] {
  return INDEX_ANCHORS.map(({ point }) => {
    const targets = constrainedTargets(point, { ...signals, 股票: 0 });
    return {
      indexPoint: point,
      stock: targets.股票,
      bond: targets.债券,
      commodity: targets.商品,
      alternative: targets.另类,
    };
  });
}

export function calculateModel(input: MarketInputPayload): ModelSnapshot {
  const signals = calculateSignals(input);
  const targets = constrainedTargets(input.index.value, signals);
  const allocations: AssetAllocation[] = ASSET_NAMES.map((asset) => {
    const param = ASSET_PARAMS[asset];
    const difference = targets[asset] - input.currentHoldings[asset];
    const action = actionFor(difference, param.threshold);
    return {
      asset,
      strategic: param.strategic,
      min: param.min,
      max: param.max,
      current: input.currentHoldings[asset],
      signal: signals[asset],
      target: targets[asset],
      difference: round(difference),
      threshold: param.threshold,
      view: classify(signals[asset]),
      action,
      trigger: action === "观察" ? "阈值内" : action === "增配" ? "需增配" : "需减配",
      rationale:
        asset === "股票"
          ? `点位锚=${input.index.value.toFixed(2)}；信号=${signals[asset].toFixed(2)}`
          : `信号=${signals[asset].toFixed(2)}；剩余预算内约束分配`,
    };
  });
  const styles = styleScores(input);
  const subAllocations = buildSubAllocations(input, targets, styles);
  const currentTotal = ASSET_NAMES.reduce((sum, asset) => sum + input.currentHoldings[asset], 0);
  const targetTotal = ASSET_NAMES.reduce((sum, asset) => sum + targets[asset], 0);
  const subTargetTotal = subAllocations.reduce((sum, item) => sum + item.portfolioTarget, 0);
  const boundsOk = allocations.every(
    (item) => item.target >= item.min - 1e-8 && item.target <= item.max + 1e-8,
  );
  const factorWeightsOk = ASSET_NAMES.every((asset) => {
    const total = input.factors
      .filter((factor) => factor.asset === asset)
      .reduce((sum, factor) => sum + factor.weight, 0);
    return Math.abs(total - 1) < 1e-6;
  });
  const modelOk =
    Math.abs(currentTotal - 1) < 1e-6 &&
    Math.abs(targetTotal - 1) < 1e-6 &&
    Math.abs(subTargetTotal - 1) < 1e-6 &&
    boundsOk &&
    factorWeightsOk;

  return {
    input,
    allocations,
    subAllocations,
    styleScores: styles,
    stressScenarios: buildStressScenarios(signals),
    checks: {
      currentTotal: round(currentTotal),
      targetTotal: round(targetTotal),
      subTargetTotal: round(subTargetTotal),
      boundsOk,
      factorWeightsOk,
      status: modelOk ? "模型通过" : "检查约束",
    },
  };
}

export const modelParameters = {
  assets: ASSET_PARAMS,
  indexAnchors: INDEX_ANCHORS,
};
