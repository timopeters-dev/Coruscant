import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAdvisorReport } from "@/domain/report/report";
import { buildAdvisorReportView } from "@/domain/report/anonymize";
import { ADVISOR_STARTER_PROMPT } from "@/domain/report/text";
import { calculateHouseholdBalance } from "@/domain/cockpit/balance";
import { calculateConsolidatedCashflow } from "@/domain/allocation/cashflow";
import {
  AdvisorReportToolbar,
  buildReportUrl,
  copyAdvisorReportText,
} from "@/frontend/bericht/advisor-report-toolbar";
import { requestAdvisorQuestionCheck } from "@/frontend/bericht/use-advisor-question-check";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function makeEmptyView(mode: "anonymized" | "full") {
  const asOfDate = "2026-11-19";
  const balance = calculateHouseholdBalance({
    asOfDate,
    properties: [],
    contracts: [],
    pots: [],
  });
  const cashflow = calculateConsolidatedCashflow({
    household: null,
    manualItems: [],
    variableBasis: "budget",
  });
  const report = buildAdvisorReport({
    asOfDate,
    generatedAt: "2026-11-19T10:00:00.000Z",
    snapshotFetchedAt: null,
    isDummyHousehold: false,
    balance,
    properties: [],
    contracts: [],
    pots: [],
    cashflow,
    history: [],
    recommendationState: {
      asOfDate,
      monthlyExpensesCents: null,
      monthlySurplusCents: 0,
      pots: [],
      loans: [],
    },
    oneTimeAmountCents: null,
  });
  return buildAdvisorReportView(report, mode);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdvisorReportToolbar", () => {
  it("disables print & copy and renders placeholder in print block while checking or blocked in anonymized mode", () => {
    const view = makeEmptyView("anonymized");

    const checkingHtml = renderToStaticMarkup(
      <AdvisorReportToolbar
        view={view}
        mode="anonymized"
        initialQuestion="Frage zur Musterbank"
        checkOverride={{ status: "checking", issues: [] }}
        showDocument={false}
      />,
    );
    expect(checkingHtml).toContain("wird geprüft…");
    const printSectionMatch = checkingHtml.match(
      /<section class="hidden print:block[\s\S]*?<\/section>/,
    );
    expect(printSectionMatch).not.toBeNull();
    expect(printSectionMatch![0]).toContain(
      "[Freitext ausgelassen – möglicherweise personenbezogene Angaben]",
    );
    expect(printSectionMatch![0]).not.toContain("Frage zur Musterbank");

    const blockedHtml = renderToStaticMarkup(
      <AdvisorReportToolbar
        view={view}
        mode="anonymized"
        initialQuestion="Frage zur Musterbank"
        checkOverride={{ status: "blocked", issues: ["known_name"] }}
        showDocument={false}
      />,
    );
    expect(blockedHtml).toContain("enthält einen Namen aus deinen Daten");
    expect(blockedHtml).toContain(
      "[Freitext ausgelassen – möglicherweise personenbezogene Angaben]",
    );
    // Both Print and Copy buttons are disabled
    const disabledButtons = blockedHtml.match(/disabled=""/g) ?? [];
    expect(disabledButtons.length).toBeGreaterThanOrEqual(2);

    const okHtml = renderToStaticMarkup(
      <AdvisorReportToolbar
        view={view}
        mode="anonymized"
        initialQuestion="Soll ich erst tilgen?"
        checkOverride={{ status: "ok", issues: [] }}
        showDocument={false}
      />,
    );
    expect(okHtml).toContain("geprüft ✓");
    expect(okHtml).toContain("Soll ich erst tilgen?");
    expect(okHtml).not.toContain("[Freitext ausgelassen");
  });

  it("hides copy-for-LLM button in full mode and does not trigger fetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const view = makeEmptyView("full");

    const html = renderToStaticMarkup(
      <AdvisorReportToolbar
        view={view}
        mode="full"
        initialQuestion="Persönliche Frage"
        showDocument={false}
      />,
    );

    expect(html).not.toContain("Als Text für LLM kopieren");
    expect(html).toContain("Für KI-Chats den Modus „Anonymisiert“ wählen");
    expect(html).toContain("Persönliche Frage");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls clipboard.writeText with text starting with ADVISOR_STARTER_PROMPT", async () => {
    const view = makeEmptyView("anonymized");
    const writeText = vi.fn().mockResolvedValue(undefined);

    const result = await copyAdvisorReportText(
      view,
      "Soll ich lieber sparen?",
      { writeText },
    );

    expect(result.copied).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedText = writeText.mock.calls[0]![0] as string;
    expect(copiedText.startsWith(ADVISOR_STARTER_PROMPT)).toBe(true);
    expect(copiedText).toContain("Soll ich lieber sparen?");
  });

  it("requestAdvisorQuestionCheck posts to /api/report/advisor/question-check and handles blocked/ok", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, issues: ["known_name"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const blocked = await requestAdvisorQuestionCheck("Musterbank");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/report/advisor/question-check",
      expect.objectContaining({ method: "POST" }),
    );
    expect(blocked).toEqual({ status: "blocked", issues: ["known_name"] });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, issues: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const ok = await requestAdvisorQuestionCheck("ETF oder Tilgung?");
    expect(ok).toEqual({ status: "ok", issues: [] });
  });

  it("buildReportUrl omits invalid amount on mode switch and preserves valid amount", () => {
    expect(buildReportUrl("full", "abc")).toBe("/bericht?modus=vollstaendig");
    expect(buildReportUrl("anonymized", "-50")).toBe("/bericht?modus=anonym");
    expect(buildReportUrl("full", "5.000")).toBe(
      "/bericht?modus=vollstaendig&betrag=5.000",
    );
  });
});
