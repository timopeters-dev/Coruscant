import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  markHistoryGaps,
  selectMonthEndValues,
  summarizeHistoryRange,
  thinHistory,
  type BalanceHistoryPoint,
} from "@/domain/cockpit/balance-history";
import { addDaysToIsoDate } from "@/domain/core/date";
import { BalanceHistoryDrawer } from "@/frontend/cockpit/balance-history-drawer";

describe("BalanceHistoryDrawer", () => {
  it("renders component chart and at most 12 monthly rows with negative net worth in rose", () => {
    const raw: BalanceHistoryPoint[] = [];
    for (let m = 1; m <= 14; m++) {
      const year = m <= 12 ? 2025 : 2026;
      const month = m <= 12 ? m : m - 12;
      const mm = String(month).padStart(2, "0");
      raw.push({
        date: `${year}-${mm}-15`,
        totalAssetsCents: 100_000,
        liabilitiesCents: 300_000,
        netWorthCents: -200_000,
        freeAssetsCents: 100_000,
        boundAssetsCents: 0,
        propertiesValueCents: 0,
        savingsContractsValueCents: 0,
        hasModeledValues: false,
      });
    }

    const marked = markHistoryGaps(raw);
    const summary = summarizeHistoryRange(marked);

    const html = renderToStaticMarkup(
      <BalanceHistoryDrawer
        open={true}
        onOpenChange={() => {}}
        points={marked}
        summary={summary}
        range="all"
        fromIso={null}
        todayIso="2026-03-01"
      />,
    );

    expect(html).toContain("Vermögensstruktur im Verlauf");
    expect(html).toContain("<svg");
    expect(html).toContain("Monatsendwerte anzeigen");
    const rowMatches = html.match(/<tbody>.*?<\/tbody>/)?.[0].match(/<tr /g) ?? [];
    expect(rowMatches).toHaveLength(12);
    expect(html).toContain("text-[var(--rose)]");
    expect(html).toContain("-2.000,00 €");
  });

  it("uses unthinned points for summary and month-end table when > 400 daily points are thinned", () => {
    // 450 consecutive days starting 2025-11-17:
    // 2026-10-31 (Saturday) and 2026-11-01 (Sunday) share ISO week 2026-W44,
    // so thinHistory drops 2026-10-31 in favor of 2026-11-01.
    const raw: BalanceHistoryPoint[] = [];
    for (let i = 0; i < 450; i++) {
      const date = addDaysToIsoDate("2025-11-17", i);
      // Distinct cent value on 2026-10-31 so we can verify the exact month-end row
      const freeAssetsCents =
        date === "2026-10-31" ? 999_999 : 100_000 + i * 100;
      raw.push({
        date,
        totalAssetsCents: freeAssetsCents,
        liabilitiesCents: 0,
        netWorthCents: freeAssetsCents,
        freeAssetsCents,
        boundAssetsCents: 0,
        propertiesValueCents: 0,
        savingsContractsValueCents: 0,
        hasModeledValues: false,
      });
    }

    const marked = markHistoryGaps(raw);
    const thinned = thinHistory(marked);
    expect(thinned.some((p) => p.date === "2026-10-31")).toBe(false);

    const summary = summarizeHistoryRange(marked);
    expect(summary.first?.date).toBe("2025-11-17");
    expect(summary.count).toBe(450);

    const monthEnds = selectMonthEndValues(marked, 12);
    const octRow = monthEnds.find((r) => r.month === "2026-10");
    expect(octRow?.point.date).toBe("2026-10-31");

    const html = renderToStaticMarkup(
      <BalanceHistoryDrawer
        open={true}
        onOpenChange={() => {}}
        points={thinned}
        rawPoints={marked}
        summary={summary}
        range="all"
        fromIso={null}
        todayIso="2027-02-10"
      />,
    );

    expect(html).toContain("9.999,99 €");
  });
});
