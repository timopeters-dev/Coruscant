"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  RefreshCw,
} from "lucide-react";
import { BalanceBar } from "@/components/cockpit/balance-bar";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CockpitPageData } from "@/db/queries/cockpit";
import {
  computeNextAutoSyncDelayMs,
  resolveInitialLastAutoAttemptMs,
  resolveSkippedFreshReschedule,
  shouldRunAutoSyncOnVisibility,
} from "@/lib/domain/external-sync";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";

interface CockpitWorkspaceProps {
  data: CockpitPageData;
}

interface SyncBannerState {
  tone: "warning" | "info";
  message: string;
}

function formatIsoDateDE(isoDate: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!parts) return isoDate;
  return `${parts[3]}.${parts[2]}.${parts[1]}`;
}

function formatTimestampDE(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return isoTimestamp;
  }
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatDaysRemaining(daysRemaining: number): string {
  if (daysRemaining === 0) return "heute";
  if (daysRemaining === 1) return "in 1 Tag";
  if (daysRemaining > 1) return `in ${daysRemaining} Tagen`;
  const overdueDays = Math.abs(daysRemaining);
  return overdueDays === 1
    ? "seit 1 Tag überfällig"
    : `seit ${overdueDays} Tagen überfällig`;
}

export function CockpitWorkspace({ data }: CockpitWorkspaceProps) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [banner, setBanner] = useState<SyncBannerState | null>(null);
  const isSyncingRef = useRef(false);
  const lastAutoAttemptMsRef = useRef(0);
  const rescheduleAutoSyncRef = useRef<(() => void) | null>(null);

  const latestFetchedAt = data.latestSnapshot?.fetchedAt ?? null;

  const runSync = useCallback(
    async (mode: "manual" | "auto", bypassCooldown = false) => {
      if (isSyncingRef.current) return;

      if (mode === "auto") {
        if (!data.isBridgeConfigured || data.syncIntervalMinutes <= 0) {
          return;
        }
        const nowMs = Date.now();
        if (
          !bypassCooldown &&
          !shouldRunAutoSyncOnVisibility({
            lastAutoAttemptMs: lastAutoAttemptMsRef.current,
            intervalMinutes: data.syncIntervalMinutes,
            nowMs,
          })
        ) {
          return;
        }
        lastAutoAttemptMsRef.current = nowMs;
      } else {
        lastAutoAttemptMsRef.current = Date.now();
        setBanner(null);
      }

      isSyncingRef.current = true;
      setIsSyncing(true);

      try {
        const response = await fetch("/api/external/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          status?: "synced" | "skipped" | "offline_fallback" | "unconfigured";
          reason?: "fresh" | "disabled";
          message?: string;
          snapshot?: { fetchedAt: string } | null;
        };

        if (response.ok && payload.status === "synced") {
          setBanner(null);
          router.refresh();
          return;
        }

        if (payload.status === "skipped") {
          if (payload.reason === "fresh") {
            const skippedResolution = resolveSkippedFreshReschedule({
              snapshotFetchedAt: payload.snapshot?.fetchedAt ?? null,
              latestFetchedAt,
              intervalMinutes: data.syncIntervalMinutes,
            });
            lastAutoAttemptMsRef.current = skippedResolution.nextLastAttemptMs;
            if (skippedResolution.shouldRefresh) {
              router.refresh();
            }
          }
          return;
        }

        if (mode === "auto") {
          return;
        }

        const fallbackDate = payload.snapshot?.fetchedAt ?? latestFetchedAt;
        const reason =
          payload.message ??
          (payload.status === "unconfigured"
            ? "finanz_cockpit-Bridge ist noch nicht konfiguriert (FINANZ_COCKPIT_URL / EXTERNAL_SUMMARY_TOKEN)."
            : "finanz_cockpit aktuell nicht erreichbar.");
        const messageWithFallback = fallbackDate
          ? `${reason} Anzeige nutzt letzten Snapshot vom ${formatTimestampDE(fallbackDate)}.`
          : reason;

        setBanner({
          tone: payload.status === "unconfigured" ? "info" : "warning",
          message: messageWithFallback,
        });
      } catch {
        if (mode === "auto") {
          return;
        }
        setBanner({
          tone: "warning",
          message: latestFetchedAt
            ? `finanz_cockpit aktuell nicht erreichbar – Anzeige nutzt letzten Snapshot vom ${formatTimestampDE(latestFetchedAt)}.`
            : "finanz_cockpit aktuell nicht erreichbar.",
        });
      } finally {
        isSyncingRef.current = false;
        setIsSyncing(false);
        rescheduleAutoSyncRef.current?.();
      }
    },
    [
      data.isBridgeConfigured,
      data.syncIntervalMinutes,
      latestFetchedAt,
      router,
    ],
  );

  useEffect(() => {
    if (!data.isBridgeConfigured || data.syncIntervalMinutes <= 0) {
      return;
    }

    let active = true;
    let timerId: number | null = null;
    const intervalMs = data.syncIntervalMinutes * 60_000;

    lastAutoAttemptMsRef.current = resolveInitialLastAutoAttemptMs({
      currentLastAttemptMs: lastAutoAttemptMsRef.current,
      isSnapshotStale: data.isSnapshotStale,
      nextSyncAtMs: data.nextSyncAtMs,
      intervalMinutes: data.syncIntervalMinutes,
    });

    const scheduleTimer = (delayMs: number) => {
      if (!active) return;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        void runSync("auto", true);
      }, delayMs);
    };

    rescheduleAutoSyncRef.current = () => {
      const nextDelayMs = Math.max(
        0,
        lastAutoAttemptMsRef.current + intervalMs - Date.now(),
      );
      scheduleTimer(nextDelayMs);
    };

    const initialDelayMs = computeNextAutoSyncDelayMs({
      isSnapshotStale: data.isSnapshotStale,
      nextSyncAtMs: data.nextSyncAtMs,
      intervalMinutes: data.syncIntervalMinutes,
    });
    scheduleTimer(initialDelayMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void runSync("auto");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      rescheduleAutoSyncRef.current = null;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    data.isBridgeConfigured,
    data.isSnapshotStale,
    data.nextSyncAtMs,
    data.syncIntervalMinutes,
    runSync,
  ]);

  const {
    balance,
    barBreakdown,
    milestones,
    potDeadlines,
    topPots,
    latestSnapshot,
  } = data;
  const totalDeadlineIssues =
    potDeadlines.atRiskCount + potDeadlines.overdueCount;
  const netWorthClass =
    balance.netWorthCents >= 0
      ? "text-[var(--emerald)]"
      : "text-[var(--rose)]";
  const liabilitiesClass =
    balance.liabilitiesCents > 0
      ? "text-[var(--rose)]"
      : "text-[var(--text-primary)]";

  const externalNetWorthCents = latestSnapshot
    ? latestSnapshot.totalPersonalNetWorthCents
    : 0;
  const externalOverdraftCents = latestSnapshot
    ? Math.max(
        0,
        balance.personalExternalAssetsCents -
          latestSnapshot.totalPersonalNetWorthCents,
      )
    : 0;
  const personalCoruscantNetCents =
    balance.personalContractsAssetsCents -
    (balance.personalLiabilitiesCents - externalOverdraftCents);

  const hasModeledAssets =
    data.projectedAssetContractsCount > 0 || balance.propertiesValueCents > 0;
  const hasModeledLiabilities = data.projectedLiabilityContractsCount > 0;
  const hasModeledNetWorth = hasModeledAssets || hasModeledLiabilities;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Haushalts-Cockpit
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Konsolidierte Bilanz zum{" "}
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {formatIsoDateDE(data.asOfDate)}
            </span>
            {data.projectedContractsCount > 0 ? (
              <span className="ml-2 text-xs">
                · {data.projectedContractsCount}{" "}
                {data.projectedContractsCount === 1
                  ? "Vertrag fortgeschrieben"
                  : "Verträge fortgeschrieben"}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {latestSnapshot ? (
            <StatusBadge
              variant="calibrated"
              label="finanz_cockpit Geeicht"
              detail={formatTimestampDE(latestSnapshot.fetchedAt)}
            />
          ) : (
            <Badge
              variant="outline"
              className="border-[var(--border-sub)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]"
            >
              Kein Sync
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runSync("manual")}
            disabled={isSyncing}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span>{isSyncing ? "Synchronisiere…" : "finanz_cockpit Sync"}</span>
          </Button>
        </div>
      </div>

      {banner ? (
        <div
          role="status"
          className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
            banner.tone === "warning"
              ? "border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--text-primary)]"
              : "border-[var(--border-sub)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]"
          }`}
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]"
            aria-hidden="true"
          />
          <span>{banner.message}</span>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card
          className={
            hasModeledAssets
              ? "border-dashed border-[var(--border-sub)]"
              : undefined
          }
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardDescription>Aktiva</CardDescription>
              {hasModeledAssets ? <StatusBadge variant="modeled" /> : null}
            </div>
            <CardTitle className="tabular-nums text-2xl text-[var(--text-primary)]">
              {formatCentsDE(balance.totalAssetsCents)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular-nums text-xs text-[var(--text-secondary)]">
              Frei: {formatCentsDE(balance.freeAssetsCents)} · Gebunden:{" "}
              {formatCentsDE(balance.boundAssetsCents)}
            </p>
            {balance.conflictingLinkedPotsCents > 0 ? (
              <div className="mt-1.5 space-y-1">
                <StatusBadge
                  variant="calibration_warning"
                  label="Verknüpfung überschneidet sich"
                  detail={`${formatCentsDE(balance.conflictingLinkedPotsCents)} nicht mitgezählt`}
                />
              </div>
            ) : null}
            {balance.personalLinkedPotsCents > 0 ? (
              <p className="tabular-nums text-xs text-[var(--text-secondary)]">
                davon in persönlichen Konten geführt:{" "}
                {formatCentsDE(balance.personalLinkedPotsCents)}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card
          className={
            hasModeledLiabilities
              ? "border-dashed border-[var(--border-sub)]"
              : undefined
          }
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardDescription>Passiva</CardDescription>
              {hasModeledLiabilities ? <StatusBadge variant="modeled" /> : null}
            </div>
            <CardTitle className={`tabular-nums text-2xl ${liabilitiesClass}`}>
              {formatCentsDE(balance.liabilitiesCents)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular-nums text-xs text-[var(--text-secondary)]">
              Haushalt: {formatCentsDE(balance.householdLiabilitiesCents)} ·
              Privat: {formatCentsDE(balance.personalLiabilitiesCents)}
            </p>
          </CardContent>
        </Card>

        <Card
          className={
            hasModeledNetWorth
              ? "border-dashed border-[var(--border-sub)]"
              : undefined
          }
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardDescription>Nettovermögen</CardDescription>
              {hasModeledNetWorth ? <StatusBadge variant="modeled" /> : null}
            </div>
            <CardTitle className={`tabular-nums text-2xl ${netWorthClass}`}>
              {formatCentsDE(balance.netWorthCents)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular-nums text-xs text-[var(--text-secondary)]">
              Haushalt: {formatCentsDE(balance.householdNetWorthCents)} ·
              finanz_cockpit: {formatCentsDE(externalNetWorthCents)}
              {personalCoruscantNetCents !== 0
                ? ` · Privat-Verträge: ${formatCentsDE(personalCoruscantNetCents, { showPlusSign: true })}`
                : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      <BalanceBar breakdown={barBreakdown} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Nächste Meilensteine</CardTitle>
              <CardDescription>
                Aktive Verträge &amp; Zinsbindungen (max. 5)
              </CardDescription>
            </div>
            <Link
              href="/vertraege"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              <span>Alle Verträge</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent>
            {milestones.items.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 px-4 py-6 text-xs text-[var(--text-secondary)]">
                <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Keine anstehenden Meilensteine oder Zinsbindungsenden bei
                  aktiven Verträgen hinterlegt.
                </span>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {milestones.items.map((item) => (
                  <li
                    key={`${item.contractId}-${item.kind}-${item.date}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 px-3.5 py-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {item.label}
                        </span>
                        <Badge
                          variant="outline"
                          className="border-[var(--border-sub)] text-[10px] text-[var(--text-secondary)]"
                        >
                          {item.kind === "fixed_interest_end"
                            ? "Zinsbindungsende"
                            : "Meilenstein"}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-[var(--text-secondary)]">
                        {item.contractName}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="tabular-nums text-xs font-semibold text-[var(--text-primary)]">
                        {formatIsoDateDE(item.date)}
                      </div>
                      {item.isOverdue ? (
                        <Badge
                          variant="outline"
                          className="mt-1 border-[var(--amber)]/40 bg-[var(--amber)]/10 tabular-nums text-[10px] text-[var(--amber)]"
                        >
                          Überfällig
                        </Badge>
                      ) : (
                        <div className="mt-0.5 tabular-nums text-[11px] text-[var(--text-secondary)]">
                          {formatDaysRemaining(item.daysRemaining)}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {totalDeadlineIssues > 0 && potDeadlines.worst ? (
              <Link
                href="/allokation"
                className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--amber)]/45 bg-[var(--amber)]/5 px-3.5 py-2.5 text-xs transition-colors hover:bg-[var(--amber)]/10"
              >
                <div className="flex flex-wrap items-center gap-2 text-[var(--text-primary)]">
                  <StatusBadge variant="modeled" />
                  <span className="tabular-nums">
                    Topf „{potDeadlines.worst.potName}“: Termin{" "}
                    {`${potDeadlines.worst.targetMonth.slice(5, 7)}/${potDeadlines.worst.targetMonth.slice(0, 4)}`}{" "}
                    {potDeadlines.worst.status === "overdue"
                      ? "verstrichen"
                      : "voraussichtlich nicht erreichbar"}{" "}
                    · Fehlbetrag{" "}
                    {formatCentsDE(
                      potDeadlines.worst.status === "overdue"
                        ? potDeadlines.worst.shortfallNowCents
                        : potDeadlines.worst.shortfallAtDeadlineCents,
                    )}
                    {totalDeadlineIssues > 1
                      ? ` (+${totalDeadlineIssues - 1} weitere)`
                      : ""}
                  </span>
                </div>
                <ArrowRight
                  className="h-3.5 w-3.5 shrink-0 text-[var(--amber)]"
                  aria-hidden="true"
                />
              </Link>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Top-3-Topf-Fortschritte</CardTitle>
              <CardDescription>
                Nach Wasserfall-Priorität sortiert
              </CardDescription>
            </div>
            <Link
              href="/allokation"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              <span>Wasserfall &amp; Töpfe</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent>
            {topPots.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 px-4 py-6 text-xs text-[var(--text-secondary)]">
                Noch keine Ziel-Töpfe angelegt. Lege unter „Cashflow &amp;
                Wasserfall“ priorisierte Rücklagen-Töpfe an.
              </div>
            ) : (
              <ul className="space-y-3">
                {topPots.map((pot, index) => (
                  <li
                    key={pot.id}
                    className="space-y-2 rounded-lg border border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 px-3.5 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge
                          variant="outline"
                          className="tabular-nums border-[var(--border-sub)] text-[10px] text-[var(--text-secondary)]"
                        >
                          #{index + 1}
                        </Badge>
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {pot.name}
                        </span>
                      </div>
                      <span className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">
                        {pot.cappedProgressBps !== null
                          ? formatBpsDE(pot.cappedProgressBps)
                          : "Ohne Zielwert"}
                      </span>
                    </div>

                    {pot.cappedProgressBps !== null ? (
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                        <div
                          className={`h-full rounded-full transition-all ${
                            pot.isTargetReached
                              ? "bg-[var(--emerald)]"
                              : "bg-[var(--accent)]"
                          }`}
                          style={{ width: `${pot.cappedProgressBps / 100}%` }}
                        />
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                      <span className="tabular-nums">
                        Stand: {formatCentsDE(pot.currentCents)}
                      </span>
                      <span className="tabular-nums">
                        {pot.targetCents !== null
                          ? `Ziel: ${formatCentsDE(pot.targetCents)}`
                          : "Fortlaufend"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
