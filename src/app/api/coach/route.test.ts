import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/db";
import { createPot } from "@/db/queries/allocation";
import { createContract } from "@/db/queries/contracts";
import { contractCreateSchema } from "@/lib/validation/contracts";
import { insertExternalSnapshot } from "@/db/queries/external-snapshots";
import { financialContracts, externalSnapshots, pots } from "@/db/schema";
import type {
  CoachResult,
  InvestmentCoach,
} from "@/lib/integrations/investment-coach";
import type { CoachAssessment, CoachChatReply } from "@/lib/validation/coach";
import { createAssessmentHandler, createChatHandler } from "./handlers";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-coach-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
});

afterEach(() => {
  dbModule.closeDb();
  if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDbUrl;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const ASSESSMENT: CoachAssessment = {
  summary: "Ruhiger Überblick.",
  strengths: [{ title: "Breit", detail: "ETF dominiert." }],
  risks: [
    {
      title: "Klumpen",
      detail: "Ein Index dominiert.",
      severity: "medium",
      relatedRefs: ["ETF-1", "ETF-99"],
    },
  ],
  horizonCheck: [
    { ref: "ZIEL-1", fit: "tension", explanation: "Kurzer Horizont." },
    { ref: "ZIEL-42", fit: "fits", explanation: "Erfunden." },
  ],
  rebalancing: {
    targetWeightsBps: { etf: 6000, stock: 3000, crypto: 1000 },
    rationale: "Mehr Streuung.",
    preferContributionsOnly: true,
  },
  glossary: [],
};

const REPLY: CoachChatReply = {
  answer: "Gerne.",
  followUpQuestions: [],
  declinedSecurityAdvice: false,
};

function fakeCoach(overrides: Partial<InvestmentCoach> = {}) {
  const assess = vi.fn(
    async (): Promise<CoachResult<CoachAssessment>> => ({
      ok: true,
      data: ASSESSMENT,
      model: "fake-model",
    }),
  );
  const chat = vi.fn(
    async (): Promise<CoachResult<CoachChatReply>> => ({
      ok: true,
      data: REPLY,
      model: "fake-model",
    }),
  );
  const coach: InvestmentCoach = { assess, chat, ...overrides };
  return { coach, assess, chat };
}

function seed(options: { withPositions?: boolean } = {}) {
  const withPositions = options.withPositions ?? true;
  createContract(
    contractCreateSchema.parse({
    name: "Darlehen Erika Mustermann",
    provider: "Musterbank AG",
    sphere: "household",
    category: "loan",
    status: "active",
    currentBalanceCents: 20_000_000,
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 100_000,
    interestRateBps: 350,
    repaymentType: "annuity",
    milestoneDate: "2099-06-30",
    milestoneLabel: "Ablösung Musterstraße 1",
    }),
  );
  createPot({
    name: "Notgroschen Max Mustermann",
    ruleType: "fill_to_target",
    currentCents: 300_000,
    targetCents: 600_000,
    fixedMonthlyCents: null,
    remainderPercentage: null,
    linkedContractId: null,
    linkedPropertyId: null,
    externalLink: null,
    purpose: "emergency_fund",
  });
  insertExternalSnapshot({
    source: "finanz_cockpit",
    liquidCashCents: 500_000,
    etfStocksCents: 700_000,
    cryptoCents: 100_000,
    totalPersonalNetWorthCents: 1_300_000,
    fetchedAt: new Date().toISOString(),
    accounts: [
      {
        id: "acc-1",
        name: "Girokonto Max Mustermann",
        type: "checking",
        scope: "household",
        balanceCents: 500_000,
        holdingsValueCents: 0,
      },
    ],
    positions: withPositions
      ? [
          {
            id: "pos-1",
            accountId: "acc-1",
            symbol: "MWE",
            isin: "IE00B4L5Y983",
            name: "Muster MSCI World UCITS ETF",
            assetClass: "etf",
            marketValueCents: 700_000,
            costBasisCents: null,
            lastPriceAt: null,
          },
          {
            id: "pos-2",
            accountId: "acc-1",
            symbol: "MRB",
            isin: null,
            name: "Muster Robotics AG",
            assetClass: "stock",
            marketValueCents: 200_000,
            costBasisCents: null,
            lastPriceAt: null,
          },
          {
            id: "pos-3",
            accountId: "acc-1",
            symbol: "MCN",
            isin: null,
            name: "Muster Coin",
            assetClass: "crypto",
            marketValueCents: 100_000,
            costBasisCents: null,
            lastPriceAt: null,
          },
        ]
      : [],
  });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function snapshotOfTables() {
  const db = dbModule.getDb();
  return JSON.stringify({
    pots: db.select().from(pots).all(),
    contracts: db.select().from(financialContracts).all(),
    snapshots: db.select().from(externalSnapshots).all(),
  });
}

describe("POST /api/coach/assessment", () => {
  it("liefert 200 mit bereinigten Refs, Rebalancing-Plan und anonymem Kontext", async () => {
    seed();
    const { coach, assess } = fakeCoach();
    const res = await createAssessmentHandler(() => coach)(
      post({ monthlySavingsRateCents: 50_000 }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      assessment: CoachAssessment;
      rebalancingPlan: { totalCents: number; classes: { deltaCents: number }[] };
      model: string;
      contextJson: string;
    };
    expect(json.model).toBe("fake-model");
    expect(json.assessment.risks[0]!.relatedRefs).toEqual(["ETF-1"]);
    expect(json.assessment.horizonCheck.map((h) => h.ref)).toEqual([]);
    expect(json.rebalancingPlan.totalCents).toBe(1_000_000);
    expect(json.rebalancingPlan.classes.reduce((s, c) => s + c.deltaCents, 0)).toBe(0);

    for (const forbidden of [
      "Mustermann",
      "Musterbank",
      "Musterstraße",
      "Erika",
      "Robotics",
      "Notgroschen Max",
    ]) {
      expect(json.contextJson).not.toContain(forbidden);
    }
    expect(json.contextJson).toContain("Muster MSCI World UCITS ETF");
    expect(json.contextJson).toContain('"monthlySavingsRateCents": 50000');
    expect(assess).toHaveBeenCalledWith(json.contextJson);
  });

  it("liefert rebalancingPlan null bei rebalancing: null", async () => {
    seed();
    const { coach } = fakeCoach({
      assess: async () => ({
        ok: true,
        data: { ...ASSESSMENT, rebalancing: null },
        model: "m",
      }),
    });
    const res = await createAssessmentHandler(() => coach)(post({}));
    const json = (await res.json()) as { rebalancingPlan: unknown };
    expect(res.status).toBe(200);
    expect(json.rebalancingPlan).toBeNull();
  });

  it("antwortet mit 422 ohne Snapshot oder ohne Positionen", async () => {
    const { coach, assess } = fakeCoach();
    const handler = createAssessmentHandler(() => coach);
    const noSnapshot = await handler(post({}));
    expect(noSnapshot.status).toBe(422);
    expect(((await noSnapshot.json()) as { code: string }).code).toBe(
      "coach_context_unavailable",
    );

    seed({ withPositions: false });
    const noPositions = await handler(post({}));
    expect(noPositions.status).toBe(422);
    expect(assess).not.toHaveBeenCalled();
  });

  it("antwortet mit 400 bei ungültigem Body, unbekanntem Schlüssel und ungültigem JSON", async () => {
    seed();
    const handler = createAssessmentHandler(() => fakeCoach().coach);
    expect((await handler(post({ monthlySavingsRateCents: -5 }))).status).toBe(400);
    expect((await handler(post({ context: "{}" }))).status).toBe(400);
    expect(
      (
        await handler(
          new Request("http://localhost/api/coach", { method: "POST", body: "{nope" }),
        )
      ).status,
    ).toBe(400);
  });

  it.each([
    ["not_configured", 503],
    ["timeout", 504],
    ["http_error", 502],
    ["network_error", 502],
    ["invalid_payload", 502],
  ] as const)("mappt Fehlercode %s auf HTTP %i ohne Kontext in der Meldung", async (code, status) => {
    seed();
    const { coach } = fakeCoach({
      assess: async () => ({ ok: false, code, message: "KI-Fehler." }),
    });
    const res = await createAssessmentHandler(() => coach)(post({}));
    expect(res.status).toBe(status);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("Muster");
    expect(text).toContain("KI-Fehler.");
  });

  it("verändert keine Tabellen (pots, financial_contracts, external_snapshots)", async () => {
    seed();
    const before = snapshotOfTables();
    const handler = createAssessmentHandler(() => fakeCoach().coach);
    await handler(post({}));
    await createChatHandler(() => fakeCoach().coach)(
      post({ messages: [{ role: "user", text: "Hallo" }] }),
    );
    expect(snapshotOfTables()).toBe(before);
  });
});

describe("POST /api/coach/chat", () => {
  it("liefert 200 mit Antwort", async () => {
    seed();
    const { coach, chat } = fakeCoach();
    const res = await createChatHandler(() => coach)(
      post({ messages: [{ role: "user", text: "Was ist ein ETF?" }] }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { reply: unknown; model: string; contextJson: string };
    expect(json.reply).toEqual(REPLY);
    expect(json.model).toBe("fake-model");
    expect(json.contextJson).toContain('"schemaVersion": 1');
    expect(chat).toHaveBeenCalledTimes(1);
    const [contextJson, messages] = chat.mock.calls[0] as unknown as [string, unknown[]];
    expect(contextJson).not.toContain("Mustermann");
    expect(messages).toHaveLength(1);
  });

  it("akzeptiert Verläufe mit Coach-Nachricht über 1.000 Zeichen (Roundtrip)", async () => {
    seed();
    const { coach, chat } = fakeCoach();
    const res = await createChatHandler(() => coach)(
      post({
        messages: [
          { role: "user", text: "Erste Frage" },
          { role: "coach", text: "a".repeat(2_000) },
          { role: "user", text: "Zweite Frage" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(chat).toHaveBeenCalledTimes(1);
    const tooLong = await createChatHandler(() => coach)(
      post({ messages: [{ role: "user", text: "a".repeat(1_001) }] }),
    );
    expect(tooLong.status).toBe(400);
  });

  it("antwortet mit 400, wenn die letzte Rolle coach ist oder ein context mitgesendet wird", async () => {
    seed();
    const handler = createChatHandler(() => fakeCoach().coach);
    expect(
      (
        await handler(
          post({
            messages: [
              { role: "user", text: "Hallo" },
              { role: "coach", text: "Hi" },
            ],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          post({ messages: [{ role: "user", text: "Hallo" }], context: "{}" }),
        )
      ).status,
    ).toBe(400);
  });

  it("antwortet mit 422 ohne Positionen und mappt Coach-Fehler", async () => {
    const handler = createChatHandler(() => fakeCoach().coach);
    expect(
      (await handler(post({ messages: [{ role: "user", text: "Hi" }] }))).status,
    ).toBe(422);

    seed();
    const failing = createChatHandler(
      () =>
        fakeCoach({
          chat: async () => ({ ok: false, code: "timeout", message: "Zeit." }),
        }).coach,
    );
    expect(
      (await failing(post({ messages: [{ role: "user", text: "Hi" }] }))).status,
    ).toBe(504);
  });
});
