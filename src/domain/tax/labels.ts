import type { TaxDocumentIssue, TaxBucket } from "./summary";

export const TAX_BUCKET_LABELS: Record<TaxBucket, string> = {
  handwerker_35a: "Handwerkerleistung (§ 35a)",
  haushaltsnahe_dl_35a: "Haushaltsnahe Dienstleistung (§ 35a)",
  werbungskosten_vv: "Werbungskosten (V+V)",
  capital_gains: "Kapitalerträge",
  other: "Sonstiges",
  unassigned: "Nicht zugeordnet",
};

export const TAX_BUCKET_HINTS: Record<TaxBucket, string | null> = {
  handwerker_35a:
    "Nur Arbeits-, Fahrt- und Maschinenkosten inkl. USt, unbare Zahlung; der Höchstbetrag gilt je Haushalt.",
  haushaltsnahe_dl_35a:
    "Nur Arbeits-, Fahrt- und Maschinenkosten inkl. USt, unbare Zahlung; der Höchstbetrag gilt je Haushalt.",
  werbungskosten_vv: "Nur für vermietete Objekte relevant.",
  capital_gains:
    "Informativ: Erfasste Beträge, keine Berechnung (Sparerpauschbetrag beachten).",
  other: null,
  unassigned: "Diesen Belegen fehlt die Steuer-Kategorie.",
};

export const TAX_ISSUE_LABELS: Record<TaxDocumentIssue, string> = {
  missing_category: "Kategorie fehlt",
  missing_deductible: "Absetzbarer Betrag fehlt",
  missing_labor_share: "Lohnanteil fehlt",
  missing_total: "Betrag fehlt",
  deductible_exceeds_total: "Absetzbar > Gesamt",
};

export const TAX_DISCLAIMER =
  "Unverbindliche Orientierung auf Basis der erfassten Belege – keine Steuerberatung.";
