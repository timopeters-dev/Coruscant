import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectHouseholdHoldings } from "@/lib/domain/household-scope";
import type { ExternalScope } from "@/lib/domain/pot-sync";

const HOUSEHOLD_FIXTURE = path.resolve(
  process.cwd(),
  "../docs/fixtures/external-summary.household.json",
);

describe.skipIf(!existsSync(HOUSEHOLD_FIXTURE))(
  "selectHouseholdHoldings gegen die Bridge-Fixture",
  () => {
    it("liefert nur die Haushalts-Konten der Fixture und deren Positionen", () => {
      const fixture = JSON.parse(readFileSync(HOUSEHOLD_FIXTURE, "utf8")) as {
        accounts?: Array<{ id: string; scope: ExternalScope }>;
        positions?: Array<{ id: string; accountId: string }>;
      };
      const accounts = fixture.accounts ?? [];
      const result = selectHouseholdHoldings(accounts, fixture.positions ?? []);
      expect(result.accounts.map((a) => a.id)).toEqual(
        accounts.filter((a) => a.scope === "household").map((a) => a.id),
      );
      const ids = new Set(result.accounts.map((a) => a.id));
      expect(result.positions.every((p) => ids.has(p.accountId))).toBe(true);
    });
  },
);
