import type {
  CoachAssessment,
  CoachChatMessage,
  CoachChatReply,
} from "@/lib/validation/coach";

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
  assess(contextJson: string): Promise<CoachResult<CoachAssessment>>;
  chat(
    contextJson: string,
    messages: CoachChatMessage[],
  ): Promise<CoachResult<CoachChatReply>>;
}
