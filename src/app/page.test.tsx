import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateBalanceBarBreakdown,
  calculateHouseholdBalance,
} from "@/lib/domain/balance";
import type { CockpitPageData } from "@/db/queries/cockpit";

const mockLoadCockpitData = vi.fn<() => CockpitPageData>();
const mockLoadAdvisorReportOutline = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/db/queries/cockpit", () => ({
  loadCockpitData: () => mockLoadCockpitData(),
}));

vi.mock("@/db/queries/advisor-report", () => ({
  loadAdvisorReportOutline: (asOfDate?: string) =>
    mockLoadAdvisorReportOutline(asOfDate),
}));

import CockpitPage from "./page";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CockpitPage", () => {
  it("still renders the cockpit when loadAdvisorReportOutline throws", () => {
    const asOfDate = "2026-11-19";
    const balance = calculateHouseholdBalance({
      asOfDate,
      properties: [],
      contracts: [],
      pots: [],
    });
    mockLoadCockpitData.mockReturnValue({
      asOfDate,
      balance,
      barBreakdown: calculateBalanceBarBreakdown(balance),
      milestones: { items: [], totalCount: 0, overdueCount: 0 },
      potDeadlines: {
        atRiskCount: 0,
        overdueCount: 0,
        tightCount: 0,
        worst: null,
      },
      topPots: [],
      latestSnapshotFetchedAt: null,
      activeContractsCount: 0,
      projectedContractsCount: 0,
      projectedAssetContractsCount: 0,
      projectedLiabilityContractsCount: 0,
      isBridgeConfigured: false,
      syncIntervalMinutes: 60,
      isSnapshotStale: false,
      nextSyncAtMs: null,
      rentalPortfolioHint: null,
      history: [],
    });
    mockLoadAdvisorReportOutline.mockImplementation(() => {
      throw new Error("Simulated outline failure");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const html = renderToStaticMarkup(<CockpitPage />);

    expect(html).toContain("Haushalts-Cockpit");
    expect(html).toContain("Berater-Bericht");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
