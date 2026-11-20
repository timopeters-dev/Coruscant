import { describe, expect, it } from "vitest";
import { householdSummarySchema } from "@/validation/external";
import {
  buildDummyHouseholdSummary,
  getHouseholdDummyMode,
  resolveHouseholdDataForWorkspace,
} from "@/backend/integrations/household-dummy";

describe("household-dummy", () => {
  it("builds strictly valid integer-cent dummy household data", () => {
    const dummy = buildDummyHouseholdSummary();
    const parsed = householdSummarySchema.safeParse(dummy);
    expect(parsed.success).toBe(true);
    expect(dummy.categoriesBreakdown.length).toBeGreaterThan(0);
  });

  it("evaluates CORUSCANT_HOUSEHOLD_DUMMY across auto, true, false, and NODE_ENV", () => {
    expect(getHouseholdDummyMode({ NODE_ENV: "development" })).toBe("auto");
    expect(getHouseholdDummyMode({ NODE_ENV: "production" })).toBe("false");
    expect(
      getHouseholdDummyMode({
        NODE_ENV: "production",
        CORUSCANT_HOUSEHOLD_DUMMY: "true",
      }),
    ).toBe("true");
    expect(
      getHouseholdDummyMode({
        NODE_ENV: "development",
        CORUSCANT_HOUSEHOLD_DUMMY: "false",
      }),
    ).toBe("false");
  });

  it("prefers live snapshot household over dummy in auto mode, and falls back to dummy when missing", () => {
    const live = buildDummyHouseholdSummary();
    live.balanceCents = 999_000;

    const withLive = resolveHouseholdDataForWorkspace(live, {
      NODE_ENV: "development",
      CORUSCANT_HOUSEHOLD_DUMMY: "auto",
    });
    expect(withLive.sourceStatus).toBe("live");
    expect(withLive.isDummy).toBe(false);
    expect(withLive.household?.balanceCents).toBe(999_000);

    const withoutLiveDev = resolveHouseholdDataForWorkspace(null, {
      NODE_ENV: "development",
      CORUSCANT_HOUSEHOLD_DUMMY: "auto",
    });
    expect(withoutLiveDev.sourceStatus).toBe("dummy");
    expect(withoutLiveDev.isDummy).toBe(true);
    expect(withoutLiveDev.household).not.toBeNull();

    const withoutLiveProd = resolveHouseholdDataForWorkspace(null, {
      NODE_ENV: "production",
    });
    expect(withoutLiveProd.sourceStatus).toBe("unavailable");
    expect(withoutLiveProd.isDummy).toBe(false);
    expect(withoutLiveProd.household).toBeNull();
  });
});
