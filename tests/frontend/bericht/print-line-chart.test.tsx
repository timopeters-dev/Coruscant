import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdvisorReportViewHistoryRow } from "@/domain/report/view-types";
import { PrintLineChart } from "@/frontend/bericht/print-line-chart";

function makeRows(count: number): AdvisorReportViewHistoryRow[] {
  return Array.from({ length: count }, (_, idx) => {
    const month = String((idx % 12) + 1).padStart(2, "0");
    return {
      month: `2026-${month}`,
      monthDisplay: `${month}/2026`,
      netWorthCents: 1_000_000 + idx * 100_000,
      freeAssetsCents: 500_000 + idx * 50_000,
      boundAssetsCents: 1_000_000,
      liabilitiesCents: 500_000 - idx * 50_000,
      hasModeledValues: idx === count - 1,
    };
  });
}

describe("PrintLineChart", () => {
  it("renders fallback notice for 0 and 1 rows", () => {
    const emptyHtml = renderToStaticMarkup(<PrintLineChart rows={[]} />);
    expect(emptyHtml).toContain("Noch zu wenig Verlauf für ein Diagramm");
    expect(emptyHtml).not.toContain("<svg");

    const oneHtml = renderToStaticMarkup(<PrintLineChart rows={makeRows(1)} />);
    expect(oneHtml).toContain("Noch zu wenig Verlauf für ein Diagramm");
    expect(oneHtml).not.toContain("<svg");
  });

  it("renders a static SVG with role=img, aria-label, and no event handlers for 12 rows", () => {
    const html = renderToStaticMarkup(<PrintLineChart rows={makeRows(12)} />);
    expect(html).toContain("<svg");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Nettovermögen-Verlauf');
    expect(html).toContain('viewBox="0 0 640 220"');
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});
