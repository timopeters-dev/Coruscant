import { loadInvestmentContextInput } from "@/backend/db/queries/coach";
import { loadPlanningBase } from "@/backend/db/queries/planning-base";
import { loadRecommendationState } from "@/backend/db/queries/recommendation";
import { isDevMode } from "@/backend/dev-mode";
import { ApiError } from "@/backend/errors";
import { createDefaultInvestmentCoach } from "@/backend/integrations/gemini-investment-coach";
import type { CoachErrorCode, CoachResult } from "@/backend/integrations/investment-coach";
import { getTodayIsoDate } from "@/domain/core/date";
import { calculateRebalancingPlan, sanitizeAssessmentRefs } from "@/domain/recommendation/coach-rebalancing";
import {
  buildInvestmentContext,
  collectContextRefs,
  isInvestmentContextUsable,
  type InvestmentContext,
} from "@/domain/recommendation/investment-context";
import {
  buildLlmInvestmentContextView,
  buildRecommendationLlmView,
  collectRawCentValues,
  serializeLlmContext,
} from "@/domain/recommendation/llm";
import { computeRecommendationFingerprint, recommendMonthlySavings, recommendUse } from "@/domain/recommendation/recommendation";
import type { CoachChatRequest } from "@/validation/coach";
import type { ExplainRequest } from "@/validation/recommendation";

const STATUS_BY_CODE: Record<CoachErrorCode, number> = {
  not_configured: 503,
  timeout: 504,
  http_error: 502,
  network_error: 502,
  invalid_payload: 502,
};

/** Antwort des KI-Coachs oder ApiError; die Fehlermeldung enthält nie den Kontext. */
function unwrap<T>(result: CoachResult<T>): { data: T; model: string } {
  if (!result.ok) throw new ApiError(STATUS_BY_CODE[result.code], result.message, { code: result.code });
  return result;
}

/** Den Kontext JSON-serialisiert nur im Dev-Modus mitsenden (Transparenz beim Entwickeln). */
const devContext = (contextJson: string) => (isDevMode() ? { contextJson } : {});

/** Der Kontext wird bei jedem Request frisch aus der DB gebaut – nie aus Client-Daten. */
function buildContext(monthlySavingsRateCents?: number): { context: InvestmentContext; contextJson: string; rawCentValues: number[] } {
  const context = buildInvestmentContext(
    loadInvestmentContextInput({
      asOfDate: getTodayIsoDate(),
      ...(monthlySavingsRateCents !== undefined ? { monthlySavingsRateCents } : {}),
    }),
  );
  if (!isInvestmentContextUsable(context)) {
    throw new ApiError(422, "Kein Haushalts-Depot vorhanden.", { code: "coach_context_unavailable" });
  }
  return {
    context,
    contextJson: serializeLlmContext(buildLlmInvestmentContextView(context)),
    rawCentValues: collectRawCentValues(context),
  };
}

function valueOf(context: InvestmentContext, assetClass: "etf" | "stock" | "crypto"): number {
  return context.portfolio.assetClasses.find((c) => c.assetClass === assetClass)?.valueCents ?? 0;
}

export async function assessPortfolio(input: { monthlySavingsRateCents?: number }) {
  const { context, contextJson, rawCentValues } = buildContext(input.monthlySavingsRateCents);
  const { data, model } = unwrap(await createDefaultInvestmentCoach().assess(contextJson, rawCentValues));
  const assessment = sanitizeAssessmentRefs(data, collectContextRefs(context));
  const rebalancingPlan = assessment.rebalancing
    ? calculateRebalancingPlan({
        currentValues: { etf: valueOf(context, "etf"), stock: valueOf(context, "stock"), crypto: valueOf(context, "crypto") },
        targetWeightsBps: assessment.rebalancing.targetWeightsBps,
        monthlySavingsRateCents: context.cashflow.monthlySavingsRateCents,
      })
    : null;
  return { assessment, rebalancingPlan, model, ...devContext(contextJson) };
}

export async function chatWithCoach(input: CoachChatRequest) {
  const { contextJson, rawCentValues } = buildContext(input.monthlySavingsRateCents);
  const { data, model } = unwrap(await createDefaultInvestmentCoach().chat(contextJson, input.messages, rawCentValues));
  return { reply: data, model, ...devContext(contextJson) };
}

/** KI-Erklärung einer lokal berechneten Empfehlung; die Zahlen kommen nie von der KI. */
export async function explainRecommendation(input: ExplainRequest) {
  const base = loadPlanningBase();
  const state = loadRecommendationState({ asOfDate: getTodayIsoDate(), base });
  const recommendation =
    input.mode === "one_time"
      ? recommendUse(input.amountCents!, state, input.assumptions)
      : recommendMonthlySavings(state, input.assumptions);
  if (recommendation.items.length === 0) {
    throw new ApiError(422, "Keine Empfehlungsposten vorhanden.", { code: "recommendation_empty" });
  }

  const view = buildRecommendationLlmView(recommendation, state, { isDummyHousehold: base.isDummy });
  const contextJson = serializeLlmContext(view);
  const rawCentValues = [
    recommendation.amountCents,
    ...recommendation.items.map((i) => i.amountCents),
    ...state.pots.flatMap((p) => [p.currentCents, p.targetCents ?? 0]),
    ...state.loans.map((l) => l.balanceCents),
  ].filter((v) => v >= 1000);

  const { data, model } = unwrap(await createDefaultInvestmentCoach().explain(contextJson, view, rawCentValues));
  return {
    explanation: data,
    fingerprint: computeRecommendationFingerprint(recommendation),
    model,
    ...devContext(contextJson),
  };
}
