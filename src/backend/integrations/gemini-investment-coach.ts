import { redactFreeText, trimChatHistory } from "@/domain/recommendation/coach-text";
import {
  findCentLikeNumbers,
  validateExplanation,
  type RecommendationLlmView,
} from "@/domain/recommendation/llm";
import {
  coachAssessmentSchema,
  coachChatReplySchema,
  type CoachAssessment,
  type CoachChatMessage,
  type CoachChatReply,
} from "@/validation/coach";
import type { RecommendationExplanation } from "@/validation/recommendation";
import type { ZodType } from "zod";
import {
  createGeminiJsonClient,
  type GeminiJsonClient,
  type GeminiJsonClientOptions,
} from "./gemini-transport";
import type { CoachResult, InvestmentCoach } from "./investment-coach";

export const COACH_SYSTEM_PROMPT = [
  "Du bist ein ruhiger Lern- und Strategie-Coach für Einsteiger in die Geldanlage. Du gibst keine Anlageberatung; deine Einordnungen dienen ausschließlich Lernzwecken.",
  "Du erhältst einen anonymisierten, deterministisch verdichteten Kontext als JSON. Beziehe dich ausschließlich auf die darin enthaltenen Referenzen (z. B. ETF-1, AKTIE-1, KRYPTO-1, ZIEL-1, MEILENSTEIN-1, NOTGROSCHEN, KREDIT-1) und erfinde keine Beträge: Alle Beträge im Kontext sind bereits in Euro formatiert. Nenne Beträge ausschließlich in Euro und rechne nicht selbst.",
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

export const EXPLAIN_SCHEMA_PROMPT = [
  "Die Empfehlung ist bereits berechnet; erkläre sie nur. Schreibe Beträge, Prozentsätze und Zeiträume ausschließlich als Platzhalter in geschweiften Klammern aus `werte` (z. B. {P1.betrag}). Schreibe keine eigenen Ziffern. Erfinde keine Posten. Keine Einzeltitel und keine Kursprognosen; „breit gestreuter ETF“ ist erlaubt.",
  "Antworte mit genau diesen Feldern:",
  "- summary: kurze Zusammenfassung (max. 600 Zeichen)",
  "- items: 1–8 Objekte { ref: gültiger Posten-Ref (P1, P2, ...), text (max. 400 Zeichen) } ohne doppelte Refs",
  "- caveats: 0–3 kurze Hinweise (je max. 300 Zeichen)",
].join("\n");

export type GeminiInvestmentCoachOptions = Omit<
  GeminiJsonClientOptions,
  "operationLabel"
>;

type Part = { text: string };
type Content = { role: "user" | "model"; parts: Part[] };

function extractAssessmentTexts(data: CoachAssessment): string[] {
  return [
    data.summary,
    ...data.strengths.flatMap((s) => [s.title, s.detail]),
    ...data.risks.flatMap((r) => [r.title, r.detail]),
    ...data.horizonCheck.map((h) => h.explanation),
    ...(data.rebalancing ? [data.rebalancing.rationale] : []),
    ...data.glossary.flatMap((g) => [g.term, g.explanation]),
  ];
}

function extractChatTexts(data: CoachChatReply): string[] {
  return [data.answer, ...data.followUpQuestions];
}

export function createGeminiInvestmentCoach(
  options: GeminiInvestmentCoachOptions = {},
  client: GeminiJsonClient = createGeminiJsonClient({
    ...options,
    operationLabel: "KI-Coach",
  }),
): InvestmentCoach {
  async function runWithCentCheck<T>(
    contents: Content[],
    temperature: number,
    schema: ZodType<T>,
    extractTexts: (data: T) => string[],
    rawCentValues: readonly number[],
  ): Promise<CoachResult<T>> {
    const attempt = async (turnContents: Content[]) => {
      const result = await client.generateJson({
        systemInstruction: { parts: [{ text: COACH_SYSTEM_PROMPT }] },
        contents: turnContents,
        generationConfig: { responseMimeType: "application/json", temperature },
      });
      if (!result.ok) return { kind: "transport" as const, result };
      const validated = schema.safeParse(result.json);
      if (!validated.success) {
        return { kind: "invalid" as const, reason: "schema" };
      }
      const hits = findCentLikeNumbers(
        extractTexts(validated.data),
        rawCentValues,
      );
      if (hits.length > 0) {
        return { kind: "cent" as const };
      }
      return {
        kind: "ok" as const,
        result: {
          ok: true as const,
          data: validated.data,
          model: result.model,
        },
      };
    };

    const first = await attempt(contents);
    if (first.kind === "transport") return first.result;
    if (first.kind === "ok") return first.result;
    if (first.kind === "invalid") {
      return {
        ok: false,
        code: "invalid_payload",
        message: "KI-Output erfüllt das erwartete Schema nicht.",
      };
    }

    const retryContents: Content[] = [
      ...contents,
      {
        role: "user",
        parts: [
          {
            text: "Korrekturhinweis: Nenne Beträge ausschließlich in Euro wie im Kontext formatiert, niemals als Rohzahlen oder Untereinheiten. Antworte erneut nur mit gültigem JSON.",
          },
        ],
      },
    ];
    const second = await attempt(retryContents);
    if (second.kind === "transport") return second.result;
    if (second.kind === "ok") return second.result;
    return {
      ok: false,
      code: "invalid_payload",
      message: "KI-Output erfüllt das erwartete Schema nicht.",
    };
  }

  return {
    assess(contextJson, rawCentValues = []) {
      return runWithCentCheck(
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
        extractAssessmentTexts,
        rawCentValues,
      );
    },

    chat(contextJson, messages: CoachChatMessage[], rawCentValues = []) {
      const history = trimChatHistory(messages).map(
        (message): Content =>
          message.role === "user"
            ? {
                role: "user",
                parts: [{ text: redactFreeText(message.text) }],
              }
            : {
                role: "model",
                parts: [
                  {
                    text: JSON.stringify({ answer: redactFreeText(message.text) }),
                  },
                ],
              },
      );

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
      return runWithCentCheck(
        contents,
        0.4,
        coachChatReplySchema,
        extractChatTexts,
        rawCentValues,
      );
    },

    async explain(
      viewJson: string,
      view: RecommendationLlmView,
      rawCentValues: readonly number[] = [],
    ): Promise<CoachResult<RecommendationExplanation>> {
      const baseContents: Content[] = [
        {
          role: "user",
          parts: [
            {
              text: `Empfehlung: ${viewJson}\n\n${EXPLAIN_SCHEMA_PROMPT}`,
            },
          ],
        },
      ];

      const first = await client.generateJson({
        systemInstruction: { parts: [{ text: COACH_SYSTEM_PROMPT }] },
        contents: baseContents,
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      });
      if (!first.ok) {
        return first;
      }

      const v1 = validateExplanation(first.json, view, rawCentValues);
      if (v1.ok) {
        return { ok: true, data: v1.explanation, model: first.model };
      }

      const categories = Array.from(
        new Set(v1.violations.map((v) => v.code)),
      );
      const validRefs = view.posten.map((p) => p.ref).join(", ");
      const hint = `Korrekturhinweis: Fehlerkategorien (${categories.join(", ")}). Nutze für Beträge und Prozentsätze ausschließlich Platzhalter aus werte (z. B. {P1.betrag}); erlaubte Refs: ${validRefs}. Antworte erneut nur mit gültigem JSON.`;

      const second = await client.generateJson({
        systemInstruction: { parts: [{ text: COACH_SYSTEM_PROMPT }] },
        contents: [
          ...baseContents,
          { role: "user", parts: [{ text: hint }] },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      });
      if (!second.ok) {
        return second;
      }

      const v2 = validateExplanation(second.json, view, rawCentValues);
      if (v2.ok) {
        return { ok: true, data: v2.explanation, model: second.model };
      }

      return {
        ok: false,
        code: "invalid_payload",
        message: "KI-Output erfüllt die Erklärungs-Regeln nicht.",
      };
    },
  };
}

export function createDefaultInvestmentCoach(): InvestmentCoach {
  return createGeminiInvestmentCoach();
}
