import { PROPERTY_VS_ETF_TAX_DEFAULTS } from "../property-vs-etf-defaults";
import type { PropertyVsEtfTaxInput } from "../property-vs-etf-tax";

/**
 * Steuer-Defaults mit dem Verhalten von Slice 25d: keine Verkaufskosten
 * (Makler 0 %, Sonstiges 0 %) und Rücklage-Abzug im Jahr der Zahlung.
 * Basis für alle bestehenden Handrechnungen, deren Erwartungswerte unverändert bleiben.
 */
export const TAX_25D: PropertyVsEtfTaxInput = {
  ...PROPERTY_VS_ETF_TAX_DEFAULTS,
  brokerFeeBps: 0,
  otherSaleCostsBps: 0,
  reserveDeductionLagYears: 0,
};
