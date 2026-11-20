import { describe, expect, it } from "vitest";
import { buildAdvisorReport, type AdvisorReportInput } from "@/domain/report/report";
import {
  AdvisorReportPiiError,
  assertAnonymizedViewClean,
  buildAdvisorReportView,
  checkAdvisorQuestion,
  collectSensitiveStrings,
} from "@/domain/report/anonymize";
import { renderAdvisorReportText } from "@/domain/report/text";
import { calculateHouseholdBalance } from "@/domain/cockpit/balance";
import { calculateConsolidatedCashflow } from "@/domain/allocation/cashflow";
import {
  containsEmail,
  containsIban,
  containsLongDigitRun,
} from "@/domain/core/pii-patterns";

const TRAP_UUID_LOAN = "11111111-2222-4333-8444-555555555551";
const TRAP_UUID_SAVINGS = "11111111-2222-4333-8444-555555555552";
const TRAP_UUID_PROP = "11111111-2222-4333-8444-555555555553";
const TRAP_UUID_POT = "11111111-2222-4333-8444-555555555554";

function buildTrapReport() {
  const asOfDate = "2026-11-19";
  const properties: AdvisorReportInput["properties"] = [
    {
      id: TRAP_UUID_PROP,
      name: "Musterstraße 1, 12345 Musterstadt",
      usage: "rented",
      purchaseDate: "2020-04-15",
      purchasePriceCents: 30_000_000,
      estimatedValueCents: 35_000_000,
      monthlyColdRentCents: 120_000,
      monthlyNonRecoverableCostsCents: 15_000,
      monthlyMaintenanceAllowanceCents: 10_000,
    },
  ];
  const contracts: AdvisorReportInput["contracts"] = [
    {
      id: TRAP_UUID_LOAN,
      name: "Darlehen Erika Musterfrau Nr. 1234567890",
      provider: "Musterbank AG",
      category: "loan",
      status: "active",
      currentBalanceCents: 25_000_000,
      balanceAsOfDate: "2026-06-01",
      monthlyRateCents: 100_000,
      interestRateBps: 350,
      repaymentType: "annuity",
      linkedPropertyId: TRAP_UUID_PROP,
      milestoneDate: "2029-05-15",
      milestoneLabel: "Zuteilung DE89 3704 0044 0532 0130 00",
      fixedInterestUntil: "2030-05-31",
      futureLoanInterestRateBps: 450,
      specialRepaymentMaxYearlyCents: 0,
    },
    {
      id: TRAP_UUID_SAVINGS,
      name: "Bauspar Max Mustermann",
      provider: "Musterkasse GmbH",
      category: "savings_contract",
      status: "active",
      currentBalanceCents: 1_500_000,
      balanceAsOfDate: "2026-11-19",
      monthlyRateCents: 20_000,
      interestRateBps: 100,
      targetSumCents: 5_000_000,
      futureLoanInterestRateBps: null,
    },
  ];
  const pots: AdvisorReportInput["pots"] = [
    {
      id: TRAP_UUID_POT,
      name: "Urlaub max.mustermann@example.org",
      priority: 1,
      purpose: "goal",
      currentCents: 400_000,
      targetCents: 500_000,
      targetDate: "2027-11-01",
      ruleType: "fill_to_target",
      linkedContractId: null,
      linkedPropertyId: null,
      liquidityExclusion: null,
    },
  ];

  const cashflow = calculateConsolidatedCashflow({
    household: {
      balanceCents: 0,
      recurringInflowCents: 600_000,
      recurringOutflowCents: 200_000,
      variableBudgetsCents: 100_000,
      variableRollingAvg3MCents: 100_000,
      variableRollingAvg6MCents: 100_000,
    },
    manualItems: [],
    variableBasis: "budget",
  });

  const balance = calculateHouseholdBalance({
    asOfDate,
    properties,
    contracts,
    pots,
  });

  const report = buildAdvisorReport({
    asOfDate,
    generatedAt: "2026-11-19T10:00:00.000Z",
    snapshotFetchedAt: "2026-11-18T10:00:00.000Z",
    isDummyHousehold: false,
    balance,
    properties,
    contracts,
    pots,
    cashflow,
    history: [],
    recommendationState: {
      asOfDate,
      monthlyExpensesCents: cashflow.totalOutflowCents,
      monthlySurplusCents: cashflow.monthlySurplusCents,
      pots,
      loans: [
        {
          id: TRAP_UUID_LOAN,
          balanceCents: 25_000_000,
          interestRateBps: 350,
          monthlyRateCents: 100_000,
          repaymentType: "annuity",
          specialRepaymentMaxYearlyCents: 0,
          fixedInterestUntil: "2030-05-31",
          futureLoanInterestRateBps: 450,
        },
      ],
    },
    oneTimeAmountCents: 500_000,
  });

  return report;
}

function collectAllStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAllStrings(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectAllStrings(v, out);
  }
  return out;
}

describe("advisor-report-anonymize", () => {
  it("strips all PII, UUIDs, IBANs, emails, and digit runs in anonymized mode while preserving exact amounts and refs", () => {
    const report = buildTrapReport();
    const view = buildAdvisorReportView(report, "anonymized");
    const sensitive = collectSensitiveStrings(report);

    expect(() => assertAnonymizedViewClean(view, sensitive)).not.toThrow();

    const jsonLower = JSON.stringify(view).toLowerCase();
    const textLower = renderAdvisorReportText(view, {
      question: null,
    }).toLowerCase();

    const forbidden = [
      "erika",
      "musterfrau",
      "mustermann",
      "musterbank",
      "musterkasse",
      "musterstraße",
      "musterstadt",
      "12345",
      "1234567890",
      "de89",
      "@example.org",
      TRAP_UUID_LOAN,
      TRAP_UUID_SAVINGS,
      TRAP_UUID_PROP,
      TRAP_UUID_POT,
    ];

    for (const needle of forbidden) {
      expect(jsonLower, `JSON must not contain "${needle}"`).not.toContain(
        needle,
      );
      expect(textLower, `Text must not contain "${needle}"`).not.toContain(
        needle,
      );
    }

    for (const str of collectAllStrings(view)) {
      expect(containsIban(str)).toBe(false);
      expect(containsEmail(str)).toBe(false);
      expect(containsLongDigitRun(str, 8)).toBe(false);
    }

    // Refs and exact amounts preserved
    expect(view.contracts[0]!.ref).toBe("KREDIT-1");
    expect(view.contracts[0]!.displayName).toBe("KREDIT-1 · Annuität");
    expect(view.contracts[0]!.projectedBalanceCents).toBe(
      report.contracts[0]!.projectedBalanceCents,
    );
    expect(view.contracts[0]!.calibratedAsOfDisplay).toBe("06.2026");
    expect(view.contracts[0]!.fixedInterestUntilDisplay).toBe("05.2030");
    expect(view.contracts[0]!.milestone?.text).toBe("Meilenstein 05.2029");

    expect(view.contracts[1]!.ref).toBe("BAUSPAR-1");
    expect(view.properties[0]!.ref).toBe("IMMOBILIE-1");
    expect(view.pots[0]!.ref).toBe("TOPF-1");

    // Recommendation notes use refs instead of real names
    const allNotes = [
      ...view.recommendations.monthly.notes,
      ...(view.recommendations.oneTime?.notes ?? []),
    ].join("\n");
    expect(allNotes).toContain("KREDIT-1");
    expect(allNotes).toContain("TOPF-1");
  });

  it("retains real names and providers in full mode (positive control)", () => {
    const report = buildTrapReport();
    const view = buildAdvisorReportView(report, "full");
    const serialized = JSON.stringify(view);

    expect(serialized).toContain("Musterbank AG");
    expect(serialized).toContain("Musterstraße 1, 12345 Musterstadt");
    expect(view.contracts[0]!.calibratedAsOfDisplay).toBe("01.06.2026");
  });

  it("assertAnonymizedViewClean fails closed on leaked name, IBAN, or email without leaking the value in the error", () => {
    const report = buildTrapReport();
    const sensitive = collectSensitiveStrings(report);

    const leakedName = buildAdvisorReportView(report, "anonymized");
    leakedName.contracts[0]!.displayName = "KREDIT-1 · Musterbank AG";
    let caught: unknown;
    try {
      assertAnonymizedViewClean(leakedName, sensitive);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AdvisorReportPiiError);
    expect((caught as AdvisorReportPiiError).fieldPath).toBe(
      "contracts[0].displayName",
    );
    expect((caught as Error).message).not.toContain("Musterbank");

    const leakedIban = buildAdvisorReportView(report, "anonymized");
    leakedIban.meta.disclaimer = "Konto DE89 3704 0044 0532 0130 00";
    expect(() => assertAnonymizedViewClean(leakedIban, sensitive)).toThrow(
      AdvisorReportPiiError,
    );

    const leakedEmail = buildAdvisorReportView(report, "anonymized");
    leakedEmail.pots[0]!.displayName = "kontakt@example.org";
    expect(() => assertAnonymizedViewClean(leakedEmail, sensitive)).toThrow(
      AdvisorReportPiiError,
    );

    // Numeric cent value >= 8 digits (25_000_000) does NOT throw
    const cleanView = buildAdvisorReportView(report, "anonymized");
    expect(cleanView.balance.liabilitiesCents).toBeGreaterThanOrEqual(
      10_000_000,
    );
    expect(() => assertAnonymizedViewClean(cleanView, sensitive)).not.toThrow();

    // Sensitive string < 3 chars is ignored
    expect(() =>
      assertAnonymizedViewClean(cleanView, ["a", "kr"]),
    ).not.toThrow();
  });

  it("does not false-positive when entities have generic finance names like Notgroschen, Kredit, Bausparer, Haus, or Sparziel", () => {
    const asOfDate = "2026-11-19";
    const properties: AdvisorReportInput["properties"] = [
      {
        id: "prop-generic-1",
        name: "Haus",
        usage: "owner_occupied",
        purchaseDate: "2021-01-01",
        purchasePriceCents: 30_000_000,
        estimatedValueCents: 32_000_000,
      },
    ];
    const contracts: AdvisorReportInput["contracts"] = [
      {
        id: "loan-generic-1",
        name: "Kredit",
        provider: "Bank",
        category: "loan",
        status: "active",
        currentBalanceCents: 15_000_000,
        balanceAsOfDate: "2026-09-01",
        monthlyRateCents: 80_000,
        interestRateBps: 350,
        repaymentType: "annuity",
        linkedPropertyId: "prop-generic-1",
        futureLoanInterestRateBps: null,
      },
      {
        id: "savings-generic-1",
        name: "Bausparer",
        provider: null,
        category: "savings_contract",
        status: "active",
        currentBalanceCents: 1_000_000,
        balanceAsOfDate: "2026-11-19",
        monthlyRateCents: 20_000,
        interestRateBps: 100,
        targetSumCents: 4_000_000,
        futureLoanInterestRateBps: null,
      },
    ];
    const pots: AdvisorReportInput["pots"] = [
      {
        id: "pot-generic-1",
        name: "Notgroschen",
        priority: 1,
        purpose: "emergency_fund",
        currentCents: 500_000,
        targetCents: 1_000_000,
        targetDate: null,
        ruleType: "fill_to_target",
        linkedContractId: null,
        linkedPropertyId: null,
        liquidityExclusion: null,
      },
      {
        id: "pot-generic-2",
        name: "Sparziel",
        priority: 2,
        purpose: "goal",
        currentCents: 100_000,
        targetCents: 300_000,
        targetDate: "2027-06-01",
        ruleType: "fill_to_target",
        linkedContractId: null,
        linkedPropertyId: null,
        liquidityExclusion: null,
      },
    ];
    const balance = calculateHouseholdBalance({
      asOfDate,
      properties,
      contracts,
      pots,
    });
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
    const report = buildAdvisorReport({
      asOfDate,
      generatedAt: "2026-11-19T10:00:00.000Z",
      snapshotFetchedAt: "2026-11-18T10:00:00.000Z",
      isDummyHousehold: false,
      balance,
      properties,
      contracts,
      pots,
      cashflow,
      history: [],
      recommendationState: {
        asOfDate,
        monthlyExpensesCents: cashflow.totalOutflowCents,
        monthlySurplusCents: cashflow.monthlySurplusCents,
        pots,
        loans: [
          {
            id: "loan-generic-1",
            balanceCents: 15_000_000,
            interestRateBps: 350,
            monthlyRateCents: 80_000,
            repaymentType: "annuity",
            specialRepaymentMaxYearlyCents: null,
            fixedInterestUntil: null,
            futureLoanInterestRateBps: null,
          },
        ],
      },
      oneTimeAmountCents: 500_000,
    });

    const view = buildAdvisorReportView(report, "anonymized");
    const sensitive = collectSensitiveStrings(report);
    expect(() => assertAnonymizedViewClean(view, sensitive)).not.toThrow();

    // Whole-word guard still catches actual leaked names (and ignores substring coincidences)
    expect(() =>
      assertAnonymizedViewClean(view, ["haushalt"]),
    ).not.toThrow();
    const leaked = buildAdvisorReportView(report, "anonymized");
    leaked.properties[0]!.displayName = "IMMOBILIE-1 · Haus Musterstraße 1";
    expect(() =>
      assertAnonymizedViewClean(leaked, ["haus musterstraße 1"]),
    ).toThrow(AdvisorReportPiiError);
  });

  it("checkAdvisorQuestion detects IBAN, email, digit runs, and known names accurately", () => {
    const sensitive = ["musterbank ag", "darlehen erika musterfrau"];

    expect(checkAdvisorQuestion("", sensitive)).toEqual({
      ok: true,
      issues: [],
    });
    expect(checkAdvisorQuestion("   ", sensitive)).toEqual({
      ok: true,
      issues: [],
    });

    expect(
      checkAdvisorQuestion(
        "IBAN DE89 3704 0044 0532 0130 00 prüfen",
        sensitive,
      ),
    ).toEqual({ ok: false, issues: ["iban"] });

    expect(
      checkAdvisorQuestion("IBAN DE89370400440532013000", sensitive),
    ).toEqual({ ok: false, issues: ["iban", "digit_run"] });

    expect(
      checkAdvisorQuestion("Antwort an max@example.org senden", sensitive),
    ).toEqual({ ok: false, issues: ["email"] });

    expect(checkAdvisorQuestion("Vertrag 12345678", sensitive)).toEqual({
      ok: false,
      issues: ["digit_run"],
    });
    expect(checkAdvisorQuestion("Vertrag 1234567", sensitive)).toEqual({
      ok: true,
      issues: [],
    });

    expect(
      checkAdvisorQuestion(
        "Lohnt sich Sondertilgung bei der musterbank?",
        sensitive,
      ),
    ).toEqual({ ok: false, issues: ["known_name"] });

    expect(
      checkAdvisorQuestion(
        "Soll ich den Kredit tilgen oder ins Depot?",
        sensitive,
      ),
    ).toEqual({ ok: true, issues: [] });

    // Documented boundary: compound word is not a whole-word match
    expect(
      checkAdvisorQuestion("Lohnt sich die Musterbankfiliale?", sensitive),
    ).toEqual({ ok: true, issues: [] });

    // Multiple issues in fixed order without duplicates
    expect(
      checkAdvisorQuestion(
        "Erika (max@example.org) hat DE89 3704 0044 0532 0130 00 und Nr 98765432 und noch eine 11223344",
        sensitive,
      ),
    ).toEqual({
      ok: false,
      issues: ["iban", "email", "digit_run", "known_name"],
    });
  });

  it("includes loan options in full mode and strips note + formats MM.JJJJ in anonymized mode while passing PII guard", () => {
    const asOfDate = "2026-11-19";
    const contracts = [
      {
        id: "loan-opts-1",
        name: "Hauskredit Musterstraße 1",
        provider: "Musterbank",
        category: "loan" as const,
        status: "active" as const,
        currentBalanceCents: 20_000_000,
        balanceAsOfDate: "2026-11-01",
        monthlyRateCents: 120_000,
        interestRateBps: 380,
        repaymentType: "annuity" as const,
        fixedInterestUntil: "2036-06-15",
        futureLoanInterestRateBps: null,
        originalPrincipalCents: 25_000_000,
        specialRepaymentRight: "allowed" as const,
        specialRepaymentBasis: "percent_original" as const,
        specialRepaymentPercentBps: 500,
        specialRepaymentUsedCents: 200_000,
        specialRepaymentUsedYear: 2026,
        rateChangeRight: "allowed" as const,
        rateChangeTotalCount: 2,
        rateChangeScope: "fixed_period" as const,
        rateChangeUsedCount: 1,
        rateChangeMinRepaymentBps: 100,
        rateChangeMaxRepaymentBps: 500,
        loanOptionsNote:
          "Ansprechpartnerin Erika Musterfrau, IBAN DE89 3704 0044 0532 0130 00",
      },
      {
        id: "loan-opts-2",
        name: "Kredit Beispielkasse",
        provider: "Beispielkasse",
        category: "loan" as const,
        status: "active" as const,
        currentBalanceCents: 5_000_000,
        balanceAsOfDate: "2026-11-01",
        monthlyRateCents: 40_000,
        interestRateBps: 120,
        repaymentType: "annuity" as const,
        fixedInterestUntil: null,
        futureLoanInterestRateBps: null,
      },
    ];
    const balance = calculateHouseholdBalance({
      asOfDate,
      properties: [],
      contracts,
      pots: [],
    });
    const cashflow = calculateConsolidatedCashflow({
      household: null,
      manualItems: [],
      variableBasis: "budget",
    });
    const report = buildAdvisorReport({
      asOfDate,
      generatedAt: "2026-11-19T10:00:00.000Z",
      snapshotFetchedAt: "2026-11-18T10:00:00.000Z",
      isDummyHousehold: false,
      balance,
      properties: [],
      contracts,
      pots: [],
      cashflow,
      history: [],
      recommendationState: {
        asOfDate,
        monthlyExpensesCents: null,
        monthlySurplusCents: 0,
        pots: [],
        loans: [],
      },
      oneTimeAmountCents: null,
    });

    // Full mode: options, corridor, remaining, note all present
    const fullView = buildAdvisorReportView(report, "full");
    const fullLoan1 = fullView.contracts.find((c) => c.ref === "KREDIT-1")!;
    expect(fullLoan1.loanOptions).not.toBeNull();
    expect(fullLoan1.loanOptions!.originalPrincipalCents).toBe(25_000_000);
    expect(fullLoan1.loanOptions!.specialRepayment.capThisYearCents).toBe(
      1_250_000,
    );
    expect(fullLoan1.loanOptions!.specialRepayment.remainingThisYearCents).toBe(
      1_050_000,
    );
    expect(fullLoan1.loanOptions!.rateChange.remainingChanges).toBe(1);
    expect(fullLoan1.loanOptions!.rateChange.latestChangeDateDisplay).toBe(
      "15.06.2036",
    );
    expect(fullLoan1.loanOptions!.hasNote).toBe(true);
    expect(fullLoan1.loanOptions!.note).toContain("Erika Musterfrau");

    // Anonymized mode: note is null even with PII inside, hasNote is true, dates MM.JJJJ, PII guard passes
    const anonView = buildAdvisorReportView(report, "anonymized");
    const anonLoan1 = anonView.contracts.find((c) => c.ref === "KREDIT-1")!;
    expect(anonLoan1.loanOptions!.hasNote).toBe(true);
    expect(anonLoan1.loanOptions!.note).toBeNull();
    expect(anonLoan1.loanOptions!.rateChange.latestChangeDateDisplay).toBe(
      "06.2036",
    );
    const anonLoan2 = anonView.contracts.find((c) => c.ref === "KREDIT-2")!;
    expect(anonLoan2.loanOptions!.specialRepayment.status).toBe("unknown");
    expect(anonLoan2.loanOptions!.rateChange.status).toBe("unknown");

    const serialized = JSON.stringify(anonView);
    expect(serialized).not.toContain("Erika Musterfrau");
    expect(serialized).not.toContain("DE89");

    const sensitive = collectSensitiveStrings(report);
    expect(() => assertAnonymizedViewClean(anonView, sensitive)).not.toThrow();
  });
});
