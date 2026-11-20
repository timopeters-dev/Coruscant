import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildInvestmentContext } from "@/domain/recommendation/investment-context";
import type { LoanOption } from "@/frontend/planung/planning-state";

let mockFrage: string | null = null;
let mockAnsicht: string | null = null;

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) =>
      key === "frage" ? mockFrage : key === "ansicht" ? mockAnsicht : null,
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

import { buildPrepaymentDefaults } from "@/domain/planning/prepayment-vs-etf";
import { PlanungWorkspace } from "@/frontend/planung/planung-workspace";
import { parsePropertyVsEtfQuery } from "@/frontend/planung/property-vs-etf-query";

const sampleLoan: LoanOption = {
  id: "loan-1",
  name: "Musterbank Kredit",
  provider: "Musterbank",
  defaults: buildPrepaymentDefaults(
    {
      id: "loan-1",
      name: "Musterbank Kredit",
      category: "loan",
      status: "active",
      currentBalanceCents: 10_000_000,
      balanceAsOfDate: "2026-11-19",
      monthlyRateCents: 80_000,
      interestRateBps: 350,
      repaymentType: "annuity",
      fixedInterestUntil: "2036-11-19",
      specialRepaymentMaxYearlyCents: 500_000,
    },
    "2026-11-19",
  ),
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
  ansicht: string | null = null,
) {
  mockFrage = frage;
  mockAnsicht = ansicht;
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

  it("zeigt die Immobilie-vs-ETF-Karte als Button, Dialog bleibt zu", () => {
    const html = renderWorkspace(null);
    expect(html).toContain("Schlägt diese Immobilie einen ETF?");
    expect(html).toMatch(
      /<button[^>]*type="button"[^>]*>(?:(?!<\/button>).)*Schlägt diese Immobilie einen ETF\?/s,
    );
    expect(html).not.toContain("Steuern berücksichtigen");
    expect(html).not.toContain('role="dialog"');
  });

  it("enthält in der kompakten Navigation den Button „Immobilie vs. ETF“", () => {
    const html = renderWorkspace("geld");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>\s*Immobilie vs\. ETF\s*<\/button>/);
    expect(html).not.toContain("Steuern berücksichtigen");
  });

  it("renders geld view with tabs, defaults to Wohin mit X €, and shows disclaimer", () => {
    const html = renderWorkspace("geld");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Wohin mit X €?");
    expect(html).toContain("Sparrate empfehlen");
    expect(html).toContain("Darlehen &amp; ETF");
    expect(html).toContain("Orientierung, keine Anlageberatung");

    const sparrateHtml = renderWorkspace("geld", [sampleLoan], "sparrate");
    expect(sparrateHtml).toContain("Monatlicher Überschuss");
    expect(sparrateHtml).toContain("Orientierung, keine Anlageberatung");
  });

  it("renders Slice-19 comparison when ansicht=vergleich", () => {
    const html = renderWorkspace("geld", [sampleLoan], "vergleich");
    expect(html).toContain("border-dashed");
    expect(html).toContain('<svg role="img"');

    const emptyHtml = renderWorkspace("geld", [], "vergleich");
    expect(emptyHtml).toContain('href="/vertraege"');
    expect(emptyHtml).not.toContain('<svg role="img"');
  });

  it("renders gehalt empty state when no pots exist", () => {
    const html = renderWorkspace("gehalt");
    expect(html).toContain('href="/allokation"');
  });

  it("renders coach view with Erklär mir das title and Freies Geld einsetzen link", () => {
    const html = renderWorkspace("coach");
    expect(html).toContain("Erklär mir das");
    expect(html).toContain("Freies Geld einsetzen");
  });

  it("öffnet den Immobilie-vs-ETF-Dialog mit Werten aus initialPropertyVsEtf", () => {
    mockFrage = null;
    mockAnsicht = null;
    const html = renderToStaticMarkup(
      <PlanungWorkspace
        asOfDate="2026-11-19"
        loanOptions={[sampleLoan]}
        baseSurplusCents={75_000}
        hasHouseholdData={true}
        isDummy={true}
        pots={[]}
        startMonth="2026-12"
        coachContext={emptyCoachContext}
        coachRefLabels={{}}
        initialPropertyVsEtf={parsePropertyVsEtfQuery(
          new URLSearchParams("dialog=immo-etf&kp=35000000&wfl=6550&kmqm=1250"),
        )}
      />,
    );
    expect(html).toContain("Immobilie vs. ETF");
    expect(html).toContain("350000,00");
    expect(html).toContain("Steuern berücksichtigen");
  });

  it("lässt den Dialog ohne initialPropertyVsEtf geschlossen", () => {
    const html = renderWorkspace(null);
    expect(html).not.toContain("Steuern berücksichtigen");
  });
});
