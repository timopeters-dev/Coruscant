import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/db";
import { createManualCashflowItem } from "@/db/queries/allocation";
import { buildInvestmentContext, collectContextRefs } from "@/lib/domain/investment-context";
import { buildRefLabelMap, loadInvestmentContextInput } from "./coach";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-coachq-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
});

afterEach(() => {
  dbModule.closeDb();
  if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDbUrl;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
      { id: "a", name: "x", type: "checking" as const, scope: "household", balanceCents: 900_000 },
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
