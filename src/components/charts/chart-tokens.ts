export const CHART_ROLE_COLOR = {
  inflow: "var(--emerald)",
  outflow: "var(--rose)",
  surplus: "var(--emerald)",
  deficit: "var(--rose)",
  pot: "var(--accent)",
  unallocated: "var(--border-sub)",
  bound: "var(--sky)",
  netWorth: "var(--accent)",
  free: "var(--emerald)",
  liabilities: "var(--rose)",
  optionA: "var(--sky)",
  optionB: "var(--accent)",
  baseline: "var(--text-secondary)",
  scenario: "var(--accent)",
  grid: "var(--border)",
  axisText: "var(--text-secondary)",
} as const;

export const CHART_DASH_ARRAY = "6 4";

export type ChartRole = keyof typeof CHART_ROLE_COLOR;
