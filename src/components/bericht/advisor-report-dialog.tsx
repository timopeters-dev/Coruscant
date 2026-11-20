"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, ShieldCheck } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type AdvisorReportMode,
  type AdvisorReportOutlineItem,
  parseAdvisorOneTimeAmount,
} from "@/lib/domain/advisor-report";
import { buttonVariants } from "@/components/ui/button";

interface AdvisorReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outline: readonly AdvisorReportOutlineItem[];
  initialMode?: AdvisorReportMode;
  initialAmount?: string;
}

export function buildAdvisorDialogHref(
  mode: AdvisorReportMode,
  amountRaw: string,
): { href: string; invalidAmount: boolean } {
  const amountValidation = parseAdvisorOneTimeAmount(amountRaw);
  const params = new URLSearchParams();
  params.set("modus", mode === "full" ? "vollstaendig" : "anonym");
  const trimmed = amountRaw.trim();
  if (trimmed.length > 0 && !amountValidation.invalid) {
    params.set("betrag", trimmed);
  }
  return {
    href: `/bericht?${params.toString()}`,
    invalidAmount: amountValidation.invalid,
  };
}

const FALLBACK_OUTLINE: readonly AdvisorReportOutlineItem[] = [
  { sectionId: "profile", label: "Kurzprofil", count: null, isEmpty: false },
  { sectionId: "balance", label: "Bilanz", count: null, isEmpty: false },
  { sectionId: "history", label: "Verlauf", count: null, isEmpty: false },
  {
    sectionId: "contracts",
    label: "Verträge & Kredite",
    count: null,
    isEmpty: false,
  },
  { sectionId: "properties", label: "Immobilien", count: null, isEmpty: false },
  { sectionId: "pots", label: "Töpfe & Ziele", count: null, isEmpty: false },
  { sectionId: "cashflow", label: "Cashflow", count: null, isEmpty: false },
  {
    sectionId: "recommendations",
    label: "Empfehlungen",
    count: null,
    isEmpty: false,
  },
];

export function AdvisorReportDialog({
  open,
  onOpenChange,
  outline,
  initialMode = "anonymized",
  initialAmount = "",
}: AdvisorReportDialogProps) {
  const [mode, setMode] = React.useState<AdvisorReportMode>(initialMode);
  const [amountInput, setAmountInput] = React.useState(initialAmount);
  const visibleOutline = outline.length > 0 ? outline : FALLBACK_OUTLINE;

  const { href, invalidAmount } = React.useMemo(
    () => buildAdvisorDialogHref(mode, amountInput),
    [mode, amountInput],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Berater-Bericht erstellen"
      description="Wähle den Modus für die lokale Druckansicht oder den anonymisierten Text-Export."
    >
      <div className="space-y-5">
        {/* Modus-Auswahl */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-[var(--text-primary)]">
            Modus
          </legend>
          <div role="radiogroup" className="grid grid-cols-1 gap-2.5">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                mode === "anonymized"
                  ? "border-[var(--accent)] bg-[var(--accent)]/5"
                  : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-elevated)]/60"
              }`}
            >
              <input
                type="radio"
                name="advisor-report-mode"
                value="anonymized"
                checked={mode === "anonymized"}
                onChange={() => setMode("anonymized")}
                className="mt-1 accent-[var(--accent)]"
              />
              <span className="space-y-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                  <ShieldCheck className="h-4 w-4 text-[var(--emerald)]" />
                  Anonymisiert – für KI-Chats
                </span>
                <span className="block text-xs text-[var(--text-secondary)]">
                  Nur Typen, Beträge und Quoten; Refs wie KREDIT-1 statt Namen.
                </span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                mode === "full"
                  ? "border-[var(--accent)] bg-[var(--accent)]/5"
                  : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-elevated)]/60"
              }`}
            >
              <input
                type="radio"
                name="advisor-report-mode"
                value="full"
                checked={mode === "full"}
                onChange={() => setMode("full")}
                className="mt-1 accent-[var(--accent)]"
              />
              <span className="space-y-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                  <FileText className="h-4 w-4 text-[var(--text-secondary)]" />
                  Vollständig – für Berater:innen
                </span>
                <span className="block text-xs text-[var(--text-secondary)]">
                  Mit Namen von Verträgen, Anbietern und Objekten. Nur an
                  Personen weitergeben, denen du vertraust.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {/* Was steht drin? */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            Was steht drin?
          </h3>
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/40 text-xs">
            {visibleOutline.map((item) => (
              <li
                key={item.sectionId}
                className={`flex items-center justify-between px-3.5 py-2 ${
                  item.isEmpty
                    ? "text-[var(--text-secondary)]/70"
                    : "text-[var(--text-primary)]"
                }`}
              >
                <span>{item.label}</span>
                <span className="tabular-nums text-[var(--text-secondary)]">
                  {item.isEmpty
                    ? "keine Daten"
                    : item.count !== null
                      ? item.count
                      : "enthalten"}
                </span>
              </li>
            ))}
          </ul>
          {mode === "anonymized" ? (
            <p className="text-2xs text-[var(--text-secondary)]">
              Beispiel: Aus „Darlehen Musterbank“ wird „KREDIT-1 · Annuität“.
            </p>
          ) : null}
        </div>

        {/* Optional: Wohin mit X €? */}
        <div className="space-y-1.5">
          <Label htmlFor="advisor-dialog-amount" className="text-xs">
            Optional: „Wohin mit X €?“ (Einmalbetrag in €)
          </Label>
          <Input
            id="advisor-dialog-amount"
            type="text"
            inputMode="decimal"
            placeholder="z. B. 5.000"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            aria-invalid={invalidAmount}
            className="h-9 text-xs tabular-nums"
          />
          {invalidAmount ? (
            <p className="text-xs text-[var(--rose)]">
              Ungültiger Betrag (erlaubt: 1 € bis 10.000.000 €) – wird nicht
              übernommen.
            </p>
          ) : null}
        </div>

        {/* Aktionen & Datenschutz-Hinweis */}
        <div className="space-y-2.5 border-t border-[var(--border)] pt-4">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Abbrechen
            </button>
            <Link
              href={href}
              onClick={() => onOpenChange(false)}
              className={buttonVariants({ size: "sm" })}
            >
              <FileText className="h-3.5 w-3.5" />
              Bericht öffnen
            </Link>
          </div>
          <p className="text-2xs text-[var(--text-secondary)]">
            Die App sendet nichts. Du entscheidest, ob und wem du den Bericht
            gibst.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
