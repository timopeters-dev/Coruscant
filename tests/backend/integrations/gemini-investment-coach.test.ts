import type { RecommendationLlmView } from "@/domain/recommendation/llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COACH_SYSTEM_PROMPT,
  EXPLAIN_SCHEMA_PROMPT,
  createGeminiInvestmentCoach,
} from "@/backend/integrations/gemini-investment-coach";

const CONTEXT = '{"schemaVersion":1,"marker":"ctx-marker"}';

const VALID_ASSESSMENT = {
  summary: "Ruhiger Überblick.",
  strengths: [{ title: "Breit", detail: "ETF dominiert." }],
  risks: [],
  horizonCheck: [],
  rebalancing: {
    targetWeightsBps: { etf: 8000, stock: 1500, crypto: 500 },
    rationale: "Weniger Einzeltitel.",
    preferContributionsOnly: true,
  },
  glossary: [],
};

const VALID_REPLY = {
  answer: "Gerne.",
  followUpQuestions: [],
  declinedSecurityAdvice: false,
};

function geminiResponse(payload: unknown, wrap = (s: string) => s): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: wrap(JSON.stringify(payload)) }] } }],
    }),
    { status: 200 },
  );
}

function makeCoach(fetchFn: typeof fetch, extra: Record<string, unknown> = {}) {
  return createGeminiInvestmentCoach({
    apiKey: "test-key",
    model: "model-a",
    fallbackModels: ["model-b"],
    fetchFn,
    retryDelayMs: 0,
    ...extra,
  });
}

function bodyOf(fetchFn: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchFn.mock.calls[call]![1].body as string) as {
    systemInstruction: { parts: { text: string }[] };
    contents: { role: string; parts: { text: string }[] }[];
    generationConfig: { temperature: number; responseMimeType: string };
  };
}

describe("COACH_SYSTEM_PROMPT", () => {
  it("enthält die Leitplanken und kein Cent", () => {
    expect(COACH_SYSTEM_PROMPT).toContain("keine Kauf-, Verkaufs- oder Halteempfehlung");
    expect(COACH_SYSTEM_PROMPT).toContain("keine Anlageberatung");
    expect(COACH_SYSTEM_PROMPT.toLowerCase()).not.toContain("cent");
    expect(EXPLAIN_SCHEMA_PROMPT).toContain("Platzhalter");
  });
});

describe("assess", () => {
  it("sendet systemInstruction, Kontext unverändert im ersten Turn und liefert validierte Daten", async () => {
    const fetchFn = vi.fn().mockResolvedValue(geminiResponse(VALID_ASSESSMENT));
    const result = await makeCoach(fetchFn as unknown as typeof fetch).assess(CONTEXT);
    expect(result).toMatchObject({ ok: true, model: "model-a" });
    const body = bodyOf(fetchFn);
    expect(body.systemInstruction.parts[0]!.text).toBe(COACH_SYSTEM_PROMPT);
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0]!.role).toBe("user");
    expect(body.contents[0]!.parts[0]!.text).toContain(CONTEXT);
    expect(body.generationConfig).toEqual({
      responseMimeType: "application/json",
      temperature: 0.3,
    });
    expect(fetchFn.mock.calls[0]![0]).toContain("model-a");
  });

  it("nutzt GEMINI_MODEL, wenn kein Modell übergeben wird", async () => {
    vi.stubEnv("GEMINI_MODEL", "env-model");
    try {
      const fetchFn = vi.fn().mockResolvedValue(geminiResponse(VALID_ASSESSMENT));
      const coach = createGeminiInvestmentCoach({
        apiKey: "k",
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      await coach.assess(CONTEXT);
      expect(fetchFn.mock.calls[0]![0]).toContain("env-model");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("liefert not_configured ohne Key und ohne fetch-Aufruf", async () => {
    const fetchFn = vi.fn();
    const result = await createGeminiInvestmentCoach({
      apiKey: "",
      fetchFn: fetchFn as unknown as typeof fetch,
    }).assess(CONTEXT);
    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("liefert invalid_payload bei Nicht-JSON-Text und bei Gewichtssumme ≠ 10.000", async () => {
    const notJson = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "kein json" }] } }] }),
      ),
    );
    expect(
      await makeCoach(notJson as unknown as typeof fetch).assess(CONTEXT),
    ).toMatchObject({ ok: false, code: "invalid_payload" });

    const badSum = vi.fn().mockResolvedValue(
      geminiResponse({
        ...VALID_ASSESSMENT,
        rebalancing: {
          ...VALID_ASSESSMENT.rebalancing,
          targetWeightsBps: { etf: 8000, stock: 1500, crypto: 400 },
        },
      }),
    );
    expect(
      await makeCoach(badSum as unknown as typeof fetch).assess(CONTEXT),
    ).toMatchObject({ ok: false, code: "invalid_payload" });
  });

  it("toleriert Code-Fences", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(geminiResponse(VALID_ASSESSMENT, (s) => `\`\`\`json\n${s}\n\`\`\``));
    expect(
      await makeCoach(fetchFn as unknown as typeof fetch).assess(CONTEXT),
    ).toMatchObject({ ok: true });
  });

  it("wiederholt bei 429 und wechselt dann auf das Fallback-Modell", async () => {
    const fetchFn = vi.fn().mockImplementation(async (url: string) =>
      url.includes("model-a")
        ? new Response("{}", { status: 429 })
        : geminiResponse(VALID_ASSESSMENT),
    );
    const result = await makeCoach(fetchFn as unknown as typeof fetch).assess(CONTEXT);
    expect(result).toMatchObject({ ok: true, model: "model-b" });
    expect(fetchFn.mock.calls.length).toBeGreaterThan(2);
  });

  it("liefert timeout, wenn fetch abgebrochen wird", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchFn = vi.fn().mockRejectedValue(abort);
    const result = await makeCoach(fetchFn as unknown as typeof fetch, {
      fallbackModels: [],
    }).assess(CONTEXT);
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });
});

describe("chat", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("mappt coach → model, hält den Kontext im ersten Turn und maskiert IBANs", async () => {
    const fetchFn = vi.fn().mockResolvedValue(geminiResponse(VALID_REPLY));
    const result = await makeCoach(fetchFn as unknown as typeof fetch).chat(CONTEXT, [
      { role: "user", text: "Meine IBAN DE02 1203 0000 0000 2020 51 ist egal" },
      { role: "coach", text: "Verstanden." },
      { role: "user", text: "Mail kontakt@example.com ok?" },
    ]);
    expect(result).toMatchObject({ ok: true, data: VALID_REPLY });
    const body = bodyOf(fetchFn);
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[0]!.parts[0]!.text).toContain(CONTEXT);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("DE02 1203");
    expect(raw).not.toContain("kontakt@example.com");
    expect(raw).toContain("[IBAN entfernt]");
    expect(raw).toContain("[E-Mail entfernt]");
    expect(body.contents[1]!.parts[0]!.text).toBe('{"answer":"Verstanden."}');
    expect(body.generationConfig.temperature).toBe(0.4);
  });

  it("maskiert PII auch in zurückgespielten Coach-Nachrichten", async () => {
    const fetchFn = vi.fn().mockResolvedValue(geminiResponse(VALID_REPLY));
    await makeCoach(fetchFn as unknown as typeof fetch).chat(CONTEXT, [
      { role: "user", text: "Hallo" },
      { role: "coach", text: "Ihre IBAN DE02 1203 0000 0000 2020 51 wurde genannt." },
      { role: "user", text: "Weiter" },
    ]);
    const raw = JSON.stringify(bodyOf(fetchFn));
    expect(raw).not.toContain("DE02 1203");
    expect(raw).toContain("[IBAN entfernt]");
  });

  it("kürzt auf höchstens 10 Turns", async () => {
    const fetchFn = vi.fn().mockResolvedValue(geminiResponse(VALID_REPLY));
    const messages = Array.from({ length: 31 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("coach" as const),
      text: `m${i}`,
    }));
    await makeCoach(fetchFn as unknown as typeof fetch).chat(CONTEXT, messages);
    const body = bodyOf(fetchFn);
    // 20 Nachrichten (Start bei user) → erste verschmolzen mit Kontext → 19 Turns
    expect(body.contents.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(body)).not.toContain('"m0"');
    expect(JSON.stringify(body)).toContain("m30");
    expect(body.contents[0]!.role).toBe("user");
  });

  it("liefert invalid_payload bei Schema-Verstoß (fehlendes declinedSecurityAdvice)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(geminiResponse({ answer: "x", followUpQuestions: [] }));
    expect(
      await makeCoach(fetchFn as unknown as typeof fetch).chat(CONTEXT, [
        { role: "user", text: "Hallo" },
      ]),
    ).toMatchObject({ ok: false, code: "invalid_payload" });
  });

  it("wiederholt bei Cent-ähnlicher Zahl in answer/summary genau einmal", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        geminiResponse({ ...VALID_REPLY, answer: "Wert ist 1234500." }),
      )
      .mockResolvedValueOnce(
        geminiResponse({ ...VALID_REPLY, answer: "Wert ist 12.345 €." }),
      );
    const res = await makeCoach(fetchFn as unknown as typeof fetch).chat(
      CONTEXT,
      [{ role: "user", text: "Hallo" }],
      [1234500],
    );
    expect(res).toMatchObject({ ok: true, data: { answer: "Wert ist 12.345 €." } });
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const alwaysCent = vi
      .fn()
      .mockResolvedValue(
        geminiResponse({ ...VALID_ASSESSMENT, summary: "Summe 1234500." }),
      );
    const assessRes = await makeCoach(alwaysCent as unknown as typeof fetch).assess(
      CONTEXT,
      [1234500],
    );
    expect(assessRes).toMatchObject({ ok: false, code: "invalid_payload" });
    expect(alwaysCent).toHaveBeenCalledTimes(2);
  });
});

describe("explain", () => {
  const VIEW: RecommendationLlmView = {
    schemaVersion: 1,
    art: "einmalbetrag",
    posten: [
      {
        ref: "P1",
        art: "notgroschen",
        ziel: "NOTGROSCHEN",
        gruende: [{ code: "EMERGENCY_FUND_GAP", platzhalter: ["P1.betrag"] }],
      },
    ],
    hinweise: [],
    annahmen: { platzhalter: ["ANNAHME.rendite"] },
    werte: {
      BETRAG: "2.000 €",
      "P1.betrag": "2.000 €",
      "ANNAHME.rendite": "6,00 %",
    },
    datenqualitaet: { isDummyHousehold: false, horizonEstimated: false },
  };

  it("macht bei Verstoß genau 1 Retry mit Korrekturhinweis ohne Zahlen aus Versuch 1", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        geminiResponse({
          summary: "Lege 3.500 € zurück.",
          items: [{ ref: "P1", text: "Für P1: {P1.betrag}." }],
          caveats: [],
        }),
      )
      .mockResolvedValueOnce(
        geminiResponse({
          summary: "Wir legen {BETRAG} zurück.",
          items: [{ ref: "P1", text: "Für den Notgroschen: {P1.betrag}." }],
          caveats: [],
        }),
      );

    const res = await makeCoach(fetchFn as unknown as typeof fetch).explain(
      JSON.stringify(VIEW),
      VIEW,
      [200_000],
    );
    expect(res).toMatchObject({
      ok: true,
      data: {
        summary: "Wir legen 2.000 € zurück.",
        items: [{ ref: "P1", text: "Für den Notgroschen: 2.000 €." }],
      },
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const secondBody = bodyOf(fetchFn, 1);
    expect(secondBody.contents).toHaveLength(2);
    expect(secondBody.contents[1]!.parts[0]!.text).toContain("literal_amount");
    expect(secondBody.contents[1]!.parts[0]!.text).not.toContain("3.500");
  });

  it("liefert invalid_payload nach 2 ungültigen Versuchen", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      geminiResponse({
        summary: "Lege 9.999 € zurück.",
        items: [{ ref: "P1", text: "{P1.betrag}" }],
        caveats: [],
      }),
    );
    const res = await makeCoach(fetchFn as unknown as typeof fetch).explain(
      JSON.stringify(VIEW),
      VIEW,
    );
    expect(res).toMatchObject({ ok: false, code: "invalid_payload" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("wiederholt bei Transportfehler nicht (1 Aufruf)", async () => {
    const generateJson = vi
      .fn()
      .mockResolvedValue({ ok: false, code: "timeout", message: "timeout" });
    const coach = createGeminiInvestmentCoach({}, { generateJson });
    const res = await coach.explain(JSON.stringify(VIEW), VIEW);
    expect(res).toMatchObject({ ok: false, code: "timeout" });
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});
