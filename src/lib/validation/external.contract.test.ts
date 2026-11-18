import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { finanzCockpitSummarySchema } from "./external";

/**
 * Contract-Test gegen die gemeinsamen Fixtures im Parent-Ordner
 * (`../docs/fixtures/`, siehe `../docs/BRIDGE-CONTRACT.md` §7).
 * Der Parent ist nicht versioniert; fehlt die Fixture (z. B. in CI mit nur
 * einem ausgecheckten Repo), wird der Test übersprungen statt zu scheitern.
 */
const FIXTURE_DIR = path.resolve(process.cwd(), "../docs/fixtures");
const HOUSEHOLD_FIXTURE = path.join(FIXTURE_DIR, "external-summary.household.json");
const PERSONAL_FIXTURE = path.join(FIXTURE_DIR, "external-summary.personal-only.json");
const fixturesAvailable =
  existsSync(HOUSEHOLD_FIXTURE) && existsSync(PERSONAL_FIXTURE);

function readFixture(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe.skipIf(!fixturesAvailable)(
  "Bridge-Contract (Consumer) gegen Parent-Fixtures",
  () => {
    it("parst die vollständige Household-Fixture", () => {
      const parsed = finanzCockpitSummarySchema.safeParse(
        readFixture(HOUSEHOLD_FIXTURE),
      );
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.household).toBeDefined();
        expect(parsed.data.accounts?.some((a) => a.scope === "household")).toBe(
          true,
        );
        expect(parsed.data.positions?.length).toBeGreaterThan(0);
      }
    });

    it("parst die personal-only-Fixture abwärtskompatibel (ohne household/accounts/positions)", () => {
      const parsed = finanzCockpitSummarySchema.safeParse(
        readFixture(PERSONAL_FIXTURE),
      );
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.household).toBeUndefined();
        expect(parsed.data.accounts).toBeUndefined();
      }
    });

    it("lehnt die Fixture ab, wenn ein Pflichtfeld entfernt wird", () => {
      const broken = readFixture(PERSONAL_FIXTURE);
      delete broken.fetchedAt;
      expect(finanzCockpitSummarySchema.safeParse(broken).success).toBe(false);
    });

    it("lehnt Float-Cent-Beträge in der Fixture ab", () => {
      const broken = readFixture(HOUSEHOLD_FIXTURE);
      (broken.household as Record<string, unknown>).balanceCents = 100.5;
      expect(finanzCockpitSummarySchema.safeParse(broken).success).toBe(false);
    });
  },
);
