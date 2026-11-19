import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildInvestmentContext } from "@/lib/domain/investment-context";
import type { LoanOption } from "./planning-state";

let mockFrage: string | null = null;

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "frage" ? mockFrage : null),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch: _prefetch,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
  }) => {
    void _prefetch;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

import { PlanungWorkspace } from "./planung-workspace";

const sampleLoan: LoanOption = {
  id: "loan-1",
  name: "Musterbank Kredit",
  provider: "Musterbank",
  defaults: {
    loan: {
      balanceCents: 10_000_000,
      monthlyRateCents: 80_000,
      interestRateBps: 350,
      repaymentType: "annuity",
      specialRepaymentMaxYearlyCents: 500_000,
    },
    startDate: "2026-11-19",
    horizonEndDate: "2036-11-19",
    horizonEstimated: false,
    capUnknown: false,
  },
};

const emptyCoachContext = buildInvestmentContext({
  asOfDate: "2026-11-19",
  snapshotFetchedAt: null,
  isDummyHousehold: true,
  positions: [],
  accounts: [],
  pots: [],
  contracts: [],
  monthlyLivingCostsCents: null,
  monthlySurplusCents: 0,
  monthlySavingsRateCents: 0,
});

function renderWorkspace(
  frage: string | null,
  loans: LoanOption[] = [sampleLoan],
) {
  mockFrage = frage;
  return renderToStaticMarkup(
    <PlanungWorkspace
      asOfDate="2026-11-19"
      loanOptions={loans}
      baseSurplusCents={75_000}
      hasHouseholdData={true}
      isDummy={true}
      pots={[]}
      startMonth="2026-12"
      coachContext={emptyCoachContext}
      coachRefLabels={{}}
    />,
  );
}

describe("PlanungWorkspace", () => {
  it("renders start view without frage param", () => {
    const html = renderWorkspace(null);
    expect(html).toContain("Was willst du wissen?");
    expect(html).toContain('href="/planung?frage=geld"');
    expect(html).toContain('href="/planung?frage=gehalt"');
    expect(html).toContain('href="/planung/kaufrechner"');
    expect(html).toContain('href="/planung?frage=coach"');
    expect(html).not.toContain('aria-label="Ergebnis"');
  });

  it("renders geld view with active segment, dashed result, and chart", () => {
    const html = renderWorkspace("geld");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("border-dashed");
    expect(html).toContain('<svg role="img"');
  });

  it("renders geld empty state when no loans exist", () => {
    const html = renderWorkspace("geld", []);
    expect(html).toContain('href="/vertraege"');
    expect(html).not.toContain('<svg role="img"');
  });

  it("renders gehalt empty state when no pots exist", () => {
    const html = renderWorkspace("gehalt");
    expect(html).toContain('href="/allokation"');
  });

  it("renders coach view with title and upcoming recommendations hint", () => {
    const html = renderWorkspace("coach");
    expect(html).toContain("Investment-Coach");
    expect(html).toContain("Wohin mit X €?");
  });
});
