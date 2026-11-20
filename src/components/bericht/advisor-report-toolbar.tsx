"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Printer, ShieldCheck } from "lucide-react";
import { buildAdvisorDialogHref } from "@/components/bericht/advisor-report-dialog";
import { AdvisorReportDocument } from "@/components/bericht/advisor-report-document";
import {
  useAdvisorQuestionCheck,
  type UseAdvisorQuestionCheckResult,
} from "@/components/bericht/use-advisor-question-check";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/ui/info-tip";
import {
  SEGMENT_TRACK,
  SegmentGroup,
  SegmentLabel,
  SegmentPill,
  segmentItemClass,
} from "@/components/ui/segmented";
import {
  type AdvisorReportMode,
  parseAdvisorOneTimeAmount,
} from "@/lib/domain/advisor-report";
import type {
  AdvisorQuestionIssue,
  AdvisorReportView,
} from "@/lib/domain/advisor-report-anonymize";
import { renderAdvisorReportText } from "@/lib/domain/advisor-report-text";

interface AdvisorReportToolbarProps {
  view: AdvisorReportView;
  mode: AdvisorReportMode;
  initialAmountRaw?: string;
  initialQuestion?: string;
  oneTimeInvalid?: boolean;
  showDocument?: boolean;
  checkOverride?: UseAdvisorQuestionCheckResult;
}

export async function copyAdvisorReportText(
  view: AdvisorReportView,
  question: string,
  clipboard?: { writeText: (value: string) => Promise<void> } | null,
): Promise<{ copied: boolean; text: string }> {
  const text = renderAdvisorReportText(view, {
    question: question.trim().length > 0 ? question.trim() : null,
  });
  const target =
    clipboard !== undefined
      ? clipboard
      : typeof navigator !== "undefined"
        ? navigator.clipboard
        : null;
  try {
    if (target && typeof target.writeText === "function") {
      await target.writeText(text);
      return { copied: true, text };
    }
  } catch {
    // Fallback below
  }
  return { copied: false, text };
}

const ISSUE_LABELS: Record<AdvisorQuestionIssue, string> = {
  iban: "enthält eine IBAN",
  email: "enthält eine E-Mail-Adresse",
  digit_run: "enthält eine lange Ziffernfolge (z. B. Kredit- oder Kontonummer)",
  known_name: "enthält einen Namen aus deinen Daten",
};

const MAX_QUESTION_LENGTH = 2000;

export function buildReportUrl(
  mode: AdvisorReportMode,
  amountRaw: string,
): string {
  return buildAdvisorDialogHref(mode, amountRaw).href;
}

export function AdvisorReportToolbar({
  view,
  mode,
  initialAmountRaw = "",
  initialQuestion = "",
  oneTimeInvalid = false,
  showDocument = true,
  checkOverride,
}: AdvisorReportToolbarProps) {
  const router = useRouter();
  const [amountInput, setAmountInput] = React.useState(initialAmountRaw);
  const [question, setQuestion] = React.useState(initialQuestion);
  const [copiedMessage, setCopiedMessage] = React.useState<string | null>(null);
  const [fallbackText, setFallbackText] = React.useState<string | null>(null);

  const liveCheck = useAdvisorQuestionCheck(question, mode);
  const check = checkOverride ?? liveCheck;
  const isAnonymized = mode === "anonymized";
  const isLocked = isAnonymized && check.status !== "ok";

  const amountValidation = React.useMemo(
    () => parseAdvisorOneTimeAmount(amountInput),
    [amountInput],
  );

  const handleModeChange = (nextMode: AdvisorReportMode) => {
    if (nextMode === mode) return;
    setCopiedMessage(null);
    setFallbackText(null);
    router.replace(buildReportUrl(nextMode, initialAmountRaw), {
      scroll: false,
    });
  };

  const handleAmountApply = (event: React.FormEvent) => {
    event.preventDefault();
    if (amountValidation.invalid) return;
    router.replace(buildReportUrl(mode, amountInput), { scroll: false });
  };

  const handlePrint = () => {
    if (isLocked) return;
    window.print();
  };

  const handleCopyForLlm = async () => {
    if (!isAnonymized || isLocked) return;
    const result = await copyAdvisorReportText(view, question);
    if (result.copied) {
      setFallbackText(null);
      setCopiedMessage("Kopiert – vor dem Einfügen kurz gegenlesen");
    } else {
      setCopiedMessage(null);
      setFallbackText(result.text);
    }
  };

  const trimmedQuestion = question.trim();
  const printQuestionSlot =
    isAnonymized && check.status !== "ok" ? (
      <section className="hidden print:block print-avoid-break rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5">
        <h2 className="text-base font-semibold tracking-tight">
          9. Wobei brauche ich Rat?
        </h2>
        <p className="mt-2 text-xs italic text-[var(--text-secondary)]">
          [Freitext ausgelassen – möglicherweise personenbezogene Angaben]
        </p>
      </section>
    ) : trimmedQuestion.length > 0 ? (
      <section className="hidden print:block print-avoid-break rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-5">
        <h2 className="text-base font-semibold tracking-tight">
          9. Wobei brauche ich Rat?
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--text-primary)]">
          {trimmedQuestion}
        </p>
      </section>
    ) : null;

  return (
    <div className="space-y-6">
      {/* Werkzeugleiste (nur Bildschirm) */}
      <section
        aria-label="Berichtswerkzeuge"
        className="print:hidden mx-auto max-w-4xl space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Modus-Umschalter */}
          <div className="flex items-center gap-1.5">
            <SegmentGroup>
              <div
                role="group"
                aria-label="Berichtsmodus"
                className={SEGMENT_TRACK}
              >
                {(
                  [
                    { mode: "anonymized", label: "Anonymisiert", active: isAnonymized },
                    { mode: "full", label: "Vollständig", active: !isAnonymized },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => handleModeChange(option.mode)}
                    aria-pressed={option.active}
                    className={segmentItemClass(option.active, "md")}
                  >
                    {option.active ? <SegmentPill /> : null}
                    <SegmentLabel>{option.label}</SegmentLabel>
                  </button>
                ))}
              </div>
            </SegmentGroup>
            <InfoTip
              id="report-mode-info"
              label="Berichtsmodus"
              text="Anonymisiert (für KI-Chats): nur Typen, Beträge und Quoten, Kürzel wie KREDIT-1 statt Namen. Vollständig (für Berater:innen): mit Namen von Verträgen, Anbietern und Objekten – nur an Personen weitergeben, denen du vertraust."
            />
          </div>

          {/* Aktionen */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={handlePrint}
              disabled={isLocked}
              size="sm"
            >
              <Printer className="h-4 w-4" />
              Drucken / Als PDF speichern
            </Button>

            {isAnonymized ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyForLlm}
                disabled={isLocked}
              >
                <Copy className="h-4 w-4" />
                Als Text für LLM kopieren
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => handleModeChange("anonymized")}
                className="text-xs text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
              >
                Für KI-Chats den Modus „Anonymisiert“ wählen
              </button>
            )}
          </div>
        </div>

        {/* Optional: Einmalbetrag */}
        <form
          onSubmit={handleAmountApply}
          className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3"
        >
          <div className="w-full max-w-xs space-y-1">
            <Label htmlFor="advisor-amount-input" className="text-xs">
              Optional: „Wohin mit X €?“ (€)
            </Label>
            <Input
              id="advisor-amount-input"
              type="text"
              inputMode="decimal"
              placeholder="z. B. 5.000"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              aria-invalid={amountValidation.invalid}
              className="h-8 text-xs tabular-nums"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={amountValidation.invalid}
          >
            Übernehmen
          </Button>
          {amountValidation.invalid ? (
            <p className="text-xs text-[var(--rose)]">
              Bitte einen Betrag zwischen 1 € und 10.000.000 € eingeben.
            </p>
          ) : null}
        </form>

        {/* Freitext: Wobei brauche ich Rat? */}
        <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="advisor-question-textarea" className="text-xs">
              Wobei brauche ich Rat? (optional, wird nicht gespeichert)
            </Label>
            <span className="text-2xs text-[var(--text-secondary)] tabular-nums">
              {question.length} / {MAX_QUESTION_LENGTH.toLocaleString("de-DE")}
            </span>
          </div>
          <textarea
            id="advisor-question-textarea"
            rows={3}
            maxLength={MAX_QUESTION_LENGTH}
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setCopiedMessage(null);
            }}
            placeholder="z. B. Kontext (Alter, Zeithorizont, Pläne) oder konkrete Frage an Berater:in bzw. KI…"
            className="w-full rounded-lg border border-[var(--border-sub)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/70 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
          />

          {/* Live-Status der Freitext-Prüfung */}
          <div
            aria-live="polite"
            className="flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            {isAnonymized ? (
              check.status === "checking" ? (
                <span className="text-[var(--text-secondary)]">
                  wird geprüft…
                </span>
              ) : check.status === "ok" ? (
                <span className="inline-flex items-center gap-1 text-[var(--emerald)]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  geprüft ✓
                </span>
              ) : check.status === "error" ? (
                <span className="text-[var(--rose)]">
                  Prüfung fehlgeschlagen – Drucken und Kopieren gesperrt.
                </span>
              ) : (
                <span className="text-[var(--rose)]">
                  Freitext gesperrt:{" "}
                  {check.issues.map((i) => ISSUE_LABELS[i]).join("; ")}.
                </span>
              )
            ) : (
              <span className="text-[var(--text-secondary)]">
                Modus Vollständig: Freitext wird ungeprüft gedruckt.
              </span>
            )}

            {copiedMessage ? (
              <span className="inline-flex items-center gap-1 font-medium text-[var(--emerald)]">
                <Check className="h-3.5 w-3.5" />
                {copiedMessage}
              </span>
            ) : null}
          </div>
        </div>

        {/* Fallback ohne Clipboard-API */}
        {fallbackText !== null ? (
          <details open className="border-t border-[var(--border)] pt-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--text-primary)]">
              Text zum manuellen Kopieren anzeigen
            </summary>
            <textarea
              readOnly
              rows={8}
              value={fallbackText}
              aria-label="Anonymisierter Berichtstext zum Kopieren"
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2.5 font-mono text-2xs text-[var(--text-primary)]"
            />
          </details>
        ) : null}
      </section>

      {showDocument ? (
        <AdvisorReportDocument
          view={view}
          oneTimeInvalid={oneTimeInvalid}
          questionSlot={printQuestionSlot}
        />
      ) : (
        printQuestionSlot
      )}
    </div>
  );
}
