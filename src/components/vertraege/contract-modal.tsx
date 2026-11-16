"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { FinancialContractRow, PropertyRow } from "@/db/queries/contracts";
import type {
  ContractCategory,
  ContractSphere,
  ContractStatus,
  RepaymentType,
} from "@/lib/domain/contracts";
import {
  bpsToPercentInputString,
  centsToEuroInputString,
  parseEuroInputToCents,
  parsePercentInputToBps,
} from "@/lib/domain/money";

interface ContractModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: PropertyRow[];
  asOfDate: string;
  initialContract?: FinancialContractRow | null;
  onSaved: () => void;
}

interface FieldErrors {
  name?: string;
  provider?: string;
  linkedPropertyId?: string;
  currentBalanceEuro?: string;
  balanceAsOfDate?: string;
  monthlyRateEuro?: string;
  interestRatePercent?: string;
  milestoneDate?: string;
  milestoneLabel?: string;
  fixedInterestUntil?: string;
  specialRepaymentMaxYearlyEuro?: string;
  targetSumEuro?: string;
  allocationThresholdPercent?: string;
  futureLoanInterestRatePercent?: string;
  general?: string;
}

export function ContractModal({
  open,
  onOpenChange,
  properties,
  asOfDate,
  initialContract,
  onSaved,
}: ContractModalProps) {
  if (!open) {
    return null;
  }

  return (
    <ContractModalInner
      key={initialContract?.id ?? "new"}
      open={open}
      onOpenChange={onOpenChange}
      properties={properties}
      asOfDate={asOfDate}
      initialContract={initialContract}
      onSaved={onSaved}
    />
  );
}

function ContractModalInner({
  open,
  onOpenChange,
  properties,
  asOfDate,
  initialContract,
  onSaved,
}: ContractModalProps) {
  const isEditing = Boolean(initialContract);

  const [name, setName] = React.useState(initialContract?.name ?? "");
  const [provider, setProvider] = React.useState(
    initialContract?.provider ?? "",
  );
  const [sphere, setSphere] = React.useState<ContractSphere>(
    initialContract?.sphere ?? "household",
  );
  const [category, setCategory] = React.useState<ContractCategory>(
    initialContract?.category ?? "loan",
  );
  const [status, setStatus] = React.useState<ContractStatus>(
    initialContract?.status ?? "active",
  );
  const [linkedPropertyId, setLinkedPropertyId] = React.useState(
    initialContract?.linkedPropertyId ?? "",
  );

  const [currentBalanceEuro, setCurrentBalanceEuro] = React.useState(
    initialContract
      ? centsToEuroInputString(initialContract.currentBalanceCents)
      : "",
  );
  const [balanceAsOfDate, setBalanceAsOfDate] = React.useState(
    initialContract?.balanceAsOfDate ?? asOfDate,
  );
  const [monthlyRateEuro, setMonthlyRateEuro] = React.useState(
    initialContract
      ? centsToEuroInputString(initialContract.monthlyRateCents)
      : "0,00",
  );
  const [interestRatePercent, setInterestRatePercent] = React.useState(
    initialContract
      ? bpsToPercentInputString(initialContract.interestRateBps)
      : "0,00",
  );

  const [milestoneDate, setMilestoneDate] = React.useState(
    initialContract?.milestoneDate ?? "",
  );
  const [milestoneLabel, setMilestoneLabel] = React.useState(
    initialContract?.milestoneLabel ?? "",
  );

  const [repaymentType, setRepaymentType] = React.useState<RepaymentType>(
    initialContract?.repaymentType ?? "annuity",
  );
  const [fixedInterestUntil, setFixedInterestUntil] = React.useState(
    initialContract?.fixedInterestUntil ?? "",
  );
  const [specialRepaymentMaxYearlyEuro, setSpecialRepaymentMaxYearlyEuro] =
    React.useState(
      initialContract?.specialRepaymentMaxYearlyCents != null
        ? centsToEuroInputString(initialContract.specialRepaymentMaxYearlyCents)
        : "",
    );

  const [targetSumEuro, setTargetSumEuro] = React.useState(
    initialContract?.targetSumCents != null
      ? centsToEuroInputString(initialContract.targetSumCents)
      : "",
  );
  const [allocationThresholdPercent, setAllocationThresholdPercent] =
    React.useState(
      initialContract?.allocationThresholdPercent != null
        ? String(initialContract.allocationThresholdPercent)
        : "",
    );
  const [futureLoanInterestRatePercent, setFutureLoanInterestRatePercent] =
    React.useState(
      initialContract?.futureLoanInterestRateBps != null
        ? bpsToPercentInputString(initialContract.futureLoanInterestRateBps)
        : "",
    );

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FieldErrors = {};

    const trimmedName = name.trim();
    if (!trimmedName) {
      nextErrors.name = "Bitte einen Vertragsnamen eingeben.";
    }

    const currentBalanceCents = parseEuroInputToCents(currentBalanceEuro);
    if (currentBalanceCents === null || currentBalanceCents < 0) {
      nextErrors.currentBalanceEuro =
        "Bitte einen gültigen Stand >= 0,00 € eingeben.";
    }

    if (!balanceAsOfDate.trim()) {
      nextErrors.balanceAsOfDate = "Bitte das Stichtagsdatum angeben.";
    }

    const monthlyRateCents = parseEuroInputToCents(monthlyRateEuro);
    if (monthlyRateCents === null || monthlyRateCents < 0) {
      nextErrors.monthlyRateEuro =
        "Bitte eine gültige Monatsrate >= 0,00 € eingeben.";
    }

    const interestRateBps = parsePercentInputToBps(interestRatePercent);
    if (interestRateBps === null || interestRateBps > 100_000) {
      nextErrors.interestRatePercent =
        "Bitte einen gültigen Zinssatz in % angeben (z. B. 3,50).";
    }

    let specialRepaymentMaxYearlyCents: number | null = null;
    let targetSumCents: number | null = null;
    let parsedThreshold: number | null = null;
    let futureLoanInterestRateBps: number | null = null;

    if (category === "loan") {
      if (specialRepaymentMaxYearlyEuro.trim().length > 0) {
        const parsed = parseEuroInputToCents(specialRepaymentMaxYearlyEuro);
        if (parsed === null || parsed < 0) {
          nextErrors.specialRepaymentMaxYearlyEuro =
            "Bitte einen gültigen Betrag >= 0,00 € eingeben.";
        } else {
          specialRepaymentMaxYearlyCents = parsed;
        }
      }
    } else {
      if (targetSumEuro.trim().length > 0) {
        const parsed = parseEuroInputToCents(targetSumEuro);
        if (parsed === null || parsed < 0) {
          nextErrors.targetSumEuro =
            "Bitte eine gültige Bausparsumme >= 0,00 € eingeben.";
        } else {
          targetSumCents = parsed;
        }
      }

      if (allocationThresholdPercent.trim().length > 0) {
        const raw = Number(allocationThresholdPercent.trim());
        if (!Number.isInteger(raw) || raw < 0 || raw > 100) {
          nextErrors.allocationThresholdPercent =
            "Bitte eine ganze Zahl zwischen 0 und 100 eingeben.";
        } else {
          parsedThreshold = raw;
        }
      }

      if (futureLoanInterestRatePercent.trim().length > 0) {
        const parsed = parsePercentInputToBps(futureLoanInterestRatePercent);
        if (parsed === null || parsed > 100_000) {
          nextErrors.futureLoanInterestRatePercent =
            "Bitte einen gültigen Zinssatz in % eingeben.";
        } else {
          futureLoanInterestRateBps = parsed;
        }
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    const payload =
      category === "loan"
        ? {
            name: trimmedName,
            provider: provider.trim() || null,
            sphere,
            category,
            status,
            currentBalanceCents,
            balanceAsOfDate: balanceAsOfDate.trim(),
            monthlyRateCents,
            interestRateBps,
            linkedPropertyId: linkedPropertyId || null,
            milestoneDate: milestoneDate.trim() || null,
            milestoneLabel: milestoneLabel.trim() || null,
            repaymentType,
            fixedInterestUntil: fixedInterestUntil.trim() || null,
            specialRepaymentMaxYearlyCents,
          }
        : {
            name: trimmedName,
            provider: provider.trim() || null,
            sphere,
            category,
            status,
            currentBalanceCents,
            balanceAsOfDate: balanceAsOfDate.trim(),
            monthlyRateCents,
            interestRateBps,
            linkedPropertyId: linkedPropertyId || null,
            milestoneDate: milestoneDate.trim() || null,
            milestoneLabel: milestoneLabel.trim() || null,
            targetSumCents,
            allocationThresholdPercent: parsedThreshold,
            futureLoanInterestRateBps,
          };

    try {
      const url = initialContract
        ? `/api/contracts/${initialContract.id}`
        : "/api/contracts";
      const method = initialContract ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok) {
        setErrors({
          name: data.fieldErrors?.name,
          provider: data.fieldErrors?.provider,
          linkedPropertyId: data.fieldErrors?.linkedPropertyId,
          currentBalanceEuro: data.fieldErrors?.currentBalanceCents,
          balanceAsOfDate: data.fieldErrors?.balanceAsOfDate,
          monthlyRateEuro: data.fieldErrors?.monthlyRateCents,
          interestRatePercent: data.fieldErrors?.interestRateBps,
          milestoneDate: data.fieldErrors?.milestoneDate,
          milestoneLabel: data.fieldErrors?.milestoneLabel,
          fixedInterestUntil: data.fieldErrors?.fixedInterestUntil,
          specialRepaymentMaxYearlyEuro:
            data.fieldErrors?.specialRepaymentMaxYearlyCents,
          targetSumEuro: data.fieldErrors?.targetSumCents,
          allocationThresholdPercent:
            data.fieldErrors?.allocationThresholdPercent,
          futureLoanInterestRatePercent:
            data.fieldErrors?.futureLoanInterestRateBps,
          general: data.error ?? "Speichern fehlgeschlagen.",
        });
        setIsSubmitting(false);
        return;
      }

      onOpenChange(false);
      onSaved();
    } catch {
      setErrors({
        general: "Netzwerkfehler beim Speichern des Vertrags.",
      });
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Vertrag bearbeiten" : "Neuen Vertrag anlegen"}
      description="Generische Erfassung für Kredite, Privatdarlehen und Bausparverträge."
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {errors.general ? (
          <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errors.general}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="contract-name">Vertragsname *</Label>
            <Input
              id="contract-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Hauskredit Musterbank"
              hasError={Boolean(errors.name)}
              disabled={isSubmitting}
            />
            {errors.name ? (
              <p className="text-xs text-[var(--rose)]">{errors.name}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contract-provider">
              Anbieter / Gläubiger (optional)
            </Label>
            <Input
              id="contract-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="z. B. Musterbank AG"
              hasError={Boolean(errors.provider)}
              disabled={isSubmitting}
            />
            {errors.provider ? (
              <p className="text-xs text-[var(--rose)]">{errors.provider}</p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="contract-category">Kategorie</Label>
            <Select
              id="contract-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ContractCategory)}
              disabled={isSubmitting}
            >
              <option value="loan">Kredit / Darlehen</option>
              <option value="savings_contract">Bausparvertrag</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contract-sphere">Sphäre</Label>
            <Select
              id="contract-sphere"
              value={sphere}
              onChange={(e) => setSphere(e.target.value as ContractSphere)}
              disabled={isSubmitting}
            >
              <option value="household">Haushalt</option>
              <option value="personal">Privat</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contract-status">Status</Label>
            <Select
              id="contract-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ContractStatus)}
              disabled={isSubmitting}
            >
              <option value="active">Aktiv</option>
              <option value="paused">Pausiert</option>
              <option value="closed">Beendet</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contract-property">Immobilie (optional)</Label>
            <Select
              id="contract-property"
              value={linkedPropertyId}
              onChange={(e) => setLinkedPropertyId(e.target.value)}
              hasError={Boolean(errors.linkedPropertyId)}
              disabled={isSubmitting}
            >
              <option value="">Keine Verknüpfung</option>
              {properties.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.name}
                </option>
              ))}
            </Select>
            {errors.linkedPropertyId ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.linkedPropertyId}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="contract-balance">
              {category === "loan" ? "Restschuld (€) *" : "Guthaben (€) *"}
            </Label>
            <Input
              id="contract-balance"
              inputMode="decimal"
              value={currentBalanceEuro}
              onChange={(e) => setCurrentBalanceEuro(e.target.value)}
              placeholder="z. B. 295000,00"
              hasError={Boolean(errors.currentBalanceEuro)}
              disabled={isSubmitting}
              className="tabular-nums"
            />
            {errors.currentBalanceEuro ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.currentBalanceEuro}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contract-date">Geeicht per *</Label>
            <Input
              id="contract-date"
              type="date"
              value={balanceAsOfDate}
              onChange={(e) => setBalanceAsOfDate(e.target.value)}
              hasError={Boolean(errors.balanceAsOfDate)}
              disabled={isSubmitting}
              className="tabular-nums"
            />
            {errors.balanceAsOfDate ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.balanceAsOfDate}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contract-rate">Monatsrate (€)</Label>
            <Input
              id="contract-rate"
              inputMode="decimal"
              value={monthlyRateEuro}
              onChange={(e) => setMonthlyRateEuro(e.target.value)}
              placeholder="z. B. 1400,00"
              hasError={Boolean(errors.monthlyRateEuro)}
              disabled={isSubmitting}
              className="tabular-nums"
            />
            {errors.monthlyRateEuro ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.monthlyRateEuro}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contract-interest">Zinssatz (%)</Label>
            <Input
              id="contract-interest"
              inputMode="decimal"
              value={interestRatePercent}
              onChange={(e) => setInterestRatePercent(e.target.value)}
              placeholder="z. B. 3,50"
              hasError={Boolean(errors.interestRatePercent)}
              disabled={isSubmitting}
              className="tabular-nums"
            />
            {errors.interestRatePercent ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.interestRatePercent}
              </p>
            ) : null}
          </div>
        </div>

        {category === "loan" ? (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Kredit-Konditionen
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="contract-repayment-type">Tilgungsart</Label>
                <Select
                  id="contract-repayment-type"
                  value={repaymentType}
                  onChange={(e) =>
                    setRepaymentType(e.target.value as RepaymentType)
                  }
                  disabled={isSubmitting}
                >
                  <option value="annuity">Annuitätendarlehen</option>
                  <option value="installment">Ratendarlehen</option>
                  <option value="lump_sum">Endfällig / Privatdarlehen</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contract-fixed-until">
                  Zinsbindung bis (optional)
                </Label>
                <Input
                  id="contract-fixed-until"
                  type="date"
                  value={fixedInterestUntil}
                  onChange={(e) => setFixedInterestUntil(e.target.value)}
                  hasError={Boolean(errors.fixedInterestUntil)}
                  disabled={isSubmitting}
                  className="tabular-nums"
                />
                {errors.fixedInterestUntil ? (
                  <p className="text-xs text-[var(--rose)]">
                    {errors.fixedInterestUntil}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contract-special-repayment">
                  Sondertilgung/Jahr (€)
                </Label>
                <Input
                  id="contract-special-repayment"
                  inputMode="decimal"
                  value={specialRepaymentMaxYearlyEuro}
                  onChange={(e) =>
                    setSpecialRepaymentMaxYearlyEuro(e.target.value)
                  }
                  placeholder="z. B. 10000,00"
                  hasError={Boolean(errors.specialRepaymentMaxYearlyEuro)}
                  disabled={isSubmitting}
                  className="tabular-nums"
                />
                {errors.specialRepaymentMaxYearlyEuro ? (
                  <p className="text-xs text-[var(--rose)]">
                    {errors.specialRepaymentMaxYearlyEuro}
                  </p>
                ) : null}
              </div>
            </div>

            {repaymentType === "lump_sum" ? (
              <p className="text-xs text-[var(--text-secondary)]">
                Hinweis: Bei endfälligen Darlehen / Privatdarlehen erfolgt keine
                automatische monatliche Tilgungsprojektion.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Bauspar-Konditionen
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="contract-target-sum">Bausparsumme (€)</Label>
                <Input
                  id="contract-target-sum"
                  inputMode="decimal"
                  value={targetSumEuro}
                  onChange={(e) => setTargetSumEuro(e.target.value)}
                  placeholder="z. B. 50000,00"
                  hasError={Boolean(errors.targetSumEuro)}
                  disabled={isSubmitting}
                  className="tabular-nums"
                />
                {errors.targetSumEuro ? (
                  <p className="text-xs text-[var(--rose)]">
                    {errors.targetSumEuro}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contract-allocation-threshold">
                  Zuteilungsschwelle (%)
                </Label>
                <Input
                  id="contract-allocation-threshold"
                  inputMode="numeric"
                  value={allocationThresholdPercent}
                  onChange={(e) =>
                    setAllocationThresholdPercent(e.target.value)
                  }
                  placeholder="z. B. 40"
                  hasError={Boolean(errors.allocationThresholdPercent)}
                  disabled={isSubmitting}
                  className="tabular-nums"
                />
                {errors.allocationThresholdPercent ? (
                  <p className="text-xs text-[var(--rose)]">
                    {errors.allocationThresholdPercent}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contract-future-loan-rate">
                  Späterer Darlehenszins (%)
                </Label>
                <Input
                  id="contract-future-loan-rate"
                  inputMode="decimal"
                  value={futureLoanInterestRatePercent}
                  onChange={(e) =>
                    setFutureLoanInterestRatePercent(e.target.value)
                  }
                  placeholder="z. B. 2,50"
                  hasError={Boolean(errors.futureLoanInterestRatePercent)}
                  disabled={isSubmitting}
                  className="tabular-nums"
                />
                {errors.futureLoanInterestRatePercent ? (
                  <p className="text-xs text-[var(--rose)]">
                    {errors.futureLoanInterestRatePercent}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="contract-milestone-date">
              Meilenstein-Datum (optional)
            </Label>
            <Input
              id="contract-milestone-date"
              type="date"
              value={milestoneDate}
              onChange={(e) => setMilestoneDate(e.target.value)}
              hasError={Boolean(errors.milestoneDate)}
              disabled={isSubmitting}
              className="tabular-nums"
            />
            {errors.milestoneDate ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.milestoneDate}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contract-milestone-label">
              Meilenstein-Beschreibung (optional)
            </Label>
            <Input
              id="contract-milestone-label"
              value={milestoneLabel}
              onChange={(e) => setMilestoneLabel(e.target.value)}
              placeholder="z. B. Zuteilung oder Rückzahlung"
              hasError={Boolean(errors.milestoneLabel)}
              disabled={isSubmitting}
            />
            {errors.milestoneLabel ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.milestoneLabel}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Speichert..."
              : isEditing
                ? "Änderungen speichern"
                : "Vertrag anlegen"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
