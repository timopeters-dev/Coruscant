import type { ValuationModelOutput } from "@/lib/validation/property-valuation";
import type { GeminiGroundingMetadata } from "./gemini-transport";

export type ValuatorErrorCode =
  | "not_configured"
  | "timeout"
  | "http_error"
  | "network_error"
  | "invalid_payload";

export type ValuatorResult =
  | {
      ok: true;
      data: ValuationModelOutput;
      grounding: GeminiGroundingMetadata;
      model: string;
    }
  | {
      ok: false;
      code: ValuatorErrorCode;
      message: string;
      httpStatus?: number;
    };

export interface PropertyValuator {
  estimate(contextJson: string): Promise<ValuatorResult>;
}
