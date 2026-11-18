export const CHART_ROLE_COLOR = {
  inflow: "var(--emerald)",
  outflow: "var(--rose)",
  surplus: "var(--emerald)",
  deficit: "var(--rose)",
  pot: "var(--accent)",
  unallocated: "var(--border-sub)",
  bound: "var(--sky)",
} as const;

export type ChartRole = keyof typeof CHART_ROLE_COLOR;
