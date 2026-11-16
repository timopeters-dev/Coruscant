import type {
  ContractCategory,
  ContractSphere,
  ContractStatus,
  RepaymentType,
} from "@/lib/domain/contracts";
import type { PropertyUsage } from "@/lib/domain/properties";

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
