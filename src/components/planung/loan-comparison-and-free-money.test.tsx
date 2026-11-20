import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DomainContract } from "@/lib/domain/contracts";
import { buildLoanComparison } from "@/lib/domain/loan-comparison";
import { buildPrepaymentDefaults } from "@/lib/domain/scenarios";
import { FreeMoneyPanel } from "./free-money-panel";
import { LoanComparisonTable } from "./loan-comparison-table";
import {
  createFreeMoneyState,
  freeMoneyReducer,
  parsePlanningLoanId,
  type LoanOption,
} from "./planning-state";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const AS_OF = "2026-11-19";

const musterbankContract: DomainContract = {
  id: "loan-muster",
  name: "Musterbank Darlehen",
  category: "loan",
  status: "active",
  currentBalanceCents: 20_000_000,
  balanceAsOfDate: "2026-11-01",
  monthlyRateCents: 110_000,
  interestRateBps: 420,
  repaymentType: "annuity",
  fixedInterestUntil: "2036-11-01",
  originalPrincipalCents: 25_000_000,
  specialRepaymentRight: "allowed",
  specialRepaymentBasis: "percent_original",
  specialRepaymentPercentBps: 500,
  rateChangeRight: "allowed",
  rateChangeTotalCount: 2,
  rateChangeScope: "fixed_period",
  rateChangeUsedCount: 0,
  rateChangeMinRepaymentBps: 100,
  rateChangeMaxRepaymentBps: 500,
};

const beispielkasseContract: DomainContract = {
  id: "loan-beispiel",
  name: "Beispielkasse Kredit",
  category: "loan",
  status: "active",
  currentBalanceCents: 10_000_000,
  balanceAsOfDate: "2026-11-01",
  monthlyRateCents: 60_000,
  interestRateBps: 120,
  repaymentType: "annuity",
  fixedInterestUntil: "2036-11-01",
  specialRepaymentRight: "unknown",
  rateChangeRight: "none",
};

function toLoanOption(c: DomainContract, provider: string): LoanOption {
  return {
    id: c.id,
    name: c.name,
    provider,
    defaults: buildPrepaymentDefaults(c, AS_OF),
    contract: c,
  };
}

describe("LoanComparisonTable & ?kredit= preselection", () => {
  const options: LoanOption[] = [
    toLoanOption(beispielkasseContract, "Beispielkasse"),
    toLoanOption(musterbankContract, "Musterbank"),
  ];

  it("sorts higher break-even loan first, marks aria-selected, and renders single-loan header", () => {
    const rows = buildLoanComparison(
      [beispielkasseContract, musterbankContract],
      {
        asOfDate: AS_OF,
        assumptions: {
          etfAnnualReturnBps: 600,
          safetyMarginBps: 100,
          saverAllowanceCents: 100_000,
          churchTaxBps: 0,
        },
      },
    );
    expect(rows[0]!.loanId).toBe("loan-muster");
    expect(rows[1]!.loanId).toBe("loan-beispiel");

    const html = renderToStaticMarkup(
      <LoanComparisonTable
        rows={rows}
        selectedLoanId="loan-beispiel"
        onSelectLoan={() => {}}
      />,
    );
    // Musterbank appears before Beispielkasse in table markup
    expect(html.indexOf("Musterbank Darlehen")).toBeLessThan(
      html.indexOf("Beispielkasse Kredit"),
    );
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');

    // Single-loan compact header
    const singleHtml = renderToStaticMarkup(
      <LoanComparisonTable
        rows={[rows[0]!]}
        selectedLoanId="loan-muster"
        onSelectLoan={() => {}}
      />,
    );
    expect(singleHtml).toContain('data-testid="loan-comparison-single"');
    expect(singleHtml).not.toContain("<table");
  });

  it("preselects valid ?kredit= and falls back to default for invalid kredit", () => {
    const valid = parsePlanningLoanId("loan-muster", options);
    expect(valid).toBe("loan-muster");
    const stateValid = createFreeMoneyState(options, AS_OF, valid);
    expect(stateValid.loanId).toBe("loan-muster");

    const invalid = parsePlanningLoanId("non-existent-id", options);
    expect(invalid).toBeNull();
    const stateFallback = createFreeMoneyState(options, AS_OF, invalid);
    expect(stateFallback.loanId).toBe("loan-beispiel");
  });
});

describe("FreeMoneyPanel channel toggle & break-even headline", () => {
  const options: LoanOption[] = [
    toLoanOption(musterbankContract, "Musterbank"),
    toLoanOption(beispielkasseContract, "Beispielkasse"),
  ];

  it("disables rate-increase channel toggle when loan has no rate change right", () => {
    const state = createFreeMoneyState(options, AS_OF, "loan-beispiel");
    const html = renderToStaticMarkup(
      <FreeMoneyPanel
        state={state}
        dispatch={() => {}}
        asOfDate={AS_OF}
        loanOptions={options}
      />,
    );
    expect(html).toMatch(
      /disabled=""[^>]*>(?:<span[^>]*>)?als höhere Rate(?:<\/span>)?<\/button>/,
    );
    expect(html).toContain("Höhere Rate nicht verfügbar");
  });

  it("switches break-even headline wording between special_repayment and rate_increase channels", () => {
    const specialState = createFreeMoneyState(options, AS_OF, "loan-muster");
    const specialHtml = renderToStaticMarkup(
      <FreeMoneyPanel
        state={specialState}
        dispatch={() => {}}
        asOfDate={AS_OF}
        loanOptions={options}
      />,
    );
    expect(specialHtml).toContain("Sondertilgung");
    expect(specialHtml).not.toContain("lohnt der ETF mehr als die höhere Rate");

    const rateState = freeMoneyReducer(
      specialState,
      { type: "setMonthlyChannel", channel: "rate_increase" },
      options,
    );
    expect(rateState.monthlyChannel).toBe("rate_increase");

    const rateHtml = renderToStaticMarkup(
      <FreeMoneyPanel
        state={rateState}
        dispatch={() => {}}
        asOfDate={AS_OF}
        loanOptions={options}
      />,
    );
    expect(rateHtml).toContain("lohnt der ETF mehr als die höhere Rate");
    expect(rateHtml).toContain("Startmonat der höheren Rate");
  });
});
