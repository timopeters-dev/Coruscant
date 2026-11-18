import type { QuotaSnapshot } from "@/lib/domain/auto-valuation-schedule";
import type { NormalizedValuationResult } from "@/lib/domain/property-valuation";
import { createImmoAnalysePropertyValuator } from "./immoanalyse-property-valuator";

export type ValuatorErrorCode =
  | "not_configured"
  | "unauthorized"
  | "quota_exceeded"
  | "rate_limited"
  | "not_valuable"
  | "invalid_request"
  | "timeout"
  | "http_error"
  | "network_error"
  | "invalid_payload";

export type ValuatorResult =
  | {
      ok: true;
      result: NormalizedValuationResult;
      quota: QuotaSnapshot | null;
      provider: "immoanalyse";
    }
  | {
      ok: false;
      code: ValuatorErrorCode;
      message: string;
      httpStatus?: number;
      apiCode?: string;
      quota?: QuotaSnapshot | null;
    };

export interface PropertyValuator {
  estimate(requestJson: string): Promise<ValuatorResult>;
}

export function createDefaultPropertyValuator(
  fallbackAsOfDate?: string,
): PropertyValuator {
  return createImmoAnalysePropertyValuator({ fallbackAsOfDate });
}
