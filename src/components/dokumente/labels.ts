import type { DocumentType, TaxCategory } from "@/lib/domain/documents";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: "Rechnung",
  bauspar_statement: "Bauspar-Auszug",
  loan_statement: "Darlehens-Auszug",
  contract: "Vertrag",
  tax_notice: "Steuerbescheid",
  other: "Sonstiges",
};

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  handwerker_35a: "Handwerkerleistung (§ 35a)",
  haushaltsnahe_dl_35a: "Haushaltsnahe Dienstleistung (§ 35a)",
  werbungskosten_vv: "Werbungskosten (V+V)",
  capital_gains: "Kapitalerträge",
  other: "Sonstiges",
};

export const DOCUMENT_TYPE_OPTIONS: readonly DocumentType[] = [
  "invoice",
  "loan_statement",
  "bauspar_statement",
  "contract",
  "tax_notice",
  "other",
] as const;
