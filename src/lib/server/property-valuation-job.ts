import {
  getQuotaSnapshot,
  listAutoValuationCandidates,
  markAutoValuationAttempt,
} from "@/db/queries/property-valuations";
import {
  evaluateAutoValuationQuota,
  MAX_AUTO_VALUATIONS_PER_RUN,
  selectDueProperties,
} from "@/lib/domain/auto-valuation-schedule";
import {
  createDefaultPropertyValuator,
  type PropertyValuator,
} from "@/lib/integrations/property-valuator";
import { getBerlinClockSnapshot, toBerlinDateKey } from "./berlin-clock";
import { runPropertyValuation } from "./property-valuation-service";

export interface JobRunSummary {
  status: "success" | "skipped" | "error";
  message: string;
  processed: number;
  written: number;
  historyOnly: number;
  failed: number;
}

export interface RunAutoValuationJobOptions {
  now?: Date;
  nowFn?: () => Date;
  valuatorFactory?: (fallbackAsOfDate?: string) => PropertyValuator;
  env?: NodeJS.ProcessEnv;
}

export async function runAutoValuationJob(
  options: RunAutoValuationJobOptions = {},
): Promise<JobRunSummary> {
  const env = options.env ?? process.env;
  const apiKey = (env.IMMOANALYSE_API_KEY ?? "").trim();
  if (apiKey.length === 0) {
    return {
      status: "skipped",
      message: "ImmoAnalyse API-Key nicht konfiguriert.",
      processed: 0,
      written: 0,
      historyOnly: 0,
      failed: 0,
    };
  }

  const nowFn =
    options.nowFn ?? (options.now ? () => options.now! : () => new Date());
  const now = nowFn();
  const nowIso = now.toISOString();
  const clock = getBerlinClockSnapshot(now);

  const initialQuota = evaluateAutoValuationQuota(getQuotaSnapshot(), nowIso);
  if (!initialQuota.allowed) {
    return {
      status: "skipped",
      message: initialQuota.resetAt
        ? `Reserve geschützt bis ${initialQuota.resetAt}`
        : "Reserve geschützt.",
      processed: 0,
      written: 0,
      historyOnly: 0,
      failed: 0,
    };
  }

  const candidates = listAutoValuationCandidates().map((row) => ({
    id: row.id,
    interval: row.interval,
    lastDoneDateKey: row.lastAutoValuationAt
      ? toBerlinDateKey(row.lastAutoValuationAt)
      : null,
    lastAttemptDateKey: row.lastAutoValuationAttemptAt
      ? toBerlinDateKey(row.lastAutoValuationAttemptAt)
      : null,
  }));

  const due = selectDueProperties(
    candidates,
    clock.dateKey,
    MAX_AUTO_VALUATIONS_PER_RUN,
  );

  if (due.length === 0) {
    return {
      status: "success",
      message: "Keine fälligen Objekte.",
      processed: 0,
      written: 0,
      historyOnly: 0,
      failed: 0,
    };
  }

  const valuatorFactory =
    options.valuatorFactory ?? createDefaultPropertyValuator;
  const valuator = valuatorFactory(clock.dateKey);

  let processed = 0;
  let written = 0;
  let historyOnly = 0;
  let failed = 0;

  for (const candidate of due) {
    markAutoValuationAttempt(candidate.id, nowFn().toISOString());
    const result = await runPropertyValuation(candidate.id, {
      trigger: "auto",
      valuator,
      nowFn,
    });

    if (result.kind === "ok") {
      processed += 1;
      if (result.decision.action === "write") {
        written += 1;
      } else {
        historyOnly += 1;
      }
    } else if (result.code === "unauthorized") {
      return {
        status: "error",
        message: "ImmoAnalyse API-Key ungültig (401).",
        processed,
        written,
        historyOnly,
        failed: failed + 1,
      };
    } else if (result.code === "quota_exceeded") {
      return {
        status: "skipped",
        message: "ImmoAnalyse Kontingent erschöpft (402).",
        processed,
        written,
        historyOnly,
        failed,
      };
    } else {
      failed += 1;
    }

    const updatedQuota = evaluateAutoValuationQuota(getQuotaSnapshot(), nowIso);
    if (!updatedQuota.allowed) {
      break;
    }
  }

  return {
    status: "success",
    message: `${processed} bewertet (${written} übernommen, ${historyOnly} als Vorschlag)${
      failed > 0 ? `, ${failed} fehlgeschlagen` : ""
    }`,
    processed,
    written,
    historyOnly,
    failed,
  };
}
