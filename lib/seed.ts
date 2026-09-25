import type { FactorInput, MarketInputPayload, StyleFactorInput } from "./types";

const unverified = "工作簿初始评分，待定时任务依据最新证据复核";

const factors: FactorInput[] = [
  { asset: "股票", factor: "盈利趋势", indicator: "全A盈利预测修正、ROE与盈利扩散", weight: 0.25, score: 0, frequency: "月/季", evidence: unverified, sourceIds: [], verified: false },
  { asset: "股票", factor: "政策与流动性", indicator: "社融、M1、货币与资本市场政策", weight: 0.2, score: 0, frequency: "月/事件", evidence: unverified, sourceIds: [], verified: false },
  { asset: "股票", factor: "估值赔率", indicator: "ERP、PE/PB分位与股债性价比", weight: 0.2, score: 0, frequency: "周", evidence: unverified, sourceIds: [], verified: false },
  { asset: "股票", factor: "趋势与资金", indicator: "中期趋势、ETF与两融资金", weight: 0.2, score: 0, frequency: "周", evidence: unverified, sourceIds: [], verified: false },
  { asset: "股票", factor: "情绪与尾部风险", indicator: "拥挤度、波动率、信用与地缘风险", weight: 0.15, score: 0, frequency: "周/事件", evidence: unverified, sourceIds: [], verified: false },
  { asset: "债券", factor: "增长环境", indicator: "PMI、信贷脉冲、地产与财政落地", weight: 0.25, score: -1, frequency: "月", evidence: unverified, sourceIds: [], verified: false },
  { asset: "债券", factor: "通胀环境", indicator: "CPI/PPI、商品价格与通胀预期", weight: 0.2, score: -1, frequency: "月", evidence: unverified, sourceIds: [], verified: false },
  { asset: "债券", factor: "货币政策", indicator: "OMO/MLF/LPR、资金利率", weight: 0.2, score: -1, frequency: "周/事件", evidence: unverified, sourceIds: [], verified: false },
  { asset: "债券", factor: "估值与期限利差", indicator: "10Y收益率分位、期限利差", weight: 0.2, score: -1, frequency: "周", evidence: unverified, sourceIds: [], verified: false },
  { asset: "债券", factor: "信用与趋势", indicator: "信用利差、违约风险、价格趋势", weight: 0.15, score: -1, frequency: "周", evidence: unverified, sourceIds: [], verified: false },
  { asset: "商品", factor: "通胀与再通胀", indicator: "通胀预期、PPI与库存周期", weight: 0.2, score: 1, frequency: "月", evidence: unverified, sourceIds: [], verified: false },
  { asset: "商品", factor: "全球需求", indicator: "全球PMI、中国需求与贸易", weight: 0.2, score: 1, frequency: "月", evidence: unverified, sourceIds: [], verified: false },
  { asset: "商品", factor: "美元与实际利率", indicator: "DXY与美国实际利率", weight: 0.2, score: 1, frequency: "周", evidence: unverified, sourceIds: [], verified: false },
  { asset: "商品", factor: "供给与地缘", indicator: "供给约束、库存与地缘事件", weight: 0.25, score: 1, frequency: "周/事件", evidence: unverified, sourceIds: [], verified: false },
  { asset: "商品", factor: "价格趋势", indicator: "商品指数与趋势强度", weight: 0.15, score: 1, frequency: "周", evidence: unverified, sourceIds: [], verified: false },
  { asset: "另类", factor: "分散化需求", indicator: "股债相关性与组合尾部风险", weight: 0.25, score: 0, frequency: "月", evidence: unverified, sourceIds: [], verified: false },
  { asset: "另类", factor: "波动与趋势机会", indicator: "跨资产波动、趋势持续性", weight: 0.25, score: 0, frequency: "周", evidence: unverified, sourceIds: [], verified: false },
  { asset: "另类", factor: "Alpha与价差机会", indicator: "截面离散度、基差、相对价值", weight: 0.25, score: 0, frequency: "周", evidence: unverified, sourceIds: [], verified: false },
  { asset: "另类", factor: "成本与流动性", indicator: "策略容量、费用、保证金与赎回约束", weight: 0.25, score: -2, frequency: "月", evidence: unverified, sourceIds: [], verified: false },
];

const styleFactors: StyleFactorInput[] = [
  { factor: "长端利率下行", score: 0, weight: 0.15, exposure: { dividend: 0.4, garp: 0.3, growth: 1 }, methodology: "10Y国债收益率趋势下行记正分", evidence: unverified, sourceIds: [], verified: false },
  { factor: "盈利扩散改善", score: 0, weight: 0.2, exposure: { dividend: 0.3, garp: 1, growth: 0.6 }, methodology: "盈利上修由少数行业向全市场扩散", evidence: unverified, sourceIds: [], verified: false },
  { factor: "风险偏好上升", score: 0, weight: 0.15, exposure: { dividend: -0.3, garp: 0.5, growth: 1 }, methodology: "成交、融资、波动率和小盘相对强弱综合", evidence: unverified, sourceIds: [], verified: false },
  { factor: "科技产业政策增强", score: 0, weight: 0.15, exposure: { dividend: -0.3, garp: 0.4, growth: 1 }, methodology: "政策强度与订单或资本开支相互验证", evidence: unverified, sourceIds: [], verified: false },
  { factor: "成长相对赔率改善", score: 0, weight: 0.2, exposure: { dividend: -1, garp: 0.4, growth: 1 }, methodology: "成长相对价值估值差回到有利区间", evidence: unverified, sourceIds: [], verified: false },
  { factor: "股息替代吸引力上升", score: 0, weight: 0.15, exposure: { dividend: 1, garp: 0, growth: -0.3 }, methodology: "股息率与债券收益率之差走阔", evidence: unverified, sourceIds: [], verified: false },
];

export const seedPayload: MarketInputPayload = {
  schemaVersion: 1,
  asOf: "2026-07-28",
  collectedAt: "2026-07-28T15:41:20+08:00",
  status: "seed",
  index: {
    name: "上证指数",
    code: "000001.SH",
    value: 3813.31,
    changePct: -1.16,
    observedAt: "2026-07-28T15:41:20+08:00",
    sourceId: "tencent-sh000001-20260728",
  },
  currentHoldings: { 股票: 0.65, 债券: 0.1, 商品: 0.2, 另类: 0.05 },
  factors,
  styleFactors,
  subTilts: {
    利率债: 0,
    高等级信用: 0,
    可转债: 0,
    REITs: 0,
    境外债: 0,
    量化CTA: 0,
    黄金: 0,
    宏观对冲: 0,
    宏观及期货: 0,
    市场中性: 0,
  },
  sources: [
    {
      id: "tencent-sh000001-20260728",
      title: "上证指数实时行情",
      publisher: "腾讯财经",
      url: "https://qt.gtimg.cn/q=sh000001",
      observedAt: "2026-07-28T15:41:20+08:00",
      note: "收盘后行情快照；点位与涨跌幅直接取自接口。",
    },
  ],
  notes: [
    "点位已更新为当前行情；因子评分仍保留原工作簿初始值，首次定时采集完成后将逐项替换为带来源的评分。",
    "本系统用于纪律化资产配置讨论，不构成投资建议或收益承诺。",
  ],
};
