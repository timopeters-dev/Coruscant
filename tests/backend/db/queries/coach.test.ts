import { describe, expect, it } from "vitest";
import { withTempDatabase } from "@tests/helpers/temp-db";
import { createManualCashflowItem } from "@/backend/db/queries/cashflow-items";
import { insertExternalSnapshot } from "@/backend/db/queries/external-snapshots";
import {
  buildInvestmentContext,
  collectContextRefs,
  isInvestmentContextUsable,
} from "@/domain/recommendation/investment-context";
import { buildRefLabelMap, loadInvestmentContextInput } from "@/backend/db/queries/coach";

withTempDatabase();

describe("loadInvestmentContextInput – Lebenshaltungskosten", () => {
  it("nutzt die konsolidierten Gesamtausgaben (manuelle Abflüsse senken die Abdeckung)", () => {
    const before = loadInvestmentContextInput({ asOfDate: "2026-11-17" });
    expect(before.monthlyLivingCostsCents).not.toBeNull();

    createManualCashflowItem({
      name: "Muster-Versicherung",
      direction: "outflow",
      amountCents: 50_000,
      frequency: "monthly",
      active: true,
    });
    const after = loadInvestmentContextInput({ asOfDate: "2026-11-17" });
    expect(after.monthlyLivingCostsCents).toBe(before.monthlyLivingCostsCents! + 50_000);

    const liquid = [
      { id: "a", name: "x", type: "checking" as const, balanceCents: 900_000 },
    ];
    const coverage = (input: typeof before) =>
      buildInvestmentContext({ ...input, accounts: liquid }).liquidity.coverageMonthsTenths!;
    expect(coverage(after)).toBeLessThan(coverage(before));
  });
});

describe("buildRefLabelMap", () => {
  it("deckt exakt die Refs des Kontexts ab (kein Auseinanderlaufen)", () => {
    const input = loadInvestmentContextInput({ asOfDate: "2026-11-17" });
    input.positions = [
      { id: "b", accountId: "a", name: "Muster ETF B", isin: null, assetClass: "etf", marketValueCents: 100 },
      { id: "a", accountId: "a", name: "Muster ETF A", isin: null, assetClass: "etf", marketValueCents: 100 },
      { id: "c", accountId: "a", name: "Muster Aktie", isin: null, assetClass: "stock", marketValueCents: 500 },
    ];
    input.pots = [
      { id: "p2", name: "Ziel B", priority: 2, purpose: "goal", currentCents: 0, targetCents: null, linkedContractId: null, linkedPropertyId: null },
      { id: "p1", name: "Ziel A", priority: 1, purpose: null, currentCents: 0, targetCents: null, linkedContractId: null, linkedPropertyId: null },
      { id: "p0", name: "Reserve", priority: 0, purpose: "emergency_fund", currentCents: 0, targetCents: null, linkedContractId: null, linkedPropertyId: null },
    ];
    const ctx = buildInvestmentContext(input);
    const labels = buildRefLabelMap(input);
    for (const ref of collectContextRefs(ctx)) {
      expect(labels[ref], ref).toBeDefined();
    }
    expect(labels["ETF-1"]).toBe("Muster ETF A");
    expect(labels["AKTIE-1"]).toBe("Muster Aktie");
    expect(labels["ZIEL-1"]).toBe("Ziel A");
    expect(labels["ZIEL-2"]).toBe("Ziel B");
  });
});

describe("loadInvestmentContextInput – nur Haushalt", () => {
  const account = (id: string, scope: "household" | "personal", type: "checking" | "brokerage", balanceCents: number) => ({
    id,
    name: `Musterbank ${id}`,
    type,
    scope,
    balanceCents,
    holdingsValueCents: 0,
  });
  const position = (id: string, accountId: string, name: string, marketValueCents: number) => ({
    id,
    accountId,
    symbol: "MSTR",
    isin: null,
    name,
    assetClass: "etf" as const,
    marketValueCents,
    costBasisCents: null,
    lastPriceAt: null,
  });
  const snapshot = (accounts: ReturnType<typeof account>[], positions: ReturnType<typeof position>[]) =>
    insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 0,
      etfStocksCents: 0,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 0,
      fetchedAt: "2026-11-17T08:00:00.000Z",
      accounts,
      positions,
    });

  it("nimmt nur Haushalts-Positionen und -Konten in Portfolio und Liquidität auf", () => {
    snapshot(
      [
        account("acc-hh-1", "household", "checking", 10_000),
        account("acc-hh-2", "household", "brokerage", 0),
        account("acc-pr-1", "personal", "checking", 9_000_000),
        account("acc-pr-2", "personal", "brokerage", 0),
      ],
      [
        position("pos-hh-1", "acc-hh-2", "Haushalts-ETF", 100_000),
        position("pos-pr-1", "acc-pr-2", "Privat-ETF", 700_000),
      ],
    );
    const input = loadInvestmentContextInput({ asOfDate: "2026-11-17" });
    expect(input.positions.map((p) => p.id)).toEqual(["pos-hh-1"]);
    expect(input.accounts.map((a) => a.id)).toEqual(["acc-hh-1", "acc-hh-2"]);

    const ctx = buildInvestmentContext(input);
    expect(ctx.portfolio.totalValueCents).toBe(100_000);
    expect(ctx.liquidity.liquidCents).toBe(10_000);

    const labels = buildRefLabelMap(input);
    expect(Object.values(labels)).toContain("Haushalts-ETF");
    expect(Object.values(labels)).not.toContain("Privat-ETF");
  });

  it("ist bei nur persönlichen Positionen nicht nutzbar (Leerzustand)", () => {
    snapshot(
      [account("acc-pr-1", "personal", "brokerage", 0)],
      [position("pos-pr-1", "acc-pr-1", "Privat-ETF", 700_000)],
    );
    const input = loadInvestmentContextInput({ asOfDate: "2026-11-17" });
    expect(isInvestmentContextUsable(buildInvestmentContext(input))).toBe(false);
  });

  it("ist ohne Snapshot oder bei leerem Snapshot nicht nutzbar und wirft nicht", () => {
    const none = loadInvestmentContextInput({ asOfDate: "2026-11-17" });
    expect(isInvestmentContextUsable(buildInvestmentContext(none))).toBe(false);
    snapshot([], []);
    const empty = loadInvestmentContextInput({ asOfDate: "2026-11-17" });
    expect(isInvestmentContextUsable(buildInvestmentContext(empty))).toBe(false);
  });

  it("nutzt ein künftiges Haushalts-Depot ohne weitere Konfiguration", () => {
    snapshot(
      [account("acc-hh-1", "household", "brokerage", 0)],
      [
        position("pos-hh-1", "acc-hh-1", "Haushalts-ETF A", 300_000),
        position("pos-hh-2", "acc-hh-1", "Haushalts-ETF B", 200_000),
      ],
    );
    const ctx = buildInvestmentContext(loadInvestmentContextInput({ asOfDate: "2026-11-17" }));
    expect(isInvestmentContextUsable(ctx)).toBe(true);
    expect(ctx.portfolio.totalValueCents).toBe(500_000);
  });
});
