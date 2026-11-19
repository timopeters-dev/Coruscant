import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateBalanceBarBreakdown } from "@/lib/domain/balance";
import {
  markHistoryGaps,
  summarizeHistoryRange,
  type BalanceHistoryPoint,
} from "@/lib/domain/balance-history";
import { addDaysToIsoDate } from "@/lib/domain/date";
import { BalanceBar } from "./balance-bar";
import { NetWorthHistoryCard } from "./net-worth-history-card";

function makePoint(
  date: string,
  overrides: Partial<BalanceHistoryPoint> = {},
): BalanceHistoryPoint {
  const freeAssetsCents = overrides.freeAssetsCents ?? 1_000_000;
  const propertiesValueCents = overrides.propertiesValueCents ?? 20_000_000;
  const savingsContractsValueCents =
    overrides.savingsContractsValueCents ?? 0;
  const boundAssetsCents =
    overrides.boundAssetsCents ??
    propertiesValueCents + savingsContractsValueCents;
  const totalAssetsCents =
    overrides.totalAssetsCents ?? freeAssetsCents + boundAssetsCents;
  const liabilitiesCents = overrides.liabilitiesCents ?? 10_000_000;
  const netWorthCents =
    overrides.netWorthCents ?? totalAssetsCents - liabilitiesCents;

  return {
    date,
    totalAssetsCents,
    liabilitiesCents,
    netWorthCents,
    freeAssetsCents,
    boundAssetsCents,
    propertiesValueCents,
    savingsContractsValueCents,
    hasModeledValues: overrides.hasModeledValues ?? propertiesValueCents > 0,
  };
}

describe("NetWorthHistoryCard", () => {
  it("renders empty state for 0 points without svg", () => {
    const html = renderToStaticMarkup(
      <NetWorthHistoryCard
        totalCount={0}
        singlePoint={null}
        points={[]}
        summary={summarizeHistoryRange([])}
        range="12m"
        fromIso="2025-11-19"
        todayIso="2026-11-19"
        onRangeChange={() => {}}
      />,
    );
    expect(html).toContain("Der Verlauf entsteht mit der Zeit");
    expect(html).not.toContain('role="img"');
  });

  it("renders single-point state with date and net worth without svg", () => {
    const pt = makePoint("2026-11-18");
    const marked = markHistoryGaps([pt]);
    const html = renderToStaticMarkup(
      <NetWorthHistoryCard
        totalCount={1}
        singlePoint={pt}
        points={marked}
        summary={summarizeHistoryRange(marked)}
        range="12m"
        fromIso="2025-11-19"
        todayIso="2026-11-19"
        onRangeChange={() => {}}
      />,
    );
    expect(html).toContain("18.11.2026");
    expect(html).toContain("110.000 €");
    expect(html).not.toContain('role="img"');
  });

  it("renders range-empty hint with 'Alles anzeigen' button when total >= 2 but range < 2", () => {
    const pt = makePoint("2026-11-18");
    const marked = markHistoryGaps([pt]);
    const html = renderToStaticMarkup(
      <NetWorthHistoryCard
        totalCount={5}
        singlePoint={null}
        points={marked}
        summary={summarizeHistoryRange(marked)}
        range="3m"
        fromIso="2026-08-19"
        todayIso="2026-11-19"
        onRangeChange={() => {}}
      />,
    );
    expect(html).toContain("Im gewählten Zeitraum liegt nur 1 Momentaufnahme vor");
    expect(html).toContain("Alles anzeigen");
    expect(html).not.toContain('role="img"');
  });

  it("renders svg, modeled badge, dashed path, headline with +, and gap hint for >= 2 points", () => {
    const marked = markHistoryGaps([
      makePoint("2026-10-01", { freeAssetsCents: 1_000_000 }),
      makePoint("2026-10-20", { freeAssetsCents: 1_500_000 }), // 19 days -> gap
    ]);
    const html = renderToStaticMarkup(
      <NetWorthHistoryCard
        totalCount={2}
        singlePoint={null}
        points={marked}
        summary={summarizeHistoryRange(marked)}
        range="3m"
        fromIso="2026-08-19"
        todayIso="2026-11-19"
        onRangeChange={() => {}}
      />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("Modelliert");
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toContain("+5.000 €");
    expect(html).toContain("1 Lücke &gt; 7 Tage");
    // Regression: history chart X-axis still ends with "heute"
    expect(html).toContain(">heute</text>");
  });

  it("renders negative net worth delta with Unicode minus", () => {
    const marked = markHistoryGaps([
      makePoint("2026-11-01", {
        freeAssetsCents: 100_000,
        propertiesValueCents: 0,
        liabilitiesCents: 200_000, // net -100_000
      }),
      makePoint(addDaysToIsoDate("2026-11-01", 2), {
        freeAssetsCents: 50_000,
        propertiesValueCents: 0,
        liabilitiesCents: 300_000, // net -250_000 -> delta -150_000
      }),
    ]);
    const html = renderToStaticMarkup(
      <NetWorthHistoryCard
        totalCount={2}
        singlePoint={null}
        points={marked}
        summary={summarizeHistoryRange(marked)}
        range="3m"
        fromIso="2026-08-19"
        todayIso="2026-11-19"
        onRangeChange={() => {}}
      />,
    );
    expect(html).toContain("−1.500 €");
  });
});

describe("BalanceBar deltas", () => {
  const breakdown = calculateBalanceBarBreakdown({
    freeAssetsCents: 1_200_000,
    boundAssetsCents: 20_000_000,
    liabilitiesCents: 9_000_000,
  });

  it("keeps existing markup when deltas and onShowDetails are omitted", () => {
    const html = renderToStaticMarkup(<BalanceBar breakdown={breakdown} />);
    expect(html).not.toContain("seit ");
    expect(html).not.toContain("Details");
  });

  it("renders deltas with emerald for decreasing liabilities and Details button", () => {
    const html = renderToStaticMarkup(
      <BalanceBar
        breakdown={breakdown}
        deltas={{
          sinceDate: "2026-10-01",
          freeAssetsDeltaCents: 200_000,
          boundAssetsDeltaCents: 0,
          liabilitiesDeltaCents: -100_000,
        }}
        onShowDetails={() => {}}
      />,
    );
    expect(html).toContain("seit 01.10.2026");
    expect(html).toContain("+2.000,00 €");
    expect(html).toContain("-1.000,00 €");
    expect(html).toContain("text-[var(--emerald)]");
    expect(html).toContain("Details");
  });
});
