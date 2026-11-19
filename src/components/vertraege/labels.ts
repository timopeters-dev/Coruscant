import type { AmortizationMarkerKind } from "@/lib/domain/contract-series";
import type { AutoValuationInterval } from "@/lib/domain/auto-valuation-schedule";
import type {
  ContractCategory,
  ContractStatus,
  RepaymentType,
} from "@/lib/domain/contracts";
import type { PropertyUsage } from "@/lib/domain/properties";
import type { RenovationKind } from "@/lib/domain/property-renovations";
import type { PropertyType } from "@/lib/domain/property-types";
import type {
  ValuationConfidence,
  ValuationRejectReason,
} from "@/lib/domain/property-valuation";
import type { ValuationAdjustmentErrorCode } from "@/lib/domain/property-valuation-adjustments";
import type { ValuatorErrorCode } from "@/lib/integrations/property-valuator";
import {
  PROPERTY_ENERGY_CLASSES,
  type PropertyEnergyClass,
} from "@/lib/validation/contracts";

export const PROPERTY_ENERGY_CLASS_OPTIONS: readonly PropertyEnergyClass[] =
  PROPERTY_ENERGY_CLASSES;

export const PROPERTY_USAGE_LABELS: Record<PropertyUsage, string> = {
  owner_occupied: "Eigennutzung",
  rented: "Vermietet",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  active: "Aktiv",
  paused: "Pausiert",
  closed: "Beendet",
};

export const REPAYMENT_TYPE_LABELS: Record<RepaymentType, string> = {
  annuity: "Annuitätendarlehen",
  installment: "Ratendarlehen",
  lump_sum: "Endfällig (z. B. Verwandtendarlehen)",
};

export function getContractTypeLabel(
  category: ContractCategory,
  repaymentType?: RepaymentType | null,
): string {
  if (category === "savings_contract") {
    return "Bausparvertrag";
  }
  if (repaymentType && repaymentType in REPAYMENT_TYPE_LABELS) {
    return REPAYMENT_TYPE_LABELS[repaymentType];
  }
  return "Kredit";
}

export const RENOVATION_KIND_LABELS: Record<RenovationKind, string> = {
  roof: "Dach",
  windows: "Fenster",
  heating: "Heizung",
  facade: "Fassade",
  insulation: "Dämmung",
  bathroom: "Bad",
  kitchen: "Küche",
  electrical: "Elektrik",
  plumbing: "Sanitär / Leitungen",
  full: "Kernsanierung",
};

export const VALUATION_CONFIDENCE_LABELS: Record<ValuationConfidence, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
};

export const VALUATION_REJECT_REASON_LABELS: Record<
  ValuationRejectReason,
  string
> = {
  not_reliably_valuable:
    "Objekt ist derzeit nicht zuverlässig automatisch bewertbar.",
  non_positive: "Ungültige Schätzwerte erhalten.",
  bounds_order: "Widersprüchliche Wertspanne erhalten.",
  price_per_sqm_out_of_range:
    "Quadratmeterpreis außerhalb des plausiblen Bereichs.",
  spread_too_wide: "Spanne zu unsicher.",
  as_of_in_future: "Stand-Datum der Marktdaten liegt in der Zukunft.",
  as_of_too_old: "Marktdaten sind älter als 24 Monate.",
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  etw: "Eigentumswohnung",
  efh: "Einfamilienhaus",
  dhh: "Doppelhaushälfte",
  rh: "Reihenmittelhaus",
  reh: "Reihenendhaus",
  mfh: "Mehrfamilienhaus",
  bungalow: "Bungalow",
  villa: "Villa",
  sonstiges: "Sonstiges",
};

export const AUTO_VALUATION_INTERVAL_LABELS: Record<
  AutoValuationInterval,
  string
> = {
  off: "Aus",
  weekly: "Wöchentlich",
  biweekly: "14-tägig",
  monthly: "Monatlich",
  quarterly: "Quartalsweise",
};

export const AUTO_VALUATION_OUTCOME_LABELS: Record<
  "written" | "history_only" | "not_valuable" | "rejected" | "error",
  string
> = {
  written: "Wert aktualisiert",
  history_only: "Als Vorschlag gespeichert",
  not_valuable: "Nicht bewertbar",
  rejected: "Plausibilität abgelehnt",
  error: "Fehler beim Abruf",
};

export const VALUATION_ERROR_CODE_LABELS: Record<ValuatorErrorCode, string> = {
  not_configured: "ImmoAnalyse.Pro ist nicht konfiguriert (IMMOANALYSE_API_KEY fehlt).",
  unauthorized: "ImmoAnalyse API-Key wurde abgelehnt (401).",
  quota_exceeded: "Monatliches Kontingent erschöpft (402).",
  rate_limited: "Zu viele Anfragen in kurzer Zeit (429). Bitte kurz warten.",
  not_valuable: "Objekt konnte von ImmoAnalyse.Pro nicht bewertet werden.",
  invalid_request: "Anfrage wurde vom Dienst als ungültig abgelehnt.",
  timeout: "Zeitüberschreitung beim Warten auf ImmoAnalyse.Pro.",
  http_error: "ImmoAnalyse.Pro meldet einen Serverfehler.",
  network_error: "ImmoAnalyse.Pro ist derzeit nicht erreichbar.",
  invalid_payload: "Antwort von ImmoAnalyse.Pro war nicht auswertbar.",
};

export const VALUATION_TRIGGER_LABELS: Record<
  "auto" | "manual" | "adjustment",
  string
> = {
  auto: "ImmoAnalyse (Auto)",
  manual: "ImmoAnalyse (Manuell)",
  adjustment: "Eigene Korrektur",
};

export const VALUATION_ADJUSTMENT_ERROR_LABELS: Record<
  ValuationAdjustmentErrorCode,
  string
> = {
  too_many: "Maximal 8 Korrekturposten zulässig.",
  label_empty: "Bezeichnung darf nicht leer sein.",
  label_too_long: "Bezeichnung darf höchstens 60 Zeichen lang sein.",
  label_duplicate: "Bezeichnung darf nicht doppelt vorkommen.",
  bps_not_integer: "Prozentwert muss maximal 2 Nachkommastellen haben.",
  bps_zero: "Posten ohne Wirkung (0 %) entfernen.",
  bps_item_out_of_range: "Einzelner Posten darf höchstens ±50,00 % betragen.",
  total_out_of_range: "Summe der Korrekturen darf höchstens ±50,00 % betragen.",
  catalog_key_unknown: "Unbekannter Katalog-Posten.",
  catalog_key_duplicate: "Katalog-Posten doppelt gewählt.",
  exclusive_conflict: "Schließt sich mit einem anderen gewählten Posten aus.",
};

export const VALUATION_VALUE_CHANGED_LABEL =
  "Wert hat sich zwischenzeitlich geändert, neu geladen.";

export const AMORTIZATION_MARKER_LABELS: Record<AmortizationMarkerKind, string> = {
  today: "Heute",
  fixed_interest_end: "Zinsbindungsende",
  milestone: "Meilenstein",
  paid_off: "Schuldenfrei",
  allocation_threshold: "Zuteilungsschwelle",
  target_reached: "Zielsumme erreicht",
  special_repayment: "Sondertilgung",
};

export function formatMonthYearDE(isoDate: string): string {
  const [year, month] = isoDate.split("-");
  if (!year || !month) return isoDate;
  return `${month}/${year}`;
}

export function formatDurationMonthsDE(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0) {
    return `${months} ${months === 1 ? "Monat" : "Monate"}`;
  }
  if (months === 0) {
    return `${years} ${years === 1 ? "Jahr" : "Jahre"}`;
  }
  return `${years} ${years === 1 ? "Jahr" : "Jahre"} ${months} ${months === 1 ? "Monat" : "Monate"}`;
}
