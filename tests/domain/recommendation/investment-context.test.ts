import { describe, expect, it } from "vitest";
import type { DomainContract } from "@/domain/contracts/contract";
import { projectContractBalance } from "@/domain/contracts/contract";
import {
  allocateWeightsBps,
  buildInvestmentContext,
  collectContextRefs,
  isInvestmentContextUsable,
  MAX_CONTEXT_MILESTONES,
  MAX_INSTRUMENT_NAME_LENGTH,
  normalizeIsin,
  sanitizeInstrumentName,
  serializeInvestmentContext,
  withSavingsRate,
  type InvestmentContext,
  type InvestmentContextInput,
} from "@/domain/recommendation/investment-context";

const ETF_ISIN = "IE00B4L5Y983";

function loan(overrides: Partial<DomainContract> = {}): DomainContract {
  return {
    id: "contract-secret-1",
    name: "Darlehen Erika Mustermann",
    category: "loan",
    status: "active",
    currentBalanceCents: 20_000_000,
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 100_000,
    interestRateBps: 350,
    repaymentType: "annuity",
    milestoneDate: "2028-06-30",
    milestoneLabel: "Ablösung Musterstraße 1",
    fixedInterestUntil: "2030-01-01",
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<InvestmentContextInput> = {},
): InvestmentContextInput {
  return {
    asOfDate: "2026-11-17",
    snapshotFetchedAt: "2026-11-15T08:00:00.000Z",
    isDummyHousehold: false,
    positions: [
      {
        id: "pos-id-1",
        accountId: "acc-id-1",
        name: "Muster MSCI World UCITS ETF",
        isin: ETF_ISIN,
        assetClass: "etf",
        marketValueCents: 700_000,
      },
      {
        id: "pos-id-2",
        accountId: "acc-id-1",
        name: "Muster Robotics AG",
        isin: "DE000A0D6554",
        assetClass: "stock",
        marketValueCents: 200_000,
      },
      {
        id: "pos-id-3",
        accountId: "acc-id-1",
        name: "Muster Coin",
        isin: null,
        assetClass: "crypto",
        marketValueCents: 100_000,
      },
    ],
    accounts: [
      {
        id: "acc-id-1",
        name: "Girokonto Max Mustermann",
        type: "checking",
        balanceCents: 300_000,
      },
      {
        id: "acc-id-2",
        name: "Tagesgeld Musterbank AG",
        type: "savings",
        balanceCents: 700_000,
      },
      {
        id: "acc-id-3",
        name: "Depot Musterbank AG",
        type: "brokerage",
        balanceCents: 50_000,
      },
    ],
    pots: [
      {
        id: "pot-id-1",
        name: "Darlehen Erika Mustermann",
        priority: 2,
        purpose: "goal",
        currentCents: 500_000,
        targetCents: 2_000_000,
        linkedContractId: "contract-secret-1",
        linkedPropertyId: null,
      },
      {
        id: "pot-id-2",
        name: "Notgroschen Max",
        priority: 1,
        purpose: "emergency_fund",
        currentCents: 600_000,
        targetCents: 900_000,
        linkedContractId: null,
        linkedPropertyId: null,
      },
    ],
    contracts: [loan()],
    monthlyLivingCostsCents: 200_000,
    monthlySurplusCents: 40_000,
    monthlySavingsRateCents: 40_000,
    ...overrides,
  };
}

describe("allocateWeightsBps", () => {
  it("verteilt Reste deterministisch (kleinerer Index gewinnt)", () => {
    expect(allocateWeightsBps([1, 1, 1])).toEqual([3334, 3333, 3333]);
  });

  it("liefert Nullen bei Gesamtsumme 0 und 10.000 bei einem Wert", () => {
    expect(allocateWeightsBps([0, 0])).toEqual([0, 0]);
    expect(allocateWeightsBps([])).toEqual([]);
    expect(allocateWeightsBps([5])).toEqual([10_000]);
  });

  it("überläuft nicht bei Werten nahe MAX_SAFE_INTEGER", () => {
    const big = Number.MAX_SAFE_INTEGER;
    const result = allocateWeightsBps([big, big, big]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("wirft bei negativen Werten und Floats", () => {
    expect(() => allocateWeightsBps([1, -1])).toThrow(RangeError);
    expect(() => allocateWeightsBps([1.5])).toThrow(RangeError);
  });

  it("summiert bei 50 geseedeten Zufallsarrays immer auf 10.000", () => {
    let seed = 42;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let run = 0; run < 50; run++) {
      const len = (next() % 12) + 1;
      const values = Array.from({ length: len }, () => (next() % 1_000_000) + 1);
      const result = allocateWeightsBps(values);
      expect(result.reduce((a, b) => a + b, 0)).toBe(10_000);
    }
  });
});

describe("sanitizeInstrumentName / normalizeIsin", () => {
  it("behält normale ETF-Namen", () => {
    expect(sanitizeInstrumentName("Muster MSCI World UCITS ETF")).toBe(
      "Muster MSCI World UCITS ETF",
    );
    expect(sanitizeInstrumentName("  Muster   World  ")).toBe("Muster World");
  });

  it("verwirft Namen mit IBAN, E-Mail oder langer Ziffernfolge", () => {
    expect(sanitizeInstrumentName("ETF DE02 1203 0000 0000 2020 51")).toBeNull();
    expect(sanitizeInstrumentName("ETF DE02120300000000202051")).toBeNull();
    expect(sanitizeInstrumentName("ETF kontakt@example.com")).toBeNull();
    expect(sanitizeInstrumentName("ETF 1234567890")).toBeNull();
    expect(sanitizeInstrumentName("   ")).toBeNull();
  });

  it("kürzt Überlänge auf 80 Zeichen, prüft PII aber vor dem Kürzen", () => {
    const long = "A".repeat(200);
    expect(sanitizeInstrumentName(long)).toHaveLength(MAX_INSTRUMENT_NAME_LENGTH);
    expect(sanitizeInstrumentName(`${"A ".repeat(60)}12345678`)).toBeNull();
  });

  it("akzeptiert nur gültige ISINs", () => {
    expect(normalizeIsin(` ${ETF_ISIN} `)).toBe(ETF_ISIN);
    expect(normalizeIsin(ETF_ISIN.toLowerCase())).toBeNull();
    expect(normalizeIsin("IE00B4L5Y98")).toBeNull();
    expect(normalizeIsin("IE00B4L5Y98A")).toBeNull();
    expect(normalizeIsin(null)).toBeNull();
  });
});

describe("buildInvestmentContext – Portfolio", () => {
  it("summiert Klassen- und Positionsgewichte auf 10.000", () => {
    const ctx = buildInvestmentContext(baseInput());
    expect(ctx.portfolio.totalValueCents).toBe(1_000_000);
    expect(ctx.portfolio.assetClasses.map((c) => c.weightBps)).toEqual([
      7000, 2000, 1000,
    ]);
    const sum =
      ctx.portfolio.positions.reduce((s, p) => s + p.weightBps, 0) +
      ctx.portfolio.otherPositionsWeightBps;
    expect(sum).toBe(10_000);
    expect(ctx.portfolio.largestPositionWeightBps).toBe(7000);
  });

  it("vergibt Refs je Klasse nach Wert und sortiert Gleichstand nach id", () => {
    const mk = (id: string, value: number) => ({
      id,
      accountId: "a",
      name: `Muster ETF ${id}`,
      isin: null,
      assetClass: "etf" as const,
      marketValueCents: value,
    });
    const ctx = buildInvestmentContext(
      baseInput({
        positions: [mk("b", 100), mk("a", 100), mk("c", 500)],
      }),
    );
    expect(ctx.portfolio.positions.map((p) => [p.ref, p.instrumentName])).toEqual([
      ["ETF-1", "Muster ETF c"],
      ["ETF-2", "Muster ETF a"],
      ["ETF-3", "Muster ETF b"],
    ]);
  });

  it("ignoriert 0-Cent-Positionen", () => {
    const input = baseInput();
    input.positions.push({
      id: "zero",
      accountId: "a",
      name: "Leer",
      isin: null,
      assetClass: "etf",
      marketValueCents: 0,
    });
    const ctx = buildInvestmentContext(input);
    expect(ctx.dataQuality.positionCount).toBe(3);
  });

  it("kappt bei 25 Positionen auf 20 und weist den Rest aus", () => {
    const positions = Array.from({ length: 25 }, (_, i) => ({
      id: `p${String(i).padStart(2, "0")}`,
      accountId: "a",
      name: `Muster ETF ${i}`,
      isin: null,
      assetClass: "etf" as const,
      marketValueCents: 1000 + i,
    }));
    const ctx = buildInvestmentContext(baseInput({ positions }));
    expect(ctx.portfolio.positions).toHaveLength(20);
    expect(ctx.portfolio.otherPositionsWeightBps).toBeGreaterThan(0);
    expect(ctx.dataQuality.truncatedPositionCount).toBe(5);
    const sum =
      ctx.portfolio.positions.reduce((s, p) => s + p.weightBps, 0) +
      ctx.portfolio.otherPositionsWeightBps;
    expect(sum).toBe(10_000);
  });

  it("ist ohne Positionen nicht nutzbar", () => {
    const ctx = buildInvestmentContext(baseInput({ positions: [] }));
    expect(isInvestmentContextUsable(ctx)).toBe(false);
    expect(ctx.portfolio.totalValueCents).toBe(0);
    expect(ctx.portfolio.assetClasses.every((c) => c.weightBps === 0)).toBe(true);
    expect(isInvestmentContextUsable(buildInvestmentContext(baseInput()))).toBe(true);
  });

  it("wirft bei negativem Positionswert", () => {
    const input = baseInput();
    input.positions[0]!.marketValueCents = -1;
    expect(() => buildInvestmentContext(input)).toThrow(RangeError);
  });
});

describe("buildInvestmentContext – Liquidität & Notgroschen", () => {
  it("summiert Liquidität über Scopes und trennt Depot-Cash", () => {
    const ctx = buildInvestmentContext(baseInput());
    expect(ctx.liquidity.liquidCents).toBe(1_000_000);
    expect(ctx.liquidity.brokerageCashCents).toBe(50_000);
    expect(ctx.liquidity.coverageMonthsTenths).toBe(50);
  });

  it("begrenzt negative Gesamtliquidität auf 0", () => {
    const input = baseInput();
    input.accounts[0]!.balanceCents = -5_000_000;
    const ctx = buildInvestmentContext(input);
    expect(ctx.liquidity.liquidCents).toBe(0);
    expect(ctx.liquidity.coverageMonthsTenths).toBe(0);
  });

  it("gibt bei Kosten 0 oder null keine Abdeckung aus", () => {
    expect(
      buildInvestmentContext(baseInput({ monthlyLivingCostsCents: 0 })).liquidity
        .coverageMonthsTenths,
    ).toBeNull();
    expect(
      buildInvestmentContext(baseInput({ monthlyLivingCostsCents: null })).liquidity
        .coverageMonthsTenths,
    ).toBeNull();
  });

  it("rundet die Abdeckung ab (3,49 → 34)", () => {
    const input = baseInput({ monthlyLivingCostsCents: 100_000 });
    input.accounts = [
      {
        id: "a",
        name: "x",
        type: "checking",
        balanceCents: 349_000,
      },
    ];
    expect(buildInvestmentContext(input).liquidity.coverageMonthsTenths).toBe(34);
  });

  it("summiert mehrere Notgroschen-Töpfe; fehlendes Ziel → null", () => {
    const input = baseInput();
    input.pots.push({
      id: "pot-id-3",
      name: "Reserve 2",
      priority: 3,
      purpose: "emergency_fund",
      currentCents: 100_000,
      targetCents: 100_000,
      linkedContractId: null,
      linkedPropertyId: null,
    });
    let ctx = buildInvestmentContext(input);
    expect(ctx.emergencyFund).toEqual({
      configured: true,
      currentCents: 700_000,
      targetCents: 1_000_000,
      coverageMonthsTenths: 35,
    });
    input.pots[2]!.targetCents = null;
    ctx = buildInvestmentContext(input);
    expect(ctx.emergencyFund.targetCents).toBeNull();
  });

  it("markiert fehlenden Notgroschen als nicht konfiguriert", () => {
    const input = baseInput();
    input.pots = input.pots.filter((p) => p.purpose !== "emergency_fund");
    const ctx = buildInvestmentContext(input);
    expect(ctx.emergencyFund).toEqual({
      configured: false,
      currentCents: 0,
      targetCents: null,
      coverageMonthsTenths: null,
    });
    expect(collectContextRefs(ctx).has("NOTGROSCHEN")).toBe(false);
    expect(
      collectContextRefs(buildInvestmentContext(baseInput())).has("NOTGROSCHEN"),
    ).toBe(true);
  });
});

describe("buildInvestmentContext – Ziele & Meilensteine", () => {
  it("leitet kind und Horizont aus dem verknüpften Vertrag ab (früheres Datum)", () => {
    const ctx = buildInvestmentContext(baseInput());
    expect(ctx.goals).toHaveLength(1);
    expect(ctx.goals[0]).toEqual({
      ref: "ZIEL-1",
      purpose: "goal",
      kind: "loan_payoff",
      currentCents: 500_000,
      targetCents: 2_000_000,
      horizonMonths: 19,
    });
  });

  it("liefert 0 bei überfälligem Datum und null ohne Vertrag", () => {
    const overdue = baseInput({
      contracts: [loan({ milestoneDate: "2020-01-01", fixedInterestUntil: "2021-01-01" })],
    });
    expect(buildInvestmentContext(overdue).goals[0]!.horizonMonths).toBe(0);

    const noContract = baseInput();
    noContract.pots[0]!.linkedContractId = null;
    expect(buildInvestmentContext(noContract).goals[0]!.horizonMonths).toBeNull();
    expect(buildInvestmentContext(noContract).goals[0]!.kind).toBe("general");

    const property = baseInput();
    property.pots[0]!.linkedContractId = null;
    property.pots[0]!.linkedPropertyId = "prop-1";
    expect(buildInvestmentContext(property).goals[0]!.kind).toBe("property");
  });

  it("führt Töpfe ohne purpose als unspecified", () => {
    const input = baseInput();
    input.pots[0]!.purpose = null;
    expect(buildInvestmentContext(input).goals[0]!.purpose).toBe("unspecified");
  });

  it("liefert für pausierte/geschlossene Verträge keine Meilensteine", () => {
    for (const status of ["paused", "closed"] as const) {
      const ctx = buildInvestmentContext(baseInput({ contracts: [loan({ status })] }));
      expect(ctx.milestones).toEqual([]);
    }
  });

  it("begrenzt Meilensteine auf 8 und stimmt mit projectContractBalance überein", () => {
    const contracts = Array.from({ length: 6 }, (_, i) =>
      loan({
        id: `c${i}`,
        milestoneDate: `2027-0${i + 1}-15`,
        fixedInterestUntil: `2031-0${i + 1}-15`,
      }),
    );
    const ctx = buildInvestmentContext(baseInput({ contracts }));
    expect(ctx.milestones).toHaveLength(MAX_CONTEXT_MILESTONES);
    expect(ctx.milestones[0]!.ref).toBe("MEILENSTEIN-1");
    expect(ctx.milestones[0]!.outstandingBalanceCents).toBe(
      projectContractBalance(contracts[0]!, "2026-11-17").projectedBalanceCents,
    );
    expect(ctx.milestones[0]!.interestRateBps).toBe(350);
  });

  it("lässt überfällige Meilensteine weg", () => {
    const ctx = buildInvestmentContext(
      baseInput({
        contracts: [loan({ milestoneDate: "2020-01-01", fixedInterestUntil: null })],
      }),
    );
    expect(ctx.milestones).toEqual([]);
  });
});

describe("Datenqualität", () => {
  it("berechnet das Snapshot-Alter und behandelt fehlenden Snapshot", () => {
    expect(buildInvestmentContext(baseInput()).dataQuality.snapshotAgeDays).toBe(2);
    expect(
      buildInvestmentContext(baseInput({ snapshotFetchedAt: null })).dataQuality
        .snapshotAgeDays,
    ).toBeNull();
    expect(buildInvestmentContext(baseInput()).asOfMonth).toBe("2026-11");
  });
});

function collectStringLeaves(value: unknown, path: string[] = []): { path: string[]; value: string }[] {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => collectStringLeaves(v, [...path, String(i)]));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => collectStringLeaves(v, [...path, k]));
  }
  return [];
}

describe("PII-Leak-Tests", () => {
  const input = baseInput();
  input.positions.push({
    id: "pos-id-4",
    accountId: "acc-id-1",
    name: "Muster ETF kontakt@example.com",
    isin: ETF_ISIN.replace("IE", "LU"),
    assetClass: "etf",
    marketValueCents: 50_000,
  });
  input.accounts[0]!.name = "Girokonto Max Mustermann DE02 1203 0000 0000 2020 51";
  const ctx = buildInvestmentContext(input);
  const json = serializeInvestmentContext(ctx);

  it("enthält keine Namen, Provider, Labels oder Teilstrings davon", () => {
    for (const forbidden of [
      "Mustermann",
      "Max",
      "Erika",
      "Musterbank",
      "Musterstraße",
      "Ablösung",
      "Muster Robotics",
      "Robotics",
      "Muster Coin",
      "Girokonto",
      "Notgroschen Max",
      "symbol",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("enthält keine IBAN, E-Mail oder IDs", () => {
    expect(json).not.toMatch(/[A-Z]{2}\d{2}\s?\d{4}/);
    expect(json).not.toMatch(/@/);
    for (const id of [
      "pos-id-1",
      "pos-id-2",
      "pos-id-3",
      "pos-id-4",
      "acc-id-1",
      "acc-id-2",
      "acc-id-3",
      "pot-id-1",
      "pot-id-2",
      "contract-secret-1",
      "prop-",
    ]) {
      expect(json).not.toContain(id);
    }
  });

  it("gibt Einzelaktien und Krypto ohne Name/ISIN aus", () => {
    const stock = ctx.portfolio.positions.find((p) => p.assetClass === "stock")!;
    const crypto = ctx.portfolio.positions.find((p) => p.assetClass === "crypto")!;
    expect(stock).toMatchObject({ ref: "AKTIE-1", instrumentName: null, isin: null });
    expect(crypto).toMatchObject({ ref: "KRYPTO-1", instrumentName: null, isin: null });
    expect(json).not.toContain("DE000A0D6554");
  });

  it("enthält ETF-Name und gültige ISIN, maskiert aber PII im ETF-Namen", () => {
    expect(json).toContain("Muster MSCI World UCITS ETF");
    expect(json).toContain(ETF_ISIN);
    const piiEtf = ctx.portfolio.positions.find((p) => p.isin?.startsWith("LU"))!;
    expect(piiEtf.instrumentName).toBeNull();
  });

  it("besteht nur aus Allowlist-Strings (Enum, Ref, Monat, ETF-Name/ISIN)", () => {
    const enums = new Set([
      "etf",
      "stock",
      "crypto",
      "goal",
      "investment",
      "unspecified",
      "loan_payoff",
      "savings_contract",
      "property",
      "general",
      "loan",
      "milestone",
      "fixed_interest_end",
    ]);
    const refPattern = /^(ETF|AKTIE|KRYPTO|ZIEL|MEILENSTEIN)-\d+$/;
    for (const leaf of collectStringLeaves(ctx)) {
      const last = leaf.path[leaf.path.length - 1];
      const parent = leaf.path[leaf.path.length - 3];
      const isEtfText =
        parent === "positions" &&
        (last === "instrumentName" || last === "isin") &&
        ctx.portfolio.positions[Number(leaf.path[leaf.path.length - 2])]!.assetClass ===
          "etf";
      const ok =
        enums.has(leaf.value) ||
        refPattern.test(leaf.value) ||
        (last === "asOfMonth" && /^\d{4}-\d{2}$/.test(leaf.value)) ||
        isEtfText;
      expect(ok, `unerlaubter String bei ${leaf.path.join(".")}: ${leaf.value}`).toBe(true);
    }
  });
});

describe("withSavingsRate / serializeInvestmentContext", () => {
  it("erzeugt neue Instanz, Original bleibt unverändert", () => {
    const ctx = buildInvestmentContext(baseInput());
    const before = serializeInvestmentContext(ctx);
    const changed = withSavingsRate(ctx, 123_00);
    expect(changed).not.toBe(ctx);
    expect(changed.cashflow.monthlySavingsRateCents).toBe(12_300);
    expect(changed.cashflow.monthlySurplusCents).toBe(40_000);
    expect(serializeInvestmentContext(ctx)).toBe(before);
    expect(() => withSavingsRate(ctx, -1)).toThrow(RangeError);
    expect(() => withSavingsRate(ctx, 1.5)).toThrow(RangeError);
  });

  it("serialisiert byte-identisch für identischen Input", () => {
    const a = serializeInvestmentContext(buildInvestmentContext(baseInput()));
    const b = serializeInvestmentContext(buildInvestmentContext(baseInput()));
    expect(a).toBe(b);
    const parsed = JSON.parse(a) as InvestmentContext;
    expect(Object.keys(parsed)[0]).toBe("schemaVersion");
    expect(
      serializeInvestmentContext(withSavingsRate(buildInvestmentContext(baseInput()), 40_000)),
    ).toBe(a);
  });
});
