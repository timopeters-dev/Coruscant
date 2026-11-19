import type { RecommendationLlmView } from "@/lib/domain/recommendation-llm";
import type {
  CoachAssessment,
  CoachChatMessage,
  CoachChatReply,
} from "@/lib/validation/coach";
import type { RecommendationExplanation } from "@/lib/validation/recommendation";

export type CoachErrorCode =
  | "not_configured"
  | "timeout"
  | "http_error"
  | "network_error"
  | "invalid_payload";

export type CoachResult<T> =
  | { ok: true; data: T; model: string }
  | {
      ok: false;
      code: CoachErrorCode;
      message: string;
      httpStatus?: number;
    };

export interface InvestmentCoach {
  assess(
    contextJson: string,
    rawCentValues?: readonly number[],
  ): Promise<CoachResult<CoachAssessment>>;
  chat(
    contextJson: string,
    messages: CoachChatMessage[],
    rawCentValues?: readonly number[],
  ): Promise<CoachResult<CoachChatReply>>;
  explain(
    viewJson: string,
    view: RecommendationLlmView,
    rawCentValues?: readonly number[],
  ): Promise<CoachResult<RecommendationExplanation>>;
}
