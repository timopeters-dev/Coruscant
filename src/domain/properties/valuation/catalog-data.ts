import type { PropertyType } from "@/domain/properties/types";

export const VALUATION_CATALOG_VERSION = 1;

export type ValuationCatalogGroupId =
  | "location"
  | "construction"
  | "condition"
  | "features"
  | "legal";

export interface ValuationCatalogItem {
  key: string;
  group: ValuationCatalogGroupId;
  label: string;
  suggestedBps: number;
  hint: string;
  exclusiveGroup?: string;
  appliesTo?: readonly PropertyType[];
}

export const VALUATION_CATALOG_GROUPS: readonly {
  id: ValuationCatalogGroupId;
  label: string;
  hint: string;
}[] = [
  {
    id: "location",
    label: "Lage",
    hint: "Der Bewertungsdienst kennt nur PLZ und Ort.",
  },
  {
    id: "construction",
    label: "Bauweise & Grundriss",
    hint: "Konstruktive Merkmale und Raumaufteilung.",
  },
  {
    id: "condition",
    label: "Zustand & Sanierung",
    hint: "Der Bewertungsdienst kennt nur Baujahr und Energieklasse.",
  },
  {
    id: "features",
    label: "Ausstattung",
    hint: "Wohnwertsteigernde oder fehlende Ausstattungsmerkmale.",
  },
  {
    id: "legal",
    label: "Recht & Sonstiges",
    hint: "Rechtliche Besonderheiten am Grundstück oder Gebäude.",
  },
];

export const VALUATION_ADJUSTMENT_CATALOG: readonly ValuationCatalogItem[] = [
  {
    key: "location_quiet",
    group: "location",
    label: "Ruhige Lage / Seitenstraße",
    suggestedBps: 300,
    exclusiveGroup: "noise",
    hint: "Kein Durchgangsverkehr oder ruhige Anliegerstraße.",
  },
  {
    key: "location_noise",
    group: "location",
    label: "Lärmbelastung (Straße, Bahn, Flug)",
    suggestedBps: -700,
    exclusiveGroup: "noise",
    hint: "Dauerhafte Lärmquelle in Wohnräumen hörbar.",
  },
  {
    key: "location_view",
    group: "location",
    label: "Besondere Aussicht / Wasser- oder Parknähe",
    suggestedBps: 500,
    hint: "Unverbauter Blick, Wasser- oder direkte Parklage.",
  },
  {
    key: "location_poor_access",
    group: "location",
    label: "Schlechte Anbindung (ÖPNV, Einkauf)",
    suggestedBps: -400,
    hint: "Eingeschränkte Erreichbarkeit von Nahversorgung und Nahverkehr.",
  },
  {
    key: "construction_prefab",
    group: "construction",
    label: "Fertighaus (Holzständerbauweise)",
    suggestedBps: -1000,
    hint: "Gilt für Holzständerbauweise, nicht für Massiv-Fertighäuser.",
  },
  {
    key: "floorplan_poor",
    group: "construction",
    label: "Ungünstiger Grundriss",
    suggestedBps: -500,
    hint: "Zum Beispiel gefangene Räume oder reine Durchgangszimmer.",
  },
  {
    key: "basement_full",
    group: "construction",
    label: "Vollkeller",
    suggestedBps: 300,
    exclusiveGroup: "basement",
    hint: "Vollständig unterkellertes Gebäude mit Nutzfläche.",
  },
  {
    key: "basement_none",
    group: "construction",
    label: "Kein Keller",
    suggestedBps: -300,
    exclusiveGroup: "basement",
    hint: "Gebäude ohne Unterkellerung.",
  },
  {
    key: "condition_modernized",
    group: "condition",
    label: "Kürzlich umfassend modernisiert",
    suggestedBps: 500,
    exclusiveGroup: "condition",
    hint: "Werthaltige Modernisierung innerhalb der letzten ca. 10 Jahre.",
  },
  {
    key: "condition_cosmetic",
    group: "condition",
    label: "Kosmetischer Renovierungsbedarf",
    suggestedBps: -500,
    exclusiveGroup: "condition",
    hint: "Optischer Bedarf bei Böden, Wänden oder Bädern.",
  },
  {
    key: "condition_backlog",
    group: "condition",
    label: "Sanierungsstau (Dach, Fenster, Heizung)",
    suggestedBps: -1500,
    exclusiveGroup: "condition",
    hint: "Substanzrelevanter Instandhaltungsrückstau an Bauteilen.",
  },
  {
    key: "features_premium",
    group: "features",
    label: "Hochwertige Ausstattung",
    suggestedBps: 500,
    exclusiveGroup: "equipment",
    hint: "Überdurchschnittliche Materialien und Einbauten.",
  },
  {
    key: "features_basic",
    group: "features",
    label: "Einfache Ausstattung",
    suggestedBps: -500,
    exclusiveGroup: "equipment",
    hint: "Schlichter Standard bei Sanitär, Böden und Küche.",
  },
  {
    key: "features_balcony",
    group: "features",
    label: "Balkon / Terrasse / Loggia",
    suggestedBps: 300,
    exclusiveGroup: "balcony",
    hint: "Nutzbarer privater Außenbereich vorhanden.",
  },
  {
    key: "features_no_balcony",
    group: "features",
    label: "Kein Balkon",
    suggestedBps: -300,
    exclusiveGroup: "balcony",
    appliesTo: ["etw"],
    hint: "Eigentumswohnung ohne Balkon, Terrasse oder Loggia.",
  },
  {
    key: "features_parking",
    group: "features",
    label: "Garage / Stellplatz",
    suggestedBps: 300,
    hint: "Zugehöriger Pkw-Stellplatz oder Garage.",
  },
  {
    key: "legal_leasehold",
    group: "legal",
    label: "Erbbaurecht",
    suggestedBps: -1500,
    hint: "Abschlag hängt stark von Restlaufzeit und Erbbauzins ab.",
  },
  {
    key: "legal_monument",
    group: "legal",
    label: "Denkmalschutz",
    suggestedBps: -500,
    hint: "Erhöhte Auflagen; mögliche Steuervorteile können ausgleichen.",
  },
  {
    key: "legal_easement",
    group: "legal",
    label: "Wegerecht / Baulast",
    suggestedBps: -300,
    hint: "Eingetragene Belastungen oder Nutzungsrechte Dritter.",
  },
];

const CATALOG_BY_KEY = new Map<string, ValuationCatalogItem>(
  VALUATION_ADJUSTMENT_CATALOG.map((item) => [item.key, item]),
);

export function getCatalogItem(key: string): ValuationCatalogItem | null {
  return CATALOG_BY_KEY.get(key) ?? null;
}
