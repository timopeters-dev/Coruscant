import { NextResponse } from "next/server";
import { loadInvestmentContextInput } from "@/db/queries/coach";
import {
  internalErrorResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { calculateRebalancingPlan, sanitizeAssessmentRefs } from "@/lib/domain/coach-rebalancing";
import { getTodayIsoDate } from "@/lib/domain/date";
import {
  buildInvestmentContext,
  collectContextRefs,
  isInvestmentContextUsable,
  serializeInvestmentContext,
  type InvestmentContext,
} from "@/lib/domain/investment-context";
import {
  createDefaultInvestmentCoach,
} from "@/lib/integrations/gemini-investment-coach";
import type {
  CoachErrorCode,
  InvestmentCoach,
} from "@/lib/integrations/investment-coach";
import {
  coachAssessmentRequestSchema,
  coachChatRequestSchema,
} from "@/lib/validation/coach";

export type CoachFactory = () => InvestmentCoach;

const STATUS_BY_CODE: Record<CoachErrorCode, number> = {
  not_configured: 503,
  timeout: 504,
  http_error: 502,
  network_error: 502,
  invalid_payload: 502,
};

function coachErrorResponse(
  code: CoachErrorCode,
  message: string,
): NextResponse {
  // Die Meldung stammt aus dem Transport und enthält nie den Kontext.
  return NextResponse.json({ error: message, code }, { status: STATUS_BY_CODE[code] });
}

type ContextResult =
  | { ok: true; context: InvestmentContext }
  | { ok: false; response: NextResponse };

/** Der Server baut den Kontext bei jedem Request frisch aus der DB – nie aus Client-Daten. */
function buildContextForRequest(monthlySavingsRateCents?: number): ContextResult {
  const input = loadInvestmentContextInput({
    asOfDate: getTodayIsoDate(),
    ...(monthlySavingsRateCents !== undefined ? { monthlySavingsRateCents } : {}),
  });
  const context = buildInvestmentContext(input);
  if (!isInvestmentContextUsable(context)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Kein Haushalts-Depot vorhanden.",
          code: "coach_context_unavailable",
        },
        { status: 422 },
      ),
    };
  }
  return { ok: true, context };
}

export function createAssessmentHandler(
  coachFactory: CoachFactory = createDefaultInvestmentCoach,
) {
  return async function POST(request: Request): Promise<NextResponse> {
    const body = await parseJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = coachAssessmentRequestSchema.safeParse(body.data);
    if (!parsed.success) return validationErrorResponse(parsed.error);

    try {
      const built = buildContextForRequest(parsed.data.monthlySavingsRateCents);
      if (!built.ok) return built.response;
      const { context } = built;
      const contextJson = serializeInvestmentContext(context);

      const result = await coachFactory().assess(contextJson);
      if (!result.ok) return coachErrorResponse(result.code, result.message);

      const assessment = sanitizeAssessmentRefs(
        result.data,
        collectContextRefs(context),
      );
      const rebalancingPlan = assessment.rebalancing
        ? calculateRebalancingPlan({
            currentValues: {
              etf: valueOf(context, "etf"),
              stock: valueOf(context, "stock"),
              crypto: valueOf(context, "crypto"),
            },
            targetWeightsBps: assessment.rebalancing.targetWeightsBps,
            monthlySavingsRateCents: context.cashflow.monthlySavingsRateCents,
          })
        : null;

      return NextResponse.json(
        { assessment, rebalancingPlan, model: result.model, contextJson },
        { status: 200 },
      );
    } catch {
      return internalErrorResponse();
    }
  };
}

function valueOf(
  context: InvestmentContext,
  assetClass: "etf" | "stock" | "crypto",
): number {
  return (
    context.portfolio.assetClasses.find((c) => c.assetClass === assetClass)
      ?.valueCents ?? 0
  );
}

export function createChatHandler(
  coachFactory: CoachFactory = createDefaultInvestmentCoach,
) {
  return async function POST(request: Request): Promise<NextResponse> {
    const body = await parseJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = coachChatRequestSchema.safeParse(body.data);
    if (!parsed.success) return validationErrorResponse(parsed.error);

    try {
      const built = buildContextForRequest(parsed.data.monthlySavingsRateCents);
      if (!built.ok) return built.response;

      const contextJson = serializeInvestmentContext(built.context);
      const result = await coachFactory().chat(
        contextJson,
        parsed.data.messages,
      );
      if (!result.ok) return coachErrorResponse(result.code, result.message);

      return NextResponse.json(
        { reply: result.data, model: result.model, contextJson },
        { status: 200 },
      );
    } catch {
      return internalErrorResponse();
    }
  };
}
