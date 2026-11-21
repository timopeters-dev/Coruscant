import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildInvestmentContext } from "@/domain/recommendation/investment-context";
import { InvestmentCoachDrawer } from "@/frontend/planung/investment-coach-drawer";

const ctx = buildInvestmentContext({
  asOfDate: "2026-11-19",
  snapshotFetchedAt: "2026-11-18T10:00:00.000Z",
  isDummyHousehold: false,
  positions: [
    {
      id: "pos-1",
      accountId: "acc-1",
      name: "Muster ETF",
      isin: "IE00B4L5Y983",
      assetClass: "etf",
      marketValueCents: 1_000_000,
    },
  ],
  accounts: [
    { id: "acc-1", name: "Depot", type: "brokerage", balanceCents: 0 },
  ],
  pots: [],
  contracts: [],
  monthlyLivingCostsCents: 200_000,
  monthlySurplusCents: 50_000,
  monthlySavingsRateCents: 50_000,
});

describe("InvestmentCoachDrawer showDebug", () => {
  it("hides debug context in production (showDebug=false)", () => {
    const html = renderToStaticMarkup(
      <InvestmentCoachDrawer
        open={true}
        onOpenChange={() => {}}
        context={ctx}
        refLabels={{}}
        showDebug={false}
      />,
    );
    expect(html).not.toContain("Was die KI sieht");
    expect(html).not.toContain("schemaVersion");
    expect(html).toContain("Die KI erhält nur anonymisierte Werte");
  });

  it("renders Was die KI sieht when showDebug=true", () => {
    const html = renderToStaticMarkup(
      <InvestmentCoachDrawer
        open={true}
        onOpenChange={() => {}}
        context={ctx}
        refLabels={{}}
        showDebug={true}
      />,
    );
    expect(html).toContain("Was die KI sieht");
    expect(html).toContain("schemaVersion");
  });
});
