import { aiDocumentExtractionSchema } from "@/validation/documents";
import type {
  DocumentExtractionContext,
  DocumentExtractionResult,
  DocumentExtractor,
} from "./document-extractor";
import { createGeminiJsonClient } from "./gemini-transport";

export {
  DEFAULT_GEMINI_FALLBACK_MODEL,
  DEFAULT_GEMINI_MODEL,
  getGeminiConfig,
  type GeminiConfig,
} from "./gemini-transport";

export interface GeminiDocumentExtractorOptions {
  apiKey?: string;
  model?: string;
  fallbackModels?: string[];
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

const EXTRACTION_PROMPT = [
  "Analysiere das angehängte deutsche Finanz-/Haushaltsdokument (PDF) und extrahiere strukturierte Metadaten als JSON.",
  "Antworte ausschließlich mit einem JSON-Objekt mit genau diesen Feldern:",
  "- documentType: eines von 'invoice', 'bauspar_statement', 'loan_statement', 'contract', 'tax_notice', 'other'",
  "- documentDate: Beleg-/Stichtagsdatum als 'YYYY-MM-DD' oder null",
  "- issuer: Name des Ausstellers / der Bank / des Betriebs oder null",
  "- totalAmountCents: Gesamtbetrag als nicht-negative Ganzzahl in Cent (z.B. 123,45 € -> 12345) oder null. Niemals Dezimalzahlen!",
  "- isTaxRelevant: boolean (true bei Handwerkerrechnung, haushaltsnaher Dienstleistung, Werbungskosten V+V, Steuerbescheid, Kapitalerträgen)",
  "- taxYear: vierstellige Jahreszahl (Integer) oder null",
  "- taxCategory: eines von 'handwerker_35a', 'haushaltsnahe_dl_35a', 'werbungskosten_vv', 'capital_gains', 'other' oder null",
  "- deductibleAmountCents: absetzbarer Betrag / Lohnanteil (z.B. bei § 35a) als nicht-negative Ganzzahl in Cent (<= totalAmountCents) oder null",
  "- detectedBalanceCents: erkannter aktueller Darlehens-, Konto- oder Bauspar-Saldo als Ganzzahl in Cent oder null. Nur ein Bauspar-Saldo darf negativ sein (z.B. nach Abbuchung der Abschlussgebühr: -1.200,00 € -> -120000); Darlehens- und Kontosalden nicht-negativ",
  "- extractedContract: falls es sich um einen Kredit-/Darlehensvertrag oder Bausparvertrag (inkl. Konditionenübersicht / Jahreskontoauszug) handelt, ein Objekt mit folgenden Feldern, sonst null:",
  "  - name: aussagekräftiger Vertragsname (z.B. 'Hauskredit Musterbank' oder 'Bausparvertrag Tarif Klassik') oder null",
  "  - provider: Bank / Bausparkasse / Gläubiger oder null",
  "  - category: 'loan' (Kredit/Darlehen) oder 'savings_contract' (Bausparvertrag) oder null",
  "  - currentBalanceCents: aktueller Saldo / Darlehensbetrag / Restschuld bzw. Bauspar-Guthaben als Ganzzahl in Cent (z.B. 295.000,00 € -> 29500000, 1.400,00 € -> 140000) oder null. Bei Bausparverträgen negativ, wenn das Guthaben durch die Abschlussgebühr im Minus ist (z.B. -1.200,00 € -> -120000); bei Krediten immer nicht-negativ. Niemals Dezimalzahlen!",
  "  - balanceAsOfDate: Stichtag des Saldos bzw. Auszahlungs-/Vertragsdatum als 'YYYY-MM-DD' oder null",
  "  - monthlyRateCents: monatliche Rate / Sparrate als nicht-negative Ganzzahl in Cent (z.B. 1.400,00 € -> 140000) oder null",
  "  - interestRateBps: Sollzinssatz / Guthabenzins als nicht-negative Ganzzahl in Basispunkten (1 % = 100 bps, z.B. 3,45 % -> 345, 0,50 % -> 50, 4,0 % -> 400) oder null",
  "  - repaymentType: für Kredite eines von 'annuity', 'installment', 'lump_sum', sonst null",
  "  - originalPrincipalCents: ursprünglicher Darlehensnennbetrag / Nettodarlehensbetrag als positive Ganzzahl in Cent oder null",
  "  - specialRepaymentRight: Sondertilgungsrecht: 'allowed' (Sondertilgung vereinbart), 'none' (NUR wenn das Dokument Sondertilgungen ausdrücklich ausschließt), sonst null (nicht erwähnt)",
  "  - specialRepaymentBasis: Art des Sondertilgungsdeckels: 'fixed_yearly' (fester €-Betrag/Jahr), 'percent_original' (% vom Ursprungsbetrag/Nennbetrag), 'percent_balance' (% der Restschuld) oder null",
  "  - specialRepaymentMaxYearlyCents: maximale jährliche Sondertilgung in Cent (Ganzzahl) bei festem €-Betrag oder null",
  "  - specialRepaymentPercentBps: jährlicher Sondertilgungs-Prozentsatz in Basispunkten (5 % -> 500, Ganzzahl 1..10000) oder null",
  "  - rateChangeRight: Tilgungssatzwechsel-Recht: 'allowed' (vereinbart), 'none' (NUR bei ausdrücklichem Ausschluss), sonst null",
  "  - rateChangeTotalCount: Anzahl erlaubter Tilgungssatzwechsel (Ganzzahl 1..50) oder null",
  "  - rateChangeScope: Bezug der erlaubten Wechsel: 'term' (Gesamtlaufzeit), 'fixed_period' (je Zinsbindung), 'per_year' (pro Jahr) oder null",
  "  - rateChangeMinRepaymentBps: minimaler Tilgungssatz im Korridor in Basispunkten (1 % -> 100, Ganzzahl 0..10000) oder null",
  "  - rateChangeMaxRepaymentBps: maximaler Tilgungssatz im Korridor in Basispunkten (5 % -> 500, Ganzzahl 0..10000) oder null",
  "  - rateChangeMinMonthlyCents: minimale monatliche Rate im Korridor in Cent (Ganzzahl >= 0) oder null",
  "  - rateChangeMaxMonthlyCents: maximale monatliche Rate im Korridor in Cent (Ganzzahl >= 0) oder null",
  "  - fixedInterestUntil: Ende der Zinsbindung als 'YYYY-MM-DD' oder null",
  "  - targetSumCents: bei Bausparverträgen die Bausparsumme in Cent (Ganzzahl) oder null",
  "  - allocationThresholdPercent: bei Bausparverträgen die Zuteilungsschwelle als ganze Zahl 0..100 (z.B. 40 % -> 40) oder null",
  "  - futureLoanInterestRateBps: bei Bausparverträgen der spätere Darlehenszins in Basispunkten (z.B. 2,50 % -> 250) oder null",
  "  - milestoneDate: wichtiges Zieldatum (z.B. geplante Zuteilung / Rückzahlung) als 'YYYY-MM-DD' oder null",
  "  - milestoneLabel: kurze Beschreibung des Meilensteins oder null",
  "Hinweis zu mehrseitigen Verträgen: Werte gezielt die Konditionenübersicht, den Darlehensvertrag-Kopf, Abschnitte wie 'Sondertilgungsrecht', 'Tilgungssatzwechsel', 'Tilgungsänderung' sowie das ESIS-Merkblatt (insbesondere Abschnitt 'Vorzeitige Rückzahlung') bzw. bei Bausparverträgen die Tarif-/Vertragsdaten-Übersicht aus.",
  "Alle Geldbeträge strikt als Ganzzahl in Cent und Zinssätze als Ganzzahl in Basispunkten angeben; nicht erkennbare Werte und Unterfelder strikt auf null setzen.",
].join("\n");

export function createGeminiDocumentExtractor(
  options: GeminiDocumentExtractorOptions = {},
): DocumentExtractor {
  const client = createGeminiJsonClient({
    ...options,
    operationLabel: "KI-Dokumentenanalyse",
  });

  return {
    async extract(
      ctx: DocumentExtractionContext,
    ): Promise<DocumentExtractionResult> {
      const result = await client.generateJson({
        contents: [
          {
            parts: [
              {
                text: `${EXTRACTION_PROMPT}\n\nDateiname: ${ctx.filename}`,
              },
              {
                inline_data: {
                  mime_type: ctx.mimeType,
                  data: ctx.pdfBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      if (!result.ok) {
        return result;
      }

      const validated = aiDocumentExtractionSchema.safeParse(result.json);
      if (!validated.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "KI-Output erfüllt das erwartete Schema nicht.",
        };
      }

      return { ok: true, data: validated.data, model: result.model };
    },
  };
}

export function createDefaultDocumentExtractor(): DocumentExtractor {
  return createGeminiDocumentExtractor();
}
