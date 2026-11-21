"use client";

import { formatDateDE } from "@/domain/core/date-format";
import { AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { TextField } from "@/frontend/ui/field";
import { Label } from "@/frontend/ui/label";
import { formatCentsDE, parseEuroInputToCents } from "@/domain/core/money";
import { DatePicker } from "@/frontend/ui/date-picker";
import { type DocumentReviewState } from "./use-document-review";

/** Bestehenden Vertrag mit dem Beleg eichen und Darlehensoptionen übernehmen. */
export function ReviewCalibrationSection({ ws }: { ws: DocumentReviewState }) {
  const {
    allowNegativeBalance, allowOlderCalibrationDate, applyLoanOptions, calibrationDate,
    calibrationEvaluation, contractMode, detectedBalanceInput, documentDate,
    effectiveCalibrateContract, isCalibrationToggleDisabled, loanOptionsDiff, parsedBalanceCents,
    selectedContract, setAllowOlderCalibrationDate, setApplyLoanOptions, setCalibrateContract,
    setCalibrationDate, setDetectedBalanceInput, setHasEditedCalibrationDate, todayIsoDate,
  } = ws;
  return (
    <>
      {/* Contract Calibration Section (existing mode) */}
      {contractMode === "existing" && selectedContract ? (
        <div className="space-y-3 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber)]/5 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="section-label text-[var(--text-primary)]">
              Vertrags-Eichung
            </span>
            <span className="tabular-nums text-xs text-[var(--text-secondary)]">
              Aktuell: {formatCentsDE(selectedContract.currentBalanceCents)}{" "}
              (per {formatDateDE(selectedContract.balanceAsOfDate)})
            </span>
          </div>

          <div className="grid gap-3 @md:grid-cols-2">
            <TextField
              id="doc-balance"
              label="Erkannter / neuer Stand (€)"
              value={detectedBalanceInput}
              onValueChange={(nextVal) => {
                setDetectedBalanceInput(nextVal);
                const parsed = nextVal.trim()
                  ? parseEuroInputToCents(nextVal)
                  : null;
                if (
                  parsed === null ||
                  (parsed < 0 && !allowNegativeBalance)
                ) {
                  setCalibrateContract(false);
                }
              }}
              placeholder={
                  allowNegativeBalance
                    ? "z. B. -1.200,00"
                    : "z. B. 295.000,00"
                }
            />

            <div className="space-y-1.5">
              <Label htmlFor="doc-cal-date">Eich-Stichtag</Label>
              <DatePicker
                id="doc-cal-date"
                value={calibrationDate}
                onChange={(nextCalDate) => {
                  setHasEditedCalibrationDate(true);
                  setCalibrationDate(nextCalDate);
                  setAllowOlderCalibrationDate(false);
                  const effectiveDate =
                    nextCalDate.trim() ||
                    documentDate.trim() ||
                    todayIsoDate;
                  if (
                    selectedContract &&
                    effectiveDate < selectedContract.balanceAsOfDate
                  ) {
                    setCalibrateContract(false);
                  }
                }}
              />
            </div>
          </div>

          {calibrationEvaluation ? (
            <div className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">
                  Projizierter Stand per{" "}
                  <span className="tabular-nums">
                    {formatDateDE(calibrationEvaluation.effectiveDate)}
                  </span>
                </span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {formatCentsDE(
                    calibrationEvaluation.projectedBalanceAtDateCents,
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">
                  Delta zum gespeicherten Stand
                </span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {formatCentsDE(calibrationEvaluation.deltaToStoredCents, {
                    showPlusSign: true,
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">
                  Delta zur Projektion
                </span>
                <span className="tabular-nums font-medium text-[var(--amber)]">
                  {formatCentsDE(
                    calibrationEvaluation.deltaToProjectedCents,
                    { showPlusSign: true },
                  )}
                </span>
              </div>
            </div>
          ) : null}

          {calibrationEvaluation?.isOlderThanCurrentCalibration ? (
            <div className="space-y-2 rounded-lg border border-[var(--amber)]/50 bg-[var(--amber)]/10 p-2.5 text-xs text-[var(--amber)]">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Vertrag ist bereits auf neueres Datum (
                  <span className="tabular-nums font-semibold">
                    {formatDateDE(calibrationEvaluation.previousAsOfDate)}
                  </span>
                  ) geeicht als das Belegdatum (
                  <span className="tabular-nums font-semibold">
                    {formatDateDE(calibrationEvaluation.effectiveDate)}
                  </span>
                  ).
                </span>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={allowOlderCalibrationDate}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAllowOlderCalibrationDate(checked);
                    if (!checked) {
                      setCalibrateContract(false);
                    }
                  }}
                  className="h-3.5 w-3.5 rounded accent-[var(--amber)]"
                />
                <span>Älteres Eichdatum trotzdem übernehmen</span>
              </label>
            </div>
          ) : null}

          <label
            className={`flex items-center gap-2 text-xs font-medium ${
              isCalibrationToggleDisabled
                ? "cursor-not-allowed text-[var(--text-secondary)] opacity-60"
                : "cursor-pointer text-[var(--text-primary)]"
            }`}
          >
            <input
              type="checkbox"
              checked={effectiveCalibrateContract}
              disabled={isCalibrationToggleDisabled}
              onChange={(e) => setCalibrateContract(e.target.checked)}
              className="h-4 w-4 rounded accent-[var(--accent)]"
            />
            <span>
              Vertragsstand auf{" "}
              <span className="tabular-nums">
                {parsedBalanceCents !== null
                  ? formatCentsDE(parsedBalanceCents)
                  : "–"}
              </span>{" "}
              per{" "}
              <span className="tabular-nums">
                {formatDateDE(calibrationEvaluation?.effectiveDate ?? todayIsoDate)}
              </span>{" "}
              eichen
            </span>
          </label>

          {selectedContract.category === "loan" &&
          loanOptionsDiff.diffs.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-[var(--amber)]/50 bg-[var(--amber)]/10 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={applyLoanOptions}
                    onChange={(e) => setApplyLoanOptions(e.target.checked)}
                    className="h-4 w-4 rounded accent-[var(--amber)]"
                  />
                  <span>Darlehensoptionen übernehmen</span>
                </label>
                <StatusBadge variant="ai_suggestion" />
              </div>
              <ul className="space-y-1 pl-6 text-xs text-[var(--text-secondary)]">
                {loanOptionsDiff.diffs.map((entry) => (
                  <li key={entry.field} className="tabular-nums">
                    <span className="font-medium text-[var(--text-primary)]">
                      {entry.label}:
                    </span>{" "}
                    {entry.before} →{" "}
                    <span className="font-medium text-[var(--text-primary)]">
                      {entry.after}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
