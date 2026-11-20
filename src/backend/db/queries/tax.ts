import { asc, eq } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { documents, properties } from "@/backend/db/schema";
import type { DocumentRow } from "./documents";
import {
  listTaxYears,
  summarizeTaxYear,
  type TaxYearSummary,
} from "@/domain/tax/summary";

export function listTaxCandidateDocuments(): DocumentRow[] {
  return getDb()
    .select()
    .from(documents)
    .where(eq(documents.isTaxRelevant, true))
    .orderBy(asc(documents.documentDate), asc(documents.id))
    .all();
}

export interface TaxYearOverview {
  summary: TaxYearSummary;
  availableYears: number[];
  propertyNames: Record<string, string>;
  /** Nur serverseitig für den Export; verlässt den Server nie als JSON. */
  storagePathById: Map<string, string>;
}

export function getTaxYearOverview(taxYear: number): TaxYearOverview {
  const candidates = listTaxCandidateDocuments();
  const summary = summarizeTaxYear(candidates, taxYear);
  const availableYears = listTaxYears(candidates);

  const propertyNames: Record<string, string> = {};
  for (const row of getDb()
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .all()) {
    propertyNames[row.id] = row.name;
  }

  const includedIds = new Set(summary.items.map((item) => item.documentId));
  const storagePathById = new Map<string, string>();
  for (const doc of candidates) {
    if (includedIds.has(doc.id)) storagePathById.set(doc.id, doc.storagePath);
  }

  return { summary, availableYears, propertyNames, storagePathById };
}
