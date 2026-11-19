import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AllocationBar } from "./allocation-bar";

describe("AllocationBar", () => {
  it("renders proportional segments summing to 100%, aria-labels with Euro amounts, and border-dashed", () => {
    const html = renderToStaticMarkup(
      <AllocationBar
        totalCents={1_000_000}
        segments={[
          {
            ref: "P1",
            kind: "emergency_fund",
            label: "Notgroschen",
            amountCents: 200_000,
          },
          {
            ref: "P2",
            kind: "loan_prepayment",
            label: "Musterkredit",
            amountCents: 300_000,
          },
          {
            ref: "P3",
            kind: "etf",
            label: "Breit gestreuter ETF",
            amountCents: 500_000,
          },
        ]}
      />,
    );

    expect(html).toContain("border-dashed");
    expect(html).toContain("width:20%");
    expect(html).toContain("width:30%");
    expect(html).toContain("width:50%");
    expect(html).toContain('aria-label="Notgroschen: 2.000 € (20 %)"');
    expect(html).toContain('aria-label="Musterkredit: 3.000 € (30 %)"');
    expect(html).toContain('aria-label="Breit gestreuter ETF: 5.000 € (50 %)"');
  });

  it("renders a single segment at 100% width", () => {
    const html = renderToStaticMarkup(
      <AllocationBar
        totalCents={500_000}
        segments={[
          {
            ref: "P1",
            kind: "etf",
            label: "Breit gestreuter ETF",
            amountCents: 500_000,
          },
        ]}
      />,
    );
    expect(html).toContain("width:100%");
  });
});
