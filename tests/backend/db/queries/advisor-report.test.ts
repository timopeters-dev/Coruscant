import { describe, expect, it } from "vitest";
import { withTempDatabase } from "@tests/helpers/temp-db";
import * as dbModule from "@/backend/db/connection";
import { createPot } from "@/backend/db/queries/pots";
import {
  loadAdvisorReport,
  loadAdvisorReportOutline,
  loadAdvisorSensitiveStrings,
} from "@/backend/db/queries/advisor-report";
import { createContract } from "@/backend/db/queries/contracts";
import { createProperty } from "@/backend/db/queries/properties";
import { potCreateSchema } from "@/validation/allocation";
import { contractCreateSchema } from "@/validation/contracts";


const ALL_TABLES = [
  "app_meta",
  "properties",
  "financial_contracts",
  "cashflow_items",
  "pots",
  "pot_allocations",
  "documents",
  "external_snapshots",
  "property_valuation_history",
  "valuation_provider_quota",
  "balance_snapshots",
] as const;

function readTableCounts(): Record<string, number> {
  const sqlite = dbModule.getSqlite();
  const counts: Record<string, number> = {};
  for (const table of ALL_TABLES) {
    const row = sqlite
      .prepare(`SELECT COUNT(*) as c FROM ${table}`)
      .get() as { c: number };
    counts[table] = row.c;
  }
  return counts;
}



withTempDatabase();

describe("advisor-report DB queries", () => {
  it("loads anonymized view without trap PII strings, retains them in full mode, and never mutates the DB", () => {
    const prop = createProperty({
      name: "Musterstraße 1, 12345 Musterstadt",
      usage: "owner_occupied",
      estimatedValueCents: 35_000_000,
    });

    createContract(
      contractCreateSchema.parse({
        name: "Darlehen Erika Musterfrau Nr. 1234567890",
        provider: "Musterbank AG",
        category: "loan",
        status: "active",
        currentBalanceCents: 20_000_000,
        balanceAsOfDate: "2026-09-01",
        monthlyRateCents: 100_000,
        interestRateBps: 350,
        repaymentType: "annuity",
        linkedPropertyId: prop.id,
        milestoneDate: "2028-06-15",
        milestoneLabel: "Zuteilung DE89 3704 0044 0532 0130 00",
      }),
    );

    createPot(
      potCreateSchema.parse({
        name: "Urlaub max.mustermann@example.org",
        currentCents: 300_000,
        targetCents: 500_000,
        ruleType: "fill_to_target",
      }),
    );

    const beforeCounts = readTableCounts();

    const anonResult = loadAdvisorReport({
      mode: "anonymized",
      asOfDate: "2026-11-19",
      now: new Date("2026-11-19T10:00:00.000Z"),
    });

    const anonJson = JSON.stringify(anonResult.view).toLowerCase();
    for (const trap of [
      "erika",
      "musterfrau",
      "mustermann",
      "musterbank",
      "musterstraße",
      "musterstadt",
      "1234567890",
      "de89",
      "@example.org",
      prop.id,
    ]) {
      expect(anonJson).not.toContain(trap);
    }

    const fullResult = loadAdvisorReport({
      mode: "full",
      asOfDate: "2026-11-19",
      now: new Date("2026-11-19T10:00:00.000Z"),
    });
    const fullJson = JSON.stringify(fullResult.view);
    expect(fullJson).toContain("Musterbank AG");
    expect(fullJson).toContain("Musterstraße 1, 12345 Musterstadt");

    const outline = loadAdvisorReportOutline("2026-11-19");
    expect(outline.find((s) => s.sectionId === "contracts")?.count).toBe(1);
    expect(outline.find((s) => s.sectionId === "properties")?.count).toBe(1);
    expect(outline.find((s) => s.sectionId === "pots")?.count).toBe(1);

    const sensitive = loadAdvisorSensitiveStrings();
    expect(sensitive).toContain("musterbank ag");

    const afterCounts = readTableCounts();
    expect(afterCounts).toEqual(beforeCounts);
  });
});
