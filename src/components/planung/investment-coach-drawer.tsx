"use client";

import * as React from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import type { RebalancingPlan } from "@/lib/domain/coach-rebalancing";
import {
  serializeInvestmentContext,
  withSavingsRate,
  type InvestmentContext,
} from "@/lib/domain/investment-context";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import {
  MAX_COACH_CHAT_MESSAGE_LENGTH,
  MAX_COACH_REQUEST_MESSAGES,
  MAX_COACH_SAVINGS_RATE_CENTS,
  type CoachAssessment,
  type CoachChatMessage,
  type CoachChatReply,
} from "@/lib/validation/coach";
import { cn } from "@/lib/utils";
import { ASSET_CLASS_LABELS, describeRef, formatMonthsDE } from "./coach-labels";
import { SliderField } from "./euro-slider-field";

interface InvestmentCoachDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: InvestmentContext;
  refLabels: Record<string, string>;
}

type Tab = "assessment" | "chat";

interface AssessmentResponse {
  assessment: CoachAssessment;
  rebalancingPlan: RebalancingPlan | null;
  model: string;
  contextJson: string;
}

type ChatEntry = CoachChatMessage & { declined?: boolean };

const ERROR_TEXT_BY_CODE: Record<string, string> = {
  not_configured: "KI nicht konfiguriert (GEMINI_API_KEY fehlt).",
  timeout: "Die KI hat nicht rechtzeitig geantwortet. Bitte später erneut versuchen.",
  http_error: "Die KI-Schnittstelle meldet einen Fehler. Bitte später erneut versuchen.",
  network_error: "Die KI ist gerade nicht erreichbar. Bitte später erneut versuchen.",
  invalid_payload: "Die KI-Antwort war nicht nutzbar. Bitte erneut versuchen.",
  coach_context_unavailable:
    "Keine Depot-Positionen im letzten Sync – Coach nicht verfügbar.",
};

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: string; error?: string };
    if (body.code && ERROR_TEXT_BY_CODE[body.code]) {
      return ERROR_TEXT_BY_CODE[body.code]!;
    }
    if (body.error) return body.error;
  } catch {
    // ignore
  }
  return "Anfrage fehlgeschlagen.";
}

const SEVERITY_LABEL = { low: "gering", medium: "mittel", high: "hoch" } as const;
const FIT_LABEL = {
  fits: "passt",
  tension: "Spannung",
  mismatch: "passt nicht",
} as const;

const REASON_TEXT = {
  requires_sale:
    "Ohne Verkauf nicht erreichbar – das Soll setzt voraus, Bestände zu verkaufen.",
  no_savings_rate: "Ohne Sparrate nicht erreichbar.",
  too_long: "Über die Sparrate würde das länger als 50 Jahre dauern.",
} as const;

function AiPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-solid border-[var(--amber)]/40 bg-[var(--amber)]/5 p-4",
        className,
      )}
    >
      {children}
    </section>
  );
}

function RebalancingTable({ plan }: { plan: RebalancingPlan }) {
  const { contributionOnly } = plan;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Mögliche Umschichtung</h4>
        <StatusBadge variant="modeled" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="bg-[var(--surface-elevated)] text-left text-xs text-[var(--text-secondary)]">
              <th className="px-2 py-1.5 font-medium">Klasse</th>
              <th className="px-2 py-1.5 text-right font-medium">Ist %</th>
              <th className="px-2 py-1.5 text-right font-medium">Soll %</th>
              <th className="px-2 py-1.5 text-right font-medium">Δ €</th>
              {contributionOnly.status === "ok" ? (
                <th className="px-2 py-1.5 text-right font-medium">Sparrate/Monat</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {plan.classes.map((c) => (
              <tr key={c.assetClass} className="border-t border-[var(--border)]">
                <td className="px-2 py-2">{ASSET_CLASS_LABELS[c.assetClass]}</td>
                <td className="px-2 py-2 text-right">{formatBpsDE(c.currentWeightBps)}</td>
                <td className="px-2 py-2 text-right">{formatBpsDE(c.targetWeightBps)}</td>
                <td className="px-2 py-2 text-right">
                  {formatCentsDE(c.deltaCents, { showPlusSign: true })}
                </td>
                {contributionOnly.status === "ok" ? (
                  <td className="px-2 py-2 text-right">
                    {formatCentsDE(plan.contributionSplitCents[c.assetClass])}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        {contributionOnly.status === "ok"
          ? contributionOnly.monthsNeeded === 0
            ? "Bereits im Soll – es ist keine Umschichtung nötig."
            : `Nur über die Sparrate (ohne Verkauf, ohne Kursentwicklung): ca. ${formatMonthsDE(contributionOnly.monthsNeeded)} und ${formatCentsDE(contributionOnly.requiredContributionCents)} Zukäufe.`
          : REASON_TEXT[contributionOnly.reason]}
      </p>
    </div>
  );
}

export function InvestmentCoachDrawer({
  open,
  onOpenChange,
  context,
  refLabels,
}: InvestmentCoachDrawerProps) {
  const [tab, setTab] = React.useState<Tab>("assessment");
  const [savingsRate, setSavingsRate] = React.useState(
    context.cashflow.monthlySavingsRateCents,
  );
  const [assessment, setAssessment] = React.useState<AssessmentResponse | null>(null);
  const [assessmentLoading, setAssessmentLoading] = React.useState(false);
  const [assessmentError, setAssessmentError] = React.useState<string | null>(null);

  const [messages, setMessages] = React.useState<ChatEntry[]>([]);
  const [followUps, setFollowUps] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState("");
  const [chatLoading, setChatLoading] = React.useState(false);
  const [chatError, setChatError] = React.useState<string | null>(null);

  // Zuletzt tatsächlich an die KI gesendeter Kontext (vom Server gebaut).
  const [sentContextJson, setSentContextJson] = React.useState<string | null>(null);

  const effectiveRate =Math.min(Math.max(0, savingsRate), MAX_COACH_SAVINGS_RATE_CENTS);
  const previewJson = React.useMemo(
    () => serializeInvestmentContext(withSavingsRate(context, effectiveRate)),
    [context, effectiveRate],
  );

  async function requestAssessment() {
    setAssessmentLoading(true);
    setAssessmentError(null);
    try {
      const response = await fetch("/api/coach/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlySavingsRateCents: effectiveRate }),
      });
      if (!response.ok) {
        setAssessmentError(await readError(response));
        return;
      }
      const body = (await response.json()) as AssessmentResponse;
      setAssessment(body);
      setSentContextJson(body.contextJson);
    } catch {
      setAssessmentError(ERROR_TEXT_BY_CODE.network_error!);
    } finally {
      setAssessmentLoading(false);
    }
  }

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (text.length === 0 || chatLoading) return;
    const next: ChatEntry[] = [...messages, { role: "user", text }];
    setMessages(next);
    setDraft("");
    setFollowUps([]);
    setChatLoading(true);
    setChatError(null);
    try {
      const response = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlySavingsRateCents: effectiveRate,
          messages: next
            .slice(-MAX_COACH_REQUEST_MESSAGES)
            .map(({ role, text: t }) => ({ role, text: t })),
        }),
      });
      if (!response.ok) {
        setChatError(await readError(response));
        return;
      }
      const body = (await response.json()) as {
        reply: CoachChatReply;
        contextJson?: string;
      };
      if (body.contextJson) setSentContextJson(body.contextJson);
      setMessages([
        ...next,
        {
          role: "coach",
          text: body.reply.answer,
          declined: body.reply.declinedSecurityAdvice,
        },
      ]);
      setFollowUps(body.reply.followUpQuestions);
    } catch {
      setChatError(ERROR_TEXT_BY_CODE.network_error!);
    } finally {
      setChatLoading(false);
    }
  }

  const result = assessment?.assessment ?? null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Investment-Coach"
      subtitle="Einordnung zu Lernzwecken – keine Anlageberatung."
      className="max-w-xl"
    >
      <div className="flex flex-col gap-5">
        <SliderField
          id="coach-savings-rate"
          label="Monatliche Sparrate (Modelliert)"
          kind="euro"
          value={effectiveRate}
          min={0}
          max={200_000}
          step={5_000}
          onChange={setSavingsRate}
          hint="Vorbelegt mit deinem Überschuss aus /allokation."
        />

        <div role="tablist" aria-label="Coach-Bereiche" className="flex gap-1 border-b border-[var(--border)]">
          {(
            [
              ["assessment", "Bewertung"],
              ["chat", "Fragen"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === id
                  ? "border-[var(--accent)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "assessment" ? (
          <div role="tabpanel" className="flex flex-col gap-4">
            <div>
              <Button onClick={requestAssessment} disabled={assessmentLoading}>
                {assessmentLoading ? "Coach denkt nach …" : "Bewertung anfordern"}
              </Button>
            </div>

            {assessmentError ? (
              <p role="alert" className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
                {assessmentError}
              </p>
            ) : null}

            {result ? (
              <AiPanel>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Einordnung</h3>
                  <StatusBadge variant="ai_suggestion" detail={assessment?.model} />
                </div>
                <p className="text-sm">{result.summary}</p>

                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                    Stärken
                  </h4>
                  <ul className="flex flex-col gap-2 text-sm">
                    {result.strengths.map((s) => (
                      <li key={s.title}>
                        <span className="font-medium">{s.title}.</span> {s.detail}
                      </li>
                    ))}
                  </ul>
                </div>

                {result.risks.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      Risiken
                    </h4>
                    <ul className="flex flex-col gap-2 text-sm">
                      {result.risks.map((r) => (
                        <li key={r.title} className="flex flex-col gap-1">
                          <span>
                            <span className="font-medium">{r.title}</span>{" "}
                            <span className="rounded-md border border-[var(--border-sub)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
                              {SEVERITY_LABEL[r.severity]}
                            </span>
                          </span>
                          <span>{r.detail}</span>
                          {r.relatedRefs.length > 0 ? (
                            <span className="text-xs text-[var(--text-secondary)]">
                              Betrifft:{" "}
                              {r.relatedRefs
                                .map((ref) => describeRef(ref, context, refLabels))
                                .join(", ")}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {result.horizonCheck.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      Zeithorizont-Check
                    </h4>
                    <ul className="flex flex-col gap-2 text-sm">
                      {result.horizonCheck.map((h) => (
                        <li key={h.ref} className="flex flex-col gap-0.5">
                          <span className="font-medium tabular-nums">
                            {describeRef(h.ref, context, refLabels)}{" "}
                            <span className="text-xs font-normal text-[var(--text-secondary)]">
                              ({FIT_LABEL[h.fit]})
                            </span>
                          </span>
                          <span>{h.explanation}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {result.rebalancing ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm">{result.rebalancing.rationale}</p>
                    {assessment?.rebalancingPlan ? (
                      <RebalancingTable plan={assessment.rebalancingPlan} />
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">
                    Kein Handlungsbedarf bei der Aufteilung.
                  </p>
                )}

                {result.glossary.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      Glossar
                    </h4>
                    <dl className="flex flex-col gap-1.5 text-sm">
                      {result.glossary.map((g) => (
                        <div key={g.term}>
                          <dt className="inline font-medium">{g.term}: </dt>
                          <dd className="inline">{g.explanation}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
              </AiPanel>
            ) : null}
          </div>
        ) : (
          <div role="tabpanel" className="flex flex-col gap-4">
            {messages.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Stelle eine Frage zu deiner Aufteilung, zu Begriffen oder zu deinen Zielen.
                Der Verlauf bleibt nur in diesem Fenster.
              </p>
            ) : (
              <ul className="flex flex-col gap-3" aria-live="polite">
                {messages.map((m, index) => (
                  <li
                    key={index}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm",
                      m.role === "user"
                        ? "self-end border-[var(--border)] bg-[var(--surface-elevated)]"
                        : "border-solid border-[var(--amber)]/40 bg-[var(--amber)]/5",
                    )}
                  >
                    {m.role === "coach" ? (
                      <div className="mb-1">
                        <StatusBadge variant="ai_suggestion" />
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.declined ? (
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        Zu einzelnen Titeln gibt der Coach keine Empfehlung.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {chatLoading ? (
              <p className="text-xs text-[var(--text-secondary)]">Coach denkt nach …</p>
            ) : null}
            {chatError ? (
              <p role="alert" className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
                {chatError}
              </p>
            ) : null}

            {followUps.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {followUps.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void sendMessage(q)}
                    disabled={chatLoading}
                    className="rounded-lg border border-[var(--border-sub)] px-2.5 py-1 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : null}

            <form
              className="flex flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(draft);
              }}
            >
              <div className="flex gap-2">
                <Input
                  aria-label="Frage an den Coach"
                  value={draft}
                  maxLength={MAX_COACH_CHAT_MESSAGE_LENGTH}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Deine Frage …"
                />
                <Button type="submit" disabled={chatLoading || draft.trim().length === 0}>
                  Senden
                </Button>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Bitte keine Namen/Kontodaten eingeben.
              </p>
            </form>
          </div>
        )}

        <details className="rounded-lg border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            Was die KI sieht
          </summary>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            {sentContextJson !== null
              ? "Genau dieser anonymisierte Kontext wurde zuletzt gesendet."
              : "Vorschau – der Server baut den Kontext bei jeder Anfrage neu; nach dem Senden siehst du hier den tatsächlich gesendeten Kontext."}{" "}
            Namen, Konten und Verträge sind durch Referenzen ersetzt.
          </p>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-[var(--surface-elevated)] p-3 text-xs tabular-nums">
            {sentContextJson ?? previewJson}
          </pre>
        </details>
      </div>
    </Sheet>
  );
}
