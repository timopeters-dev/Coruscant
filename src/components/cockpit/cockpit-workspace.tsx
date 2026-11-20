"use client";

import { formatDateDE, formatDateTimeDE, formatMonthDE } from "@/lib/domain/date-format";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  FileText,
  RefreshCw,
} from "lucide-react";
import { AdvisorReportDialog } from "@/components/bericht/advisor-report-dialog";
import { BalanceBar } from "@/components/cockpit/balance-bar";
import { BalanceHistoryDrawer } from "@/components/cockpit/balance-history-drawer";
import { cockpitHistoryRangeStore } from "@/components/cockpit/history-range-store";
import { NetWorthHistoryCard } from "@/components/cockpit/net-worth-history-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CARD_SURFACE,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CockpitPageData } from "@/db/queries/cockpit";
import { cn } from "@/lib/utils";
import {
  computeComponentDeltas,
  filterHistoryByRange,
  markHistoryGaps,
  summarizeHistoryRange,
  thinHistory,
  type HistoryRangeId,
} from "@/lib/domain/balance-history";
import {
  computeNextAutoSyncDelayMs,
  resolveInitialLastAutoAttemptMs,
  resolveSkippedFreshReschedule,
  shouldRunAutoSyncOnVisibility,
} from "@/lib/domain/external-sync";
import type { AdvisorReportOutlineItem } from "@/lib/domain/advisor-report";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";

interface CockpitWorkspaceProps {
  data: CockpitPageData;
  advisorOutline?: readonly AdvisorReportOutlineItem[];
}

interface SyncBannerState {
  tone: "warning" | "info";
  message: string;
}

const formatIsoDateDE = formatDateDE;
const formatTimestampDE = (isoTimestamp: string) => formatDateTimeDE(isoTimestamp);

function formatDaysRemaining(daysRemaining: number): string {
  if (daysRemaining === 0) return "heute";
  if (daysRemaining === 1) return "in 1 Tag";
  if (daysRemaining > 1) return `in ${daysRemaining} Tagen`;
  const overdueDays = Math.abs(daysRemaining);
  return overdueDays === 1
    ? "seit 1 Tag überfällig"
    : `seit ${overdueDays} Tagen überfällig`;
}

/** Ein Glied der Bilanzgleichung: Bezeichnung, Betrag, optionale Details. */
function BalanceTerm({
  label,
  valueCents,
  valueClassName,
  modeled,
  emphasis = false,
  children,
}: {
  label: string;
  valueCents: number;
  valueClassName?: string;
  modeled: boolean;
  emphasis?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] [font-family:var(--font-sans)]">
          {label}
        </h2>
        {modeled ? <StatusBadge variant="modeled" /> : null}
      </div>
      <p
        className={cn(
          "figure mt-1.5 text-[var(--text-primary)]",
          emphasis
            ? "text-[2.5rem] leading-[2.875rem] sm:text-[2.75rem] sm:leading-[3.125rem]"
            : "text-[2rem] leading-10",
          valueClassName,
        )}
      >
        {formatCentsDE(valueCents)}
      </p>
      {children ? <div className="mt-2.5 space-y-1.5">{children}</div> : null}
    </div>
  );
}

/** Rechenzeichen zwischen den Gliedern – auf schmalen Schirmen als Trennlinie. */
function BalanceOperator({ symbol, label }: { symbol: string; label: string }) {
  return (
    <div
      className="flex items-center gap-3 md:flex-col md:items-center md:pt-5"
      aria-label={label}
      role="img"
    >
      <span className="h-px flex-1 bg-[var(--border)] md:hidden" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="font-[family-name:var(--font-display)] text-xl font-medium leading-6 text-[var(--text-muted)] md:text-[2rem] md:leading-10"
      >
        {symbol}
      </span>
      <span className="h-px flex-1 bg-[var(--border)] md:hidden" aria-hidden="true" />
    </div>
  );
}

export function CockpitWorkspace({
  data,
  advisorOutline = [],
}: CockpitWorkspaceProps) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [advisorDialogOpen, setAdvisorDialogOpen] = useState(false);
  const [banner, setBanner] = useState<SyncBannerState | null>(null);
  const isSyncingRef = useRef(false);
  const lastAutoAttemptMsRef = useRef(0);
  const rescheduleAutoSyncRef = useRef<(() => void) | null>(null);

  const latestFetchedAt = data.latestSnapshotFetchedAt;

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
    latestSnapshotFetchedAt,
    history,
  } = data;

  const range = useSyncExternalStore(
    cockpitHistoryRangeStore.subscribe,
    cockpitHistoryRangeStore.getSnapshot,
    cockpitHistoryRangeStore.getServerSnapshot,
  );
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  const handleRangeChange = useCallback((next: HistoryRangeId) => {
    cockpitHistoryRangeStore.setRange(next);
  }, []);

  const historyView = useMemo(() => {
    const filtered = filterHistoryByRange(history, range, data.asOfDate);
    const marked = markHistoryGaps(filtered.points);
    const thinned = thinHistory(marked);
    const summary = summarizeHistoryRange(marked);
    const deltas = computeComponentDeltas(
      {
        freeAssetsCents: barBreakdown.freeCents,
        boundAssetsCents: barBreakdown.boundCents,
        liabilitiesCents: barBreakdown.liabilitiesCents,
      },
      summary.first,
      data.asOfDate,
    );
    return {
      fromIso: filtered.from,
      rawPoints: marked,
      points: thinned,
      summary,
      deltas,
    };
  }, [
    history,
    range,
    data.asOfDate,
    barBreakdown.freeCents,
    barBreakdown.boundCents,
    barBreakdown.liabilitiesCents,
  ]);
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

  const hasModeledAssets =
    data.projectedAssetContractsCount > 0 || balance.propertiesValueCents > 0;
  const hasModeledLiabilities = data.projectedLiabilityContractsCount > 0;
  const hasModeledNetWorth = hasModeledAssets || hasModeledLiabilities;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="page-title">
            Haushalts-Cockpit
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Konsolidierte Bilanz zum{" "}
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {formatIsoDateDE(data.asOfDate)}
            </span>
            {data.projectedContractsCount > 0 ? (
              <span className="ml-2 border-l border-[var(--border-sub)] pl-2 text-xs">
                {data.projectedContractsCount}{" "}
                {data.projectedContractsCount === 1
                  ? "Vertrag fortgeschrieben"
                  : "Verträge fortgeschrieben"}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdvisorDialogOpen(true)}
            className="print:hidden"
          >
            <FileText className="h-4 w-4" />
            Berater-Bericht
          </Button>
          {latestSnapshotFetchedAt ? (
            <StatusBadge
              variant="calibrated"
              label="finanz_cockpit Geeicht"
              detail={formatTimestampDE(latestSnapshotFetchedAt)}
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

      <section
        aria-label="Bilanz"
        className={cn(
          CARD_SURFACE,
          "grid gap-y-3 p-5 sm:p-6 md:gap-y-5 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.15fr)] md:gap-x-6",
          hasModeledNetWorth && "border-dashed border-[var(--border-sub)]",
        )}
      >
        <BalanceTerm
          label="Aktiva"
          valueCents={balance.totalAssetsCents}
          modeled={hasModeledAssets}
        >
            <p className="tabular-nums text-xs text-[var(--text-secondary)]">
            Frei: {formatCentsDE(balance.freeAssetsCents)} · Gebunden:{" "}
            {formatCentsDE(balance.boundAssetsCents)}
          </p>
          {data.rentalPortfolioHint ? (
            <p className="mt-1.5 tabular-nums text-xs text-[var(--text-secondary)]">
              <Link
                href="/vertraege?tab=portfolio"
                className="underline decoration-[var(--border-sub)] underline-offset-4 hover:text-[var(--text-primary)] hover:decoration-[var(--text-primary)]"
              >
                Portfolio: {data.rentalPortfolioHint.propertyCount}{" "}
                {data.rentalPortfolioHint.propertyCount === 1
                  ? "Mietobjekt"
                  : "Mietobjekte"}{" "}
                · Cashflow{" "}
                {formatCentsDE(
                  data.rentalPortfolioHint.netCashflowBeforeReserveCents,
                  { showPlusSign: true },
                )}
                /Monat (Modelliert)
              </Link>
            </p>
          ) : null}
          {balance.conflictingLinkedPotsCents > 0 ? (
            <div className="mt-1.5 space-y-1">
              <StatusBadge
                variant="calibration_warning"
                label="Verknüpfung überschneidet sich"
                detail={`${formatCentsDE(balance.conflictingLinkedPotsCents)} nicht mitgezählt`}
              />
            </div>
          ) : null}
          {balance.outOfScopeLinkedPotsCents > 0 ? (
            <div className="mt-1.5 space-y-1">
              <StatusBadge
                variant="calibration_warning"
                label="Kopplung außerhalb des Haushalts"
                detail={`${formatCentsDE(balance.outOfScopeLinkedPotsCents)} nicht mitgezählt`}
              />
            </div>
          ) : null}
        </BalanceTerm>

        <BalanceOperator symbol="−" label="minus" />

        <BalanceTerm
          label="Passiva"
          valueCents={balance.liabilitiesCents}
          valueClassName={liabilitiesClass}
          modeled={hasModeledLiabilities}
        />

        <BalanceOperator symbol="=" label="ergibt" />

        <BalanceTerm
          label="Nettovermögen"
          valueCents={balance.netWorthCents}
          valueClassName={netWorthClass}
          modeled={hasModeledNetWorth}
          emphasis
        />
      </section>

      <NetWorthHistoryCard
        totalCount={history.length}
        singlePoint={history.length === 1 ? (history[0] ?? null) : null}
        points={historyView.points}
        summary={historyView.summary}
        range={range}
        fromIso={historyView.fromIso}
        todayIso={data.asOfDate}
        onRangeChange={handleRangeChange}
      />

      <BalanceBar
        breakdown={barBreakdown}
        deltas={historyView.deltas}
        onShowDetails={
          historyView.summary.count >= 2
            ? () => setHistoryDrawerOpen(true)
            : undefined
        }
      />

      <BalanceHistoryDrawer
        open={historyDrawerOpen}
        onOpenChange={setHistoryDrawerOpen}
        points={historyView.points}
        rawPoints={historyView.rawPoints}
        summary={historyView.summary}
        range={range}
        fromIso={historyView.fromIso}
        todayIso={data.asOfDate}
      />

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
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-[var(--text-primary)] underline decoration-[var(--border-sub)] underline-offset-4 hover:decoration-[var(--text-primary)]"
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
              <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {milestones.items.map((item) => (
                  <li
                    key={`${item.contractId}-${item.kind}-${item.date}`}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {item.label}
                        </span>
                        {(() => {
                          const kindLabel =
                            item.kind === "fixed_interest_end"
                              ? "Zinsbindungsende"
                              : "Meilenstein";
                          return kindLabel === item.label ? null : (
                            <Badge
                              variant="outline"
                              className="border-[var(--border-sub)] text-3xs text-[var(--text-secondary)]"
                            >
                              {kindLabel}
                            </Badge>
                          );
                        })()}
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
                          className="mt-1 border-[var(--amber)]/40 bg-[var(--amber)]/10 tabular-nums text-3xs text-[var(--amber)]"
                        >
                          Überfällig
                        </Badge>
                      ) : (
                        <div className="mt-0.5 tabular-nums text-2xs text-[var(--text-secondary)]">
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
                    {formatMonthDE(potDeadlines.worst.targetMonth)}{" "}
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
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-[var(--text-primary)] underline decoration-[var(--border-sub)] underline-offset-4 hover:decoration-[var(--text-primary)]"
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
              <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {topPots.map((pot, index) => (
                  <li
                    key={pot.id}
                    className="space-y-2 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="figure w-4 shrink-0 text-base text-[var(--text-muted)]"
                          aria-label={`Priorität ${index + 1}`}
                        >
                          {index + 1}
                        </span>
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
                      <div className="meter h-2 w-full overflow-hidden">
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

                    <div className="flex items-center justify-between text-2xs text-[var(--text-secondary)]">
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
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <AdvisorReportDialog
        open={advisorDialogOpen}
        onOpenChange={setAdvisorDialogOpen}
        outline={advisorOutline}
      />
    </div>
  );
}
