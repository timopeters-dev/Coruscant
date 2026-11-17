export const DEFAULT_FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES = 15;
export const MAX_FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES = 10_080;
export const MIN_CLOCK_SKEW_RETRY_DELAY_MS = 5_000;

export type SnapshotFreshnessStatus =
  | "disabled"
  | "missing"
  | "stale"
  | "fresh";

export interface SnapshotFreshnessEvaluation {
  status: SnapshotFreshnessStatus;
  shouldSync: boolean;
  ageMs: number | null;
  nextSyncAtMs: number | null;
}

export interface EvaluateSnapshotFreshnessInput {
  latestFetchedAt: string | null;
  intervalMinutes: number;
  now?: Date | string | number;
}

function resolveNowMs(now: Date | string | number | undefined): number {
  if (now === undefined) {
    return Date.now();
  }
  const ms =
    now instanceof Date
      ? now.getTime()
      : typeof now === "number"
        ? now
        : Date.parse(now);

  if (!Number.isFinite(ms)) {
    throw new Error("Ungültiger Referenzzeitpunkt (now) für Freshness-Prüfung.");
  }
  return ms;
}

/**
 * Evaluates whether the latest external snapshot is stale and should be synced.
 */
export function evaluateSnapshotFreshness(
  input: EvaluateSnapshotFreshnessInput,
): SnapshotFreshnessEvaluation {
  const { latestFetchedAt, intervalMinutes } = input;

  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 0 ||
    intervalMinutes > MAX_FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES
  ) {
    throw new Error(
      `intervalMinutes muss eine Ganzzahl zwischen 0 und ${MAX_FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES} sein.`,
    );
  }

  if (intervalMinutes === 0) {
    return {
      status: "disabled",
      shouldSync: false,
      ageMs: null,
      nextSyncAtMs: null,
    };
  }

  if (latestFetchedAt === null || latestFetchedAt.trim() === "") {
    return {
      status: "missing",
      shouldSync: true,
      ageMs: null,
      nextSyncAtMs: null,
    };
  }

  const fetchedAtMs = Date.parse(latestFetchedAt);
  if (Number.isNaN(fetchedAtMs)) {
    return {
      status: "stale",
      shouldSync: true,
      ageMs: null,
      nextSyncAtMs: null,
    };
  }

  const nowMs = resolveNowMs(input.now);
  const ageMs = Math.max(0, nowMs - fetchedAtMs);
  const intervalMs = intervalMinutes * 60_000;

  if (ageMs >= intervalMs) {
    return {
      status: "stale",
      shouldSync: true,
      ageMs,
      nextSyncAtMs: null,
    };
  }

  return {
    status: "fresh",
    shouldSync: false,
    ageMs,
    nextSyncAtMs: fetchedAtMs + intervalMs,
  };
}

export interface ComputeNextAutoSyncDelayInput {
  isSnapshotStale: boolean;
  nextSyncAtMs: number | null;
  intervalMinutes: number;
  nowMs?: number;
}

/**
 * Computes the delay in milliseconds until the next automatic sync attempt.
 */
export function computeNextAutoSyncDelayMs(
  input: ComputeNextAutoSyncDelayInput,
): number {
  const { isSnapshotStale, nextSyncAtMs, intervalMinutes, nowMs = Date.now() } =
    input;

  if (intervalMinutes <= 0) {
    return 0;
  }

  if (isSnapshotStale) {
    return 0;
  }

  if (nextSyncAtMs !== null) {
    return Math.max(0, nextSyncAtMs - nowMs);
  }

  return intervalMinutes * 60_000;
}

export interface ResolveInitialLastAutoAttemptInput {
  currentLastAttemptMs: number;
  isSnapshotStale: boolean;
  nextSyncAtMs: number | null;
  intervalMinutes: number;
}

/**
 * Seeds lastAutoAttemptMs from a fresh snapshot's nextSyncAtMs so visibility
 * changes before nextSyncAtMs respect the remaining cooldown window.
 */
export function resolveInitialLastAutoAttemptMs(
  input: ResolveInitialLastAutoAttemptInput,
): number {
  const {
    currentLastAttemptMs,
    isSnapshotStale,
    nextSyncAtMs,
    intervalMinutes,
  } = input;

  if (intervalMinutes <= 0 || isSnapshotStale || nextSyncAtMs === null) {
    return currentLastAttemptMs;
  }

  const intervalMs = intervalMinutes * 60_000;
  return Math.max(currentLastAttemptMs, nextSyncAtMs - intervalMs);
}

export interface ShouldRunAutoSyncOnVisibilityInput {
  lastAutoAttemptMs: number;
  intervalMinutes: number;
  nowMs?: number;
}

/**
 * Returns true when enough time has elapsed since the last auto-sync attempt
 * to allow a visibility-triggered re-check.
 */
export function shouldRunAutoSyncOnVisibility(
  input: ShouldRunAutoSyncOnVisibilityInput,
): boolean {
  const { lastAutoAttemptMs, intervalMinutes, nowMs = Date.now() } = input;
  if (intervalMinutes <= 0) {
    return false;
  }
  const intervalMs = intervalMinutes * 60_000;
  return nowMs - lastAutoAttemptMs >= intervalMs;
}

export interface ResolveSkippedFreshRescheduleInput {
  snapshotFetchedAt: string | null;
  latestFetchedAt: string | null;
  intervalMinutes: number;
  nowMs?: number;
  minBackoffMs?: number;
}

export interface SkippedFreshRescheduleResult {
  shouldRefresh: boolean;
  nextDelayMs: number;
  nextLastAttemptMs: number;
}

/**
 * Computes UI refresh and next timer delay when the server skips an auto-sync
 * because the latest DB snapshot is still fresh (e.g. timer jitter, clock skew,
 * or another tab synced more recently).
 */
export function resolveSkippedFreshReschedule(
  input: ResolveSkippedFreshRescheduleInput,
): SkippedFreshRescheduleResult {
  const {
    snapshotFetchedAt,
    latestFetchedAt,
    intervalMinutes,
    nowMs = Date.now(),
    minBackoffMs = MIN_CLOCK_SKEW_RETRY_DELAY_MS,
  } = input;

  const shouldRefresh = Boolean(
    snapshotFetchedAt && snapshotFetchedAt !== latestFetchedAt,
  );
  const intervalMs = Math.max(0, intervalMinutes * 60_000);

  if (snapshotFetchedAt) {
    const fetchedAtMs = Date.parse(snapshotFetchedAt);
    if (Number.isFinite(fetchedAtMs)) {
      const targetSyncAtMs = fetchedAtMs + intervalMs;
      const nextDelayMs = Math.max(minBackoffMs, targetSyncAtMs - nowMs);
      const nextLastAttemptMs = nowMs + nextDelayMs - intervalMs;
      return {
        shouldRefresh,
        nextDelayMs,
        nextLastAttemptMs,
      };
    }
  }

  return {
    shouldRefresh,
    nextDelayMs: intervalMs,
    nextLastAttemptMs: nowMs,
  };
}
