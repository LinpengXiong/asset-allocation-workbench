/** Presentation only: aggregate the existing rule weights without changing scores. */
export function summarizePillarWeights(framework, pillar) {
  const rows = framework.indicators.filter((item) => item.pillar === pillar);
  const names = pillar === "宏观调控"
    ? ["货币政策", "财政政策", "产业政策", "制度建设"]
    : [...new Set(rows.map((item) => item.group))];
  return {
    pillar,
    count: rows.length,
    weight: framework.pillars[pillar],
    groups: names.map((name) => {
      const items = rows.filter((item) => item.group === name);
      return { name, count: items.length, weight: items.reduce((sum, item) => sum + item.weight, 0) };
    }).filter((group) => group.count > 0),
  };
}

export const formatTotalWeight = (weight) => `${Number((weight * 100).toFixed(2))}%`;

/** Labels describe the role of each pillar; they do not map scores to asset positions. */
export function describePillarRole(pillar) {
  const roles = {
    经济运行: { kind: "基本面与信用", description: "观察已实现增长、价格、就业和当期景气。" },
    增长动力: { kind: "基本面与信用", description: "观察需求、盈利、投资与产能的变化。" },
    金融信贷: { kind: "基本面与信用", description: "观察融资传导、信用趋势与部门偿付约束。" },
    宏观调控: { kind: "政策响应与制度", description: "观察政策支持、实际执行及制度条件，不自动判定经济复苏。" },
  };
  return roles[pillar] ?? { kind: "宏观条件", description: "按当前规则核对指标、口径与证据。" };
}

export const macroRatingScopeNote = "宏观评级提供研究背景；股票、债券、商品须分别分析估值、现金流、风险与投资逻辑，不由宏观总分直接生成买卖或仓位。";
export const macroRatingTimelinessNote = "空值不补分；统计频率、指标序列、单位和口径须匹配。月度3个月、季度6个月是拒绝明显过旧数据的上限，并非承诺已取到最新发布；仍须按信息截止日核对最新可得观测和修订版本。";
