import type {
  ContractCategory,
  ContractSphere,
  ContractStatus,
  RepaymentType,
} from "@/lib/domain/contracts";
import type { PropertyUsage } from "@/lib/domain/properties";
import type { RenovationKind } from "@/lib/domain/property-renovations";
import type {
  ValuationConfidence,
  ValuationRejectReason,
} from "@/lib/domain/property-valuation";
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

export const CONTRACT_SPHERE_LABELS: Record<ContractSphere, string> = {
  household: "Haushalt",
  personal: "Privat",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  active: "Aktiv",
  paused: "Pausiert",
  closed: "Beendet",
};

export const REPAYMENT_TYPE_LABELS: Record<RepaymentType, string> = {
  annuity: "Annuitätendarlehen",
  installment: "Ratendarlehen",
  lump_sum: "Endfällig / Privatdarlehen",
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
  ungrounded: "Keine belegbaren Quellen gefunden. Kein Vorschlag.",
  non_positive: "Ungültige Schätzwerte erhalten.",
  bounds_order: "Widersprüchliche Wertspanne erhalten.",
  price_per_sqm_out_of_range:
    "Quadratmeterpreis außerhalb des plausiblen Bereichs.",
  spread_too_wide: "Spanne zu unsicher.",
  as_of_in_future: "Stand-Datum der Marktdaten liegt in der Zukunft.",
  as_of_too_old: "Marktdaten sind älter als 24 Monate.",
};
