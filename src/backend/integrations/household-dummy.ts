import type { HouseholdSummary } from "@/validation/external";

export type HouseholdDummyMode = "true" | "false" | "auto";
export type HouseholdSourceStatus = "live" | "dummy" | "unavailable";

export interface ResolvedHouseholdData {
  household: HouseholdSummary | null;
  isDummy: boolean;
  sourceStatus: HouseholdSourceStatus;
}

/**
 * Evaluates `CORUSCANT_HOUSEHOLD_DUMMY` (`"true" | "false" | "auto"`).
 * Defaults to `"auto"` in non-production environments and `"false"` in production.
 */
export function getHouseholdDummyMode(
  env: Record<string, string | undefined> = process.env,
): HouseholdDummyMode {
  const raw = env.CORUSCANT_HOUSEHOLD_DUMMY?.trim().toLowerCase();
  if (raw === "true" || raw === "false" || raw === "auto") {
    return raw;
  }
  return env.NODE_ENV === "production" ? "false" : "auto";
}

/**
 * Returns deterministic, strictly fictional household dummy data (integer cents)
 * for joint household bridge development and preview when no live household bridge data exists.
 */
export function buildDummyHouseholdSummary(): HouseholdSummary {
  return {
    balanceCents: 425000,
    recurringInflowCents: 460000,
    recurringOutflowCents: 195000,
    variableBudgetsCents: 95000,
    variableRollingAvg3MCents: 104500,
    variableRollingAvg6MCents: 99200,
    categoriesBreakdown: [
      {
        categoryId: "dummy-lebensmittel",
        categoryName: "Lebensmittel",
        color: "#059669",
        budgetCents: 55000,
        avg3MCents: 61500,
        avg6MCents: 58200,
      },
      {
        categoryId: "dummy-hunde",
        categoryName: "Hunde & Tierbedarf",
        color: "#0284C7",
        budgetCents: 15000,
        avg3MCents: 16200,
        avg6MCents: 15400,
      },
      {
        categoryId: "dummy-drogerie",
        categoryName: "Drogerie & Haushalt",
        color: "#D97706",
        budgetCents: 12000,
        avg3MCents: 11800,
        avg6MCents: 12100,
      },
      {
        categoryId: "dummy-freizeit",
        categoryName: "Freizeit & Ausgehen",
        color: "#4F46E5",
        budgetCents: 13000,
        avg3MCents: 15000,
        avg6MCents: 13500,
      },
    ],
  };
}

export function resolveHouseholdDataForWorkspace(
  snapshotHousehold: HouseholdSummary | null,
  env: Record<string, string | undefined> = process.env,
): ResolvedHouseholdData {
  const mode = getHouseholdDummyMode(env);

  if (mode === "true") {
    return {
      household: buildDummyHouseholdSummary(),
      isDummy: true,
      sourceStatus: "dummy",
    };
  }

  if (snapshotHousehold !== null) {
    return {
      household: snapshotHousehold,
      isDummy: false,
      sourceStatus: "live",
    };
  }

  if (mode === "auto") {
    return {
      household: buildDummyHouseholdSummary(),
      isDummy: true,
      sourceStatus: "dummy",
    };
  }

  return {
    household: null,
    isDummy: false,
    sourceStatus: "unavailable",
  };
}
