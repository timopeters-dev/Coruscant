import { z } from "zod";
import {
  groundingSourceSchema,
  valuationModelOutputSchema,
} from "@/lib/validation/property-valuation";
import {
  createGeminiJsonClient,
  type GeminiJsonClient,
  type GeminiJsonClientOptions,
} from "./gemini-transport";
import type { PropertyValuator, ValuatorResult } from "./property-valuator";

export const VALUATION_SYSTEM_PROMPT = [
  "Du bist ein sachlicher Immobilienmarkt-Analyst. Du gibst eine unverbindliche Markteinordnung zur Orientierung und erstellst kein Verkehrswertgutachten.",
  "Nutze die Websuche, um aktuelle Angebots- und Vergleichspreise sowie Marktberichte für die angegebene Postleitzahl und Region zu finden.",
  "Stütze dich ausschließlich auf die Fakten aus dem JSON-Kontext (Lage, Wohnfläche, Grundstück, Baujahr, Energieeffizienz, Sanierungen, ggf. Kaltmiete). Erfinde keine weiteren Objektmerkmale.",
  "Gib alle Wertangaben (lowerEur, medianEur, upperEur) als ganze Euro-Beträge (Integer, ohne Cent und ohne Nachkommastellen) an. Wähle eine realistisch enge Wertspanne.",
  "asOfDate ist das Stand-Datum der genutzten Marktdaten im Format JJJJ-MM-TT.",
  "Schreibe KEINE URLs, Links oder Quellenangaben in das JSON.",
  "Antworte ausschließlich mit einem einzelnen gültigen JSON-Objekt ohne Markdown-Codeblock und ohne Begleittext.",
].join("\n");

const VALUATION_SCHEMA_PROMPT = [
  "Antworte mit genau diesen JSON-Feldern:",
  "- lowerEur: ganze Zahl (unterer Schätzwert in Euro)",
  "- medianEur: ganze Zahl (mittlerer Schätzwert in Euro)",
  "- upperEur: ganze Zahl (oberer Schätzwert in Euro)",
  "- asOfDate: String (Stand-Datum der Marktdaten, Format JJJJ-MM-TT)",
  "- rationale: String (kurze, sachliche Begründung auf Deutsch, 1–800 Zeichen)",
  "- factors: Array mit 0–6 Objekten { label: String (1–80 Zeichen), effect: 'up' | 'down' | 'neutral' }",
  "- confidence: 'low' | 'medium' | 'high'",
].join("\n");

const groundingSourcesSchema = z.array(groundingSourceSchema).max(8);

export type GeminiPropertyValuatorOptions = Omit<
  GeminiJsonClientOptions,
  "operationLabel"
>;

export function createGeminiPropertyValuator(
  options: GeminiPropertyValuatorOptions = {},
  client: GeminiJsonClient = createGeminiJsonClient({
    ...options,
    operationLabel: "KI-Wertschätzung",
  }),
): PropertyValuator {
  return {
    async estimate(contextJson: string): Promise<ValuatorResult> {
      const result = await client.generateJson({
        systemInstruction: { parts: [{ text: VALUATION_SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Kontext: ${contextJson}\n\n${VALUATION_SCHEMA_PROMPT}`,
              },
            ],
          },
        ],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 },
      });

      if (!result.ok) {
        return result;
      }

      const parsed = valuationModelOutputSchema.safeParse(result.json);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "KI-Output erfüllt das erwartete Schema nicht.",
        };
      }

      const parsedSources = groundingSourcesSchema.safeParse(
        result.grounding.sources,
      );

      return {
        ok: true,
        data: parsed.data,
        grounding: {
          sources: parsedSources.success ? parsedSources.data : [],
          webSearchQueries: result.grounding.webSearchQueries,
        },
        model: result.model,
      };
    },
  };
}

export function createDefaultPropertyValuator(): PropertyValuator {
  return createGeminiPropertyValuator();
}
