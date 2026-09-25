export const ASSET_NAMES = ["股票", "债券", "商品", "另类"] as const;

export type AssetName = (typeof ASSET_NAMES)[number];

export type SourceEvidence = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  observedAt: string;
  note?: string;
};

export type FactorInput = {
  asset: AssetName;
  factor: string;
  indicator: string;
  weight: number;
  score: number;
  frequency: string;
  evidence: string;
  sourceIds: string[];
  verified: boolean;
};

export type StyleExposure = {
  dividend: number;
  garp: number;
  growth: number;
};

export type StyleFactorInput = {
  factor: string;
  weight: number;
  score: number;
  exposure: StyleExposure;
  methodology: string;
  evidence: string;
  sourceIds: string[];
  verified: boolean;
};

export type MarketInputPayload = {
  schemaVersion: 1;
  asOf: string;
  collectedAt: string;
  status: "seed" | "verified" | "partial";
  index: {
    name: "上证指数";
    code: "000001.SH";
    value: number;
    changePct?: number;
    observedAt: string;
    sourceId: string;
  };
  currentHoldings: Record<AssetName, number>;
  factors: FactorInput[];
  styleFactors: StyleFactorInput[];
  subTilts: Record<string, number>;
  sources: SourceEvidence[];
  notes: string[];
};

export type AssetAllocation = {
  asset: AssetName;
  strategic: number;
  min: number;
  max: number;
  current: number;
  signal: number;
  target: number;
  difference: number;
  threshold: number;
  view: string;
  action: "增配" | "减配" | "观察";
  trigger: string;
  rationale: string;
};

export type SubAllocation = {
  parent: AssetName;
  name: string;
  baseWithinParent: number;
  score: number;
  targetWithinParent: number;
  parentTarget: number;
  portfolioTarget: number;
  currentPortfolio: number;
  difference: number;
  view: string;
  action: "增配" | "减配" | "观察";
  watch: string;
};

export type StressScenario = {
  indexPoint: number;
  stock: number;
  bond: number;
  commodity: number;
  alternative: number;
};

export type ModelSnapshot = {
  input: MarketInputPayload;
  allocations: AssetAllocation[];
  subAllocations: SubAllocation[];
  styleScores: Record<"红利/价值" | "GARP" | "成长", number>;
  stressScenarios: StressScenario[];
  checks: {
    currentTotal: number;
    targetTotal: number;
    subTargetTotal: number;
    boundsOk: boolean;
    factorWeightsOk: boolean;
    status: "模型通过" | "检查约束";
  };
};
