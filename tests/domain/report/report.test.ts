import { describe, expect, it } from "vitest";
import { calculateHouseholdBalance } from "@/domain/cockpit/balance";
import type { BalanceHistoryPoint } from "@/domain/cockpit/balance-history";
import { calculateConsolidatedCashflow } from "@/domain/allocation/cashflow";
import { ADVISOR_REPORT_SCHEMA_VERSION, type AdvisorReportInput } from "@/domain/report/types";
import { buildAdvisorReport, parseAdvisorOneTimeAmount, parseAdvisorReportMode } from "@/domain/report/report";
import { buildAdvisorReportOutline } from "@/domain/report/outline";

function makeBaseInput(
  overrides: Partial<AdvisorReportInput> = {},
): AdvisorReportInput {
  const asOfDate = overrides.asOfDate ?? "2026-11-19";
  const properties = overrides.properties ?? [];
  const contracts = overrides.contracts ?? [];
  const pots = overrides.pots ?? [];

  const balance =
    overrides.balance ??
    calculateHouseholdBalance({
      asOfDate,
      properties,
      contracts,
      pots,
    });

  const cashflow =
    overrides.cashflow ??
    calculateConsolidatedCashflow({
      household: null,
      manualItems: [],
      variableBasis: "budget",
    });

  const recommendationState = overrides.recommendationState ?? {
    asOfDate,
    monthlyExpensesCents:
      cashflow.totalOutflowCents > 0 ? cashflow.totalOutflowCents : null,
    monthlySurplusCents: cashflow.monthlySurplusCents,
    pots,
    loans: contracts
      .filter((c) => c.category === "loan" && c.status !== "closed")
      .map((c) => ({
        id: c.id,
        balanceCents: c.currentBalanceCents,
        interestRateBps: c.interestRateBps,
        monthlyRateCents: c.monthlyRateCents,
        repaymentType: c.repaymentType ?? null,
        specialRepaymentMaxYearlyCents:
          c.specialRepaymentMaxYearlyCents ?? null,
        fixedInterestUntil: c.fixedInterestUntil ?? null,
        futureLoanInterestRateBps: c.futureLoanInterestRateBps,
      })),
  };

  return {
    asOfDate,
    generatedAt: "2026-11-19T09:00:00.000Z",
    snapshotFetchedAt: null,
    isDummyHousehold: false,
    balance,
    properties,
    contracts,
    pots,
    cashflow,
    history: [],
    recommendationState,
    oneTimeAmountCents: null,
    ...overrides,
  };
}

describe("advisor-report", () => {
  it("handles completely empty data with deterministic hints and zero balance", () => {
    const report = buildAdvisorReport(makeBaseInput());

    expect(report.meta.schemaVersion).toBe(ADVISOR_REPORT_SCHEMA_VERSION);
    expect(report.contracts).toEqual([]);
    expect(report.properties).toEqual([]);
    expect(report.pots).toEqual([]);
    expect(report.history.rows).toEqual([]);
    expect(report.balance.netWorthCents).toBe(0);
    expect(report.balance.freeShareBps).toBe(0);
    expect(report.balance.boundShareBps).toBe(0);
    expect(report.balance.liabilitiesShareBps).toBe(0);
    expect(report.dataQuality.hints).toEqual([
      { code: "NO_SNAPSHOT" },
      { code: "NO_HOUSEHOLD_CASHFLOW" },
      { code: "HISTORY_SPARSE", monthCount: 0 },
    ]);
    expect(
      report.recommendations.monthly.notes.some((n) => n.code === "NO_SURPLUS"),
    ).toBe(true);
    expect(report.recommendations.oneTime).toBeNull();
    expect(report.recommendations.oneTimeInvalid).toBe(false);

    const outline = buildAdvisorReportOutline(report);
    expect(outline.find((s) => s.sectionId === "contracts")?.isEmpty).toBe(true);
    expect(outline.find((s) => s.sectionId === "profile")?.isEmpty).toBe(false);
  });

  it("handles loans only: excludes closed, includes paused, marks projection & stale calibration", () => {
    const report = buildAdvisorReport(
      makeBaseInput({
        snapshotFetchedAt: "2026-11-18T10:00:00.000Z",
        contracts: [
          {
            id: "loan-annuity",
            name: "Darlehen Musterbank",
            provider: "Musterbank AG",
            category: "loan",
            status: "active",
            currentBalanceCents: 10_000_000,
            balanceAsOfDate: "2025-09-01",
            monthlyRateCents: 100_000,
            interestRateBps: 350,
            repaymentType: "annuity",
            specialRepaymentMaxYearlyCents: 500_000,
            fixedInterestUntil: "2030-01-01",
            futureLoanInterestRateBps: 420,
          },
          {
            id: "loan-paused",
            name: "Kredit pausiert",
            provider: null,
            category: "loan",
            status: "paused",
            currentBalanceCents: 2_000_000,
            balanceAsOfDate: "2026-11-19",
            monthlyRateCents: 20_000,
            interestRateBps: 250,
            repaymentType: "annuity",
            specialRepaymentMaxYearlyCents: null,
            fixedInterestUntil: null,
            futureLoanInterestRateBps: null,
          },
          {
            id: "loan-closed",
            name: "Altkredit geschlossen",
            provider: "Musterbank AG",
            category: "loan",
            status: "closed",
            currentBalanceCents: 500_000,
            balanceAsOfDate: "2026-01-01",
            monthlyRateCents: 50_000,
            interestRateBps: 400,
            repaymentType: "annuity",
            specialRepaymentMaxYearlyCents: null,
            fixedInterestUntil: null,
            futureLoanInterestRateBps: null,
          },
        ],
      }),
    );

    expect(report.contracts.map((c) => c.entityKey)).toEqual([
      "contract:loan-annuity",
      "contract:loan-paused",
    ]);
    const annuity = report.contracts[0]!;
    const paused = report.contracts[1]!;

    expect(annuity.isProjected).toBe(true);
    expect(annuity.calibrationStale).toBe(true);
    expect(paused.status).toBe("paused");
    expect(paused.specialRepaymentMaxYearlyCents).toBeNull();

    expect(report.balance.liabilitiesCents).toBe(
      annuity.projectedBalanceCents + paused.projectedBalanceCents,
    );
    expect(report.balance.netWorthCents).toBeLessThan(0);
    expect(report.balance.isModeled).toBe(true);
    expect(report.dataQuality.hints).toContainEqual({
      code: "PROJECTED_CONTRACTS",
      count: 1,
    });
    expect(report.dataQuality.hints).toContainEqual({
      code: "STALE_CALIBRATION",
      count: 1,
    });
  });

  it("handles pots: progressBps half-up, null target, zero target edge case, deadlines, exclusions, emergency coverage", () => {
    const cashflow = calculateConsolidatedCashflow({
      household: {
        balanceCents: 0,
        recurringInflowCents: 500_000,
        recurringOutflowCents: 200_000,
        variableBudgetsCents: 100_000,
        variableRollingAvg3MCents: 100_000,
        variableRollingAvg6MCents: 100_000,
      },
      manualItems: [],
      variableBasis: "budget",
    });

    const report = buildAdvisorReport(
      makeBaseInput({
        snapshotFetchedAt: "2026-11-18T10:00:00.000Z",
        cashflow,
        pots: [
          {
            id: "pot-emergency",
            name: "Notgroschen",
            priority: 1,
            purpose: "emergency_fund",
            currentCents: 900_000,
            targetCents: 1_000_000,
            targetDate: null,
            ruleType: "fill_to_target",
            linkedContractId: null,
            linkedPropertyId: null,
            liquidityExclusion: null,
          },
          {
            id: "pot-deadline-ok",
            name: "Ruecklage Dach",
            priority: 2,
            purpose: "goal",
            currentCents: 100_000,
            targetCents: 300_000,
            targetDate: "2027-11-01",
            ruleType: "fill_to_target",
            linkedContractId: null,
            linkedPropertyId: null,
            liquidityExclusion: null,
          },
          {
            id: "pot-zero-target",
            name: "Null-Ziel",
            priority: 3,
            purpose: null,
            currentCents: 0,
            targetCents: 0,
            targetDate: null,
            ruleType: "fill_to_target",
            linkedContractId: null,
            linkedPropertyId: null,
            liquidityExclusion: null,
          },
          {
            id: "pot-excluded",
            name: "Konto extern",
            priority: 4,
            purpose: "investment",
            currentCents: 250_000,
            targetCents: null,
            targetDate: null,
            ruleType: "fixed_monthly",
            fixedMonthlyCents: 10_000,
            linkedContractId: null,
            linkedPropertyId: null,
            liquidityExclusion: "out_of_scope",
          },
        ],
      }),
    );

    const emergency = report.pots.find((p) => p.entityKey === "pot:pot-emergency")!;
    const deadlinePot = report.pots.find((p) => p.entityKey === "pot:pot-deadline-ok")!;
    const zeroPot = report.pots.find((p) => p.entityKey === "pot:pot-zero-target")!;
    const excluded = report.pots.find((p) => p.entityKey === "pot:pot-excluded")!;

    expect(emergency.progressBps).toBe(9000);
    // 100_000 / 300_000 * 10_000 = 3333.33 -> 3333
    expect(deadlinePot.progressBps).toBe(3333);
    expect(deadlinePot.targetMonth).toBe("2027-11");
    expect(deadlinePot.deadline?.status).toBe("on_track");
    expect(zeroPot.progressBps).toBeNull();
    expect(excluded.progressBps).toBeNull();

    // 900_000 / 300_000 = 3.0 months -> 30 tenths
    expect(report.profile.emergencyCoverageMonthsTenths).toBe(30);
    expect(report.dataQuality.hints).toContainEqual({
      code: "EXCLUDED_POTS",
      count: 1,
      cents: 250_000,
    });
  });

  it("marks dummy household as modeled and emits DUMMY_HOUSEHOLD hint", () => {
    const cashflow = calculateConsolidatedCashflow({
      household: {
        balanceCents: 0,
        recurringInflowCents: 400_000,
        recurringOutflowCents: 200_000,
        variableBudgetsCents: 100_000,
        variableRollingAvg3MCents: 100_000,
        variableRollingAvg6MCents: 100_000,
      },
      manualItems: [],
      variableBasis: "budget",
    });

    const report = buildAdvisorReport(
      makeBaseInput({
        isDummyHousehold: true,
        cashflow,
      }),
    );

    expect(report.cashflow.isModeled).toBe(true);
    expect(report.dataQuality.hints).toContainEqual({ code: "DUMMY_HOUSEHOLD" });
  });

  it("checks snapshot staleness boundaries: 8 days stale, 7 days ok, future date ok", () => {
    const stale = buildAdvisorReport(
      makeBaseInput({
        asOfDate: "2026-11-19",
        snapshotFetchedAt: "2026-11-11T10:00:00.000Z",
      }),
    );
    expect(stale.dataQuality.snapshotAgeDays).toBe(8);
    expect(stale.dataQuality.hints).toContainEqual({
      code: "SNAPSHOT_STALE",
      ageDays: 8,
    });

    const boundary = buildAdvisorReport(
      makeBaseInput({
        asOfDate: "2026-11-19",
        snapshotFetchedAt: "2026-11-12T10:00:00.000Z",
      }),
    );
    expect(boundary.dataQuality.snapshotAgeDays).toBe(7);
    expect(
      boundary.dataQuality.hints.some((h) => h.code === "SNAPSHOT_STALE"),
    ).toBe(false);

    const future = buildAdvisorReport(
      makeBaseInput({
        asOfDate: "2026-11-19",
        snapshotFetchedAt: "2026-11-22T10:00:00.000Z",
      }),
    );
    expect(future.dataQuality.snapshotAgeDays).toBeLessThanOrEqual(0);
    expect(
      future.dataQuality.hints.some((h) => h.code === "SNAPSHOT_STALE"),
    ).toBe(false);
  });

  it("handles properties: rental block only for rented, sorting by value desc then id asc", () => {
    const report = buildAdvisorReport(
      makeBaseInput({
        properties: [
          {
            id: "prop-b",
            name: "Musterstraße 2",
            usage: "owner_occupied",
            purchaseDate: "2020-05-01",
            purchasePriceCents: 40_000_000,
            estimatedValueCents: 45_000_000,
          },
          {
            id: "prop-a",
            name: "Musterstraße 1",
            usage: "rented",
            purchaseDate: "2021-03-15",
            purchasePriceCents: 30_000_000,
            estimatedValueCents: 45_000_000,
            monthlyColdRentCents: 120_000,
            monthlyNonRecoverableCostsCents: 15_000,
            monthlyMaintenanceAllowanceCents: 10_000,
          },
        ],
      }),
    );

    expect(report.properties.map((p) => p.entityKey)).toEqual([
      "property:prop-a",
      "property:prop-b",
    ]);
    expect(report.properties[0]!.rental).toBeDefined();
    expect(report.properties[0]!.rental?.monthlyColdRentCents).toBe(120_000);
    expect(report.properties[1]!.rental).toBeUndefined();
    expect(report.dataQuality.hints).toContainEqual({
      code: "PROPERTY_VALUES_ESTIMATED",
      count: 2,
    });
  });

  it("selects up to 12 ascending month-end history rows, handles duplicates, modeled flag, and sparse history", () => {
    const points: BalanceHistoryPoint[] = [];
    for (let i = 0; i < 14; i++) {
      const year = 2025 + Math.floor((9 + i) / 12);
      const month = ((9 + i) % 12) + 1;
      const ym = `${year}-${String(month).padStart(2, "0")}`;
      points.push({
        date: `${ym}-05`,
        totalAssetsCents: (i + 1) * 100_000,
        liabilitiesCents: 0,
        netWorthCents: (i + 1) * 100_000,
        freeAssetsCents: (i + 1) * 100_000,
        boundAssetsCents: 0,
        propertiesValueCents: 0,
        savingsContractsValueCents: 0,
        hasModeledValues: false,
      });
      points.push({
        date: `${ym}-25`,
        totalAssetsCents: (i + 1) * 100_000 + 50_000,
        liabilitiesCents: 0,
        netWorthCents: (i + 1) * 100_000 + 50_000,
        freeAssetsCents: (i + 1) * 100_000 + 50_000,
        boundAssetsCents: 0,
        propertiesValueCents: 0,
        savingsContractsValueCents: 0,
        hasModeledValues: i === 13,
      });
    }

    const report = buildAdvisorReport(makeBaseInput({ history: points }));
    expect(report.history.rows).toHaveLength(12);
    expect(report.history.rows[0]!.month < report.history.rows[11]!.month).toBe(
      true,
    );
    // Last point in month wins (+50_000)
    expect(report.history.rows[0]!.netWorthCents).toBe(350_000);
    expect(report.history.rows[11]!.netWorthCents).toBe(1_450_000);
    expect(report.history.netWorthDeltaCents).toBe(1_100_000);
    expect(report.history.anyModeled).toBe(true);
    expect(
      report.dataQuality.hints.some((h) => h.code === "HISTORY_SPARSE"),
    ).toBe(false);

    const sparse = buildAdvisorReport(
      makeBaseInput({ history: [points[0]!] }),
    );
    expect(sparse.history.rows).toHaveLength(1);
    expect(sparse.history.netWorthDeltaCents).toBeNull();
    expect(sparse.dataQuality.hints).toContainEqual({
      code: "HISTORY_SPARSE",
      monthCount: 1,
    });
  });

  it("parses one-time amounts and handles valid/invalid bounds", () => {
    expect(parseAdvisorOneTimeAmount("5.000")).toEqual({
      cents: 500_000,
      invalid: false,
    });
    expect(parseAdvisorOneTimeAmount("")).toEqual({
      cents: null,
      invalid: false,
    });
    expect(parseAdvisorOneTimeAmount(undefined)).toEqual({
      cents: null,
      invalid: false,
    });

    for (const bad of ["0", "-5", "abc", "0,99", "10.000.000,01"]) {
      expect(parseAdvisorOneTimeAmount(bad)).toEqual({
        cents: null,
        invalid: true,
      });
    }

    const validReport = buildAdvisorReport(
      makeBaseInput({ oneTimeAmountCents: 500_000 }),
    );
    expect(validReport.recommendations.oneTime?.mode).toBe("one_time");
    expect(validReport.recommendations.oneTimeInvalid).toBe(false);

    const invalidReport = buildAdvisorReport(
      makeBaseInput({ oneTimeAmountCents: 50 }),
    );
    expect(invalidReport.recommendations.oneTime).toBeNull();
    expect(invalidReport.recommendations.oneTimeInvalid).toBe(true);
  });

  it("parses report mode safely with anonymized default", () => {
    expect(parseAdvisorReportMode("vollstaendig")).toBe("full");
    expect(parseAdvisorReportMode("anonym")).toBe("anonymized");
    expect(parseAdvisorReportMode(undefined)).toBe("anonymized");
    expect(parseAdvisorReportMode("VOLLSTAENDIG")).toBe("anonymized");
    expect(parseAdvisorReportMode("x")).toBe("anonymized");
  });

  it("is deterministic and independent of contract input order", () => {
    const c1 = {
      id: "loan-1",
      name: "Kredit A",
      provider: "Musterbank",
      category: "loan" as const,
      status: "active" as const,
      currentBalanceCents: 5_000_000,
      balanceAsOfDate: "2026-11-19",
      monthlyRateCents: 50_000,
      interestRateBps: 300,
      repaymentType: "annuity" as const,
      specialRepaymentMaxYearlyCents: null,
      fixedInterestUntil: null,
      futureLoanInterestRateBps: null,
    };
    const c2 = {
      ...c1,
      id: "loan-2",
      name: "Kredit B",
      currentBalanceCents: 8_000_000,
    };

    const r1 = buildAdvisorReport(makeBaseInput({ contracts: [c1, c2] }));
    const r2 = buildAdvisorReport(makeBaseInput({ contracts: [c2, c1] }));
    expect(r1).toEqual(r2);
  });

  it("throws on invalid asOfDate or negative pot balance", () => {
    expect(() =>
      buildAdvisorReport(makeBaseInput({ asOfDate: "2026-02-30" })),
    ).toThrow(RangeError);

    expect(() =>
      buildAdvisorReport(
        makeBaseInput({
          pots: [
            {
              id: "pot-neg",
              name: "Negativ",
              priority: 1,
              purpose: null,
              currentCents: -100,
              targetCents: null,
              targetDate: null,
              ruleType: "fixed_monthly",
              fixedMonthlyCents: 1000,
              linkedContractId: null,
              linkedPropertyId: null,
              liquidityExclusion: null,
            },
          ],
          balance: {
            asOfDate: "2026-11-19",
            freeAssetsCents: 0,
            conflictingLinkedPotsCents: 0,
            outOfScopeLinkedPotsCents: 0,
            propertiesValueCents: 0,
            savingsContractsValueCents: 0,
            boundAssetsCents: 0,
            totalAssetsCents: 0,
            liabilitiesCents: 0,
            netWorthCents: 0,
          },
        }),
      ),
    ).toThrow(RangeError);
  });
});
