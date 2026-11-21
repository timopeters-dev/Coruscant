import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

import { PurchaseCalculatorWorkspace } from "@/frontend/planung/purchase-calculator-workspace";

describe("Kaufrechner: Mit ETF vergleichen", () => {
  it("verlinkt bei gültiger Eingabe auf den Immobilie-vs-ETF-Dialog", () => {
    const html = renderToStaticMarkup(
      <PurchaseCalculatorWorkspace
        asOfDate="2026-11-19"
        monthlySurplusCents={75_000}
        hasHouseholdData={true}
        isDummy={true}
        pots={[]}
      />,
    );
    expect(html).toContain("Mit ETF vergleichen");
    expect(html).toContain(
      'href="/planung?dialog=immo-etf&amp;von=kaufrechner',
    );
  });
});
