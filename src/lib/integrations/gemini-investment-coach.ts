import { redactFreeText, trimChatHistory } from "@/lib/domain/coach-text";
import {
  coachAssessmentSchema,
  coachChatReplySchema,
  type CoachChatMessage,
} from "@/lib/validation/coach";
import type { ZodType } from "zod";
import {
  createGeminiJsonClient,
  type GeminiJsonClient,
  type GeminiJsonClientOptions,
} from "./gemini-transport";
import type { CoachResult, InvestmentCoach } from "./investment-coach";

export const COACH_SYSTEM_PROMPT = [
  "Du bist ein ruhiger Lern- und Strategie-Coach für Einsteiger in die Geldanlage. Du gibst keine Anlageberatung; deine Einordnungen dienen ausschließlich Lernzwecken.",
  "Du erhältst einen anonymisierten, deterministisch verdichteten Kontext als JSON. Beziehe dich ausschließlich auf die darin enthaltenen Referenzen (z. B. ETF-1, AKTIE-1, KRYPTO-1, ZIEL-1, MEILENSTEIN-1, NOTGROSCHEN) und erfinde keine Beträge: Zahlen stammen nur aus dem Kontext, Geldbeträge sind Cent-Ganzzahlen, Gewichte sind Basispunkte (10.000 = 100 %).",
  "Gib keine Kauf-, Verkaufs- oder Halteempfehlung für einzelne Aktien, Kryptowährungen oder konkrete Einzelprodukte und keine Kursprognosen. Ordne nur auf Ebene von Asset-Klassen, Diversifikation, Zeithorizont und Liquiditätsreserve ein. Fragt der Nutzer nach Einzeltiteln, lehne freundlich ab und erkläre stattdessen die Kriterien.",
  "Faustregeln gelten als Orientierung, nicht als Gebot: Geld mit einem Horizont unter 3 bis 5 Jahren gehört eher nicht in volatile Anlagen; ein Notgroschen von 3 bis 6 Monaten laufender Lebenshaltungskosten ist üblich.",
  "Ist isDummyHousehold true oder der Snapshot alt (snapshotAgeDays hoch), weise auf die eingeschränkte Aussagekraft hin.",
  "Antworte ausschließlich mit einem JSON-Objekt gemäß dem beschriebenen Schema, ohne Markdown und ohne weiteren Text, in einfachem, ruhigem Deutsch.",
].join("\n");

const ASSESSMENT_SCHEMA_PROMPT = [
  "Aufgabe: Bewerte das Portfolio und die Liquidität. Antworte mit genau diesen Feldern:",
  "- summary: kurze Zusammenfassung (max. 600 Zeichen)",
  "- strengths: 1–5 Objekte { title (max. 80), detail (max. 400) }",
  "- risks: 0–5 Objekte { title, detail, severity: 'low' | 'medium' | 'high', relatedRefs: Liste gültiger Refs }",
  "- horizonCheck: 0–12 Objekte { ref: gültiger Ref (ZIEL-n, MEILENSTEIN-n oder NOTGROSCHEN), fit: 'fits' | 'tension' | 'mismatch', explanation (max. 400) }",
  "- rebalancing: null (kein Handlungsbedarf) oder { targetWeightsBps: { etf, stock, crypto } als ganze Basispunkte mit Summe exakt 10000, rationale (max. 600), preferContributionsOnly: boolean }",
  "- glossary: 0–5 Objekte { term, explanation } für Einsteiger-Begriffe",
].join("\n");

const CHAT_SCHEMA_PROMPT = [
  "Beantworte die Fragen des Nutzers auf Basis des Kontexts. Antworte immer mit genau diesen Feldern:",
  "- answer: Antwort (max. 2000 Zeichen)",
  "- followUpQuestions: 0–3 kurze Folgefragen (je max. 160 Zeichen)",
  "- declinedSecurityAdvice: true, wenn du eine Kauf-/Verkaufsfrage zu Einzeltiteln abgelehnt hast, sonst false",
].join("\n");

export type GeminiInvestmentCoachOptions = Omit<
  GeminiJsonClientOptions,
  "operationLabel"
>;

type Part = { text: string };
type Content = { role: "user" | "model"; parts: Part[] };

export function createGeminiInvestmentCoach(
  options: GeminiInvestmentCoachOptions = {},
  client: GeminiJsonClient = createGeminiJsonClient({
    ...options,
    operationLabel: "KI-Coach",
  }),
): InvestmentCoach {
  async function run<T>(
    contents: Content[],
    temperature: number,
    schema: ZodType<T>,
  ): Promise<CoachResult<T>> {
    const result = await client.generateJson({
      systemInstruction: { parts: [{ text: COACH_SYSTEM_PROMPT }] },
      contents,
      generationConfig: { responseMimeType: "application/json", temperature },
    });
    if (!result.ok) {
      return result;
    }
    const validated = schema.safeParse(result.json);
    if (!validated.success) {
      return {
        ok: false,
        code: "invalid_payload",
        message: "KI-Output erfüllt das erwartete Schema nicht.",
      };
    }
    return { ok: true, data: validated.data, model: result.model };
  }

  return {
    assess(contextJson) {
      return run(
        [
          {
            role: "user",
            parts: [
              {
                text: `Kontext: ${contextJson}\n\n${ASSESSMENT_SCHEMA_PROMPT}`,
              },
            ],
          },
        ],
        0.3,
        coachAssessmentSchema,
      );
    },

    chat(contextJson, messages: CoachChatMessage[]) {
      const history = trimChatHistory(messages).map(
        (message): Content =>
          message.role === "user"
            ? {
                role: "user",
                parts: [{ text: redactFreeText(message.text) }],
              }
            : {
                role: "model",
                parts: [{ text: JSON.stringify({ answer: message.text }) }],
              },
      );

      // Kontext steht im ersten user-Turn; die erste Nutzernachricht folgt im selben Turn.
      const [first, ...rest] = history;
      const contents: Content[] = [
        {
          role: "user",
          parts: [
            {
              text: `Kontext: ${contextJson}\n\n${CHAT_SCHEMA_PROMPT}`,
            },
            ...(first ? first.parts : []),
          ],
        },
        ...rest,
      ];
      return run(contents, 0.4, coachChatReplySchema);
    },
  };
}

export function createDefaultInvestmentCoach(): InvestmentCoach {
  return createGeminiInvestmentCoach();
}
