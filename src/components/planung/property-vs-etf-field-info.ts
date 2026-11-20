import type {
  NumericFieldKey,
  TaxNumericFieldKey,
} from "./property-vs-etf-state";

export type FieldInfoKey =
  | NumericFieldKey
  | TaxNumericFieldKey
  | "equityCents"
  | "taxesEnabled"
  | "reinvestSurplus";

/**
 * Kurze Erklärtexte zu allen Eingaben des Dialogs. Bewusst ohne Standardwerte
 * (die zeigen die Felder selbst); feste Rechtsfakten sind die Ausnahme.
 */
export const PROPERTY_VS_ETF_FIELD_INFO = {
  purchasePriceCents:
    "Preis laut Inserat ohne Nebenkosten. Wird zu 100 % finanziert, soweit das Eigenkapital nicht mehr abdeckt.",
  livingAreaCentiSqm:
    "Wohnfläche laut Inserat in qm. Ergibt mit der Kaltmiete pro qm die Startmiete.",
  coldRentPerSqmCents:
    "Erzielbare Nettokaltmiete je qm zum Start, ohne umlagefähige Nebenkosten.",
  purchaseCostsBps:
    "Grunderwerbsteuer, Notar, Grundbuch und ggf. Makler beim Kauf, in % vom Kaufpreis. Werden aus dem Eigenkapital bezahlt.",
  equityCents:
    "Eigenes Geld beim Kauf. Mindestens die Nebenkosten, mehr verringert das Darlehen. Derselbe Betrag ist der Startwert des ETF.",
  interestRateBps:
    "Sollzins p. a., bleibt über den ganzen Horizont konstant (keine Anschlussfinanzierung).",
  initialRepaymentBps:
    "Tilgung im ersten Jahr in % vom Darlehen. Zins plus Tilgung ergeben die konstante Monatsrate.",
  rentGrowthBps: "Jährliche Steigerung der Kaltmiete, erstmals ab Jahr 2.",
  valueGrowthBps:
    "Jährliche Wertveränderung der Immobilie. Bestimmt den Verkaufswert und die Höhe der Rücklage.",
  costGrowthBps:
    "Jährliche Steigerung der nicht umlagefähigen WEG-Kosten, wirkt nur auf diese.",
  vacancyBps:
    "Anteil der Kaltmiete, der durch Leerstand oder Zahlungsausfall fehlt.",
  monthlyHoaCostsCents:
    "Monatliche Hausgeld-Anteile, die nicht auf den Mieter umgelegt werden können (z. B. Verwaltung, Kontoführung).",
  maintenanceReserveBps:
    "Jährliche Rücklage in % vom jeweiligen Immobilienwert. Mindert den Cashflow sofort, steuerlich erst bei Verwendung.",
  etfAnnualReturnBps:
    "Erwartete Rendite p. a. vor Steuern, monatlich verzinst. Gilt für den Vergleichs-ETF und das Überschuss-Depot.",
  horizonYears:
    "Nach so vielen Jahren wird verglichen. Jedes Chart-Jahr zeigt einen Verkauf in diesem Jahr.",
  reinvestSurplus:
    "An: Monatliche Überschüsse der Immobilie fließen in ein eigenes ETF-Depot und verzinsen sich. Aus: Sie sammeln sich zinslos an.",
  taxesEnabled:
    "Aus: Einkommen-, Spekulations- und ETF-Steuer entfallen. Verkaufskosten wirken weiter.",
  marginalTaxRateBps:
    "Persönlicher Steuersatz auf zusätzliches Einkommen inkl. Soli (ggf. KiSt). Gilt für Mieteinkünfte und den Spekulationsgewinn.",
  depreciationRateBps:
    "Lineare Abschreibung des Gebäudeanteils pro Jahr. Mindert die Steuer, erhöht aber den Spekulationsgewinn.",
  buildingShareBps:
    "Anteil von Kaufpreis und Nebenkosten, der auf das Gebäude entfällt. Nur dieser Teil wird abgeschrieben, der Boden nicht.",
  speculationPeriodYears:
    "Bei einem Verkauf bis zu diesem Jahr wird der Gewinn mit dem Grenzsteuersatz versteuert, danach ist er steuerfrei.",
  reserveDeductionLagYears:
    "Zahlungen in die Rücklage sind erst absetzbar, wenn das Geld für Erhaltung ausgegeben wird. Das Modell setzt jede Zahlung nach so vielen Jahren ab. 0 = sofort.",
  churchTaxBps: "Kirchensteuersatz auf die Kapitalertragsteuer des ETF.",
  partialExemptionBps:
    "Steuerfreier Anteil der ETF-Gewinne, bei Aktien-ETF 30 %.",
  saverAllowanceCents:
    "Steuerfreie Kapitalerträge pro Jahr. Hier einmal beim fiktiven Verkauf angesetzt, je Szenario getrennt.",
  brokerFeeBps:
    "Anteil des Verkäufers an der Maklerprovision. Üblich ist die Halbteilung nach § 656c BGB, 3 % zzgl. 19 % USt. 0 % = Verkauf ohne Makler.",
  otherSaleCostsBps:
    "Löschung der Grundschuld, Energieausweis, Unterlagen. Mindern Verkaufserlös und Spekulationsgewinn.",
} as const satisfies Record<FieldInfoKey, string>;
