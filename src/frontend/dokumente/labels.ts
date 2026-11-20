import type { DocumentType, TaxCategory } from "@/domain/documents/documents";
import { TAX_BUCKET_LABELS } from "@/domain/tax/labels";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: "Rechnung",
  bauspar_statement: "Bauspar-Auszug",
  loan_statement: "Darlehens-Auszug",
  contract: "Vertrag",
  tax_notice: "Steuerbescheid",
  other: "Sonstiges",
};

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  handwerker_35a: TAX_BUCKET_LABELS.handwerker_35a,
  haushaltsnahe_dl_35a: TAX_BUCKET_LABELS.haushaltsnahe_dl_35a,
  werbungskosten_vv: TAX_BUCKET_LABELS.werbungskosten_vv,
  capital_gains: TAX_BUCKET_LABELS.capital_gains,
  other: TAX_BUCKET_LABELS.other,
};

export const DOCUMENT_TYPE_OPTIONS: readonly DocumentType[] = [
  "invoice",
  "loan_statement",
  "bauspar_statement",
  "contract",
  "tax_notice",
  "other",
] as const;
