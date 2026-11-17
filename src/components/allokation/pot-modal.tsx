"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { PotRow } from "@/db/queries/allocation";
import type { FinancialContractRow, PropertyRow } from "@/db/queries/contracts";
import {
  centsToEuroInputString,
  parseEuroInputToCents,
} from "@/lib/domain/money";
import type { PotRuleType } from "@/lib/domain/waterfall";

interface PotModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPot?: PotRow | null;
  existingPots: PotRow[];
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  onSaved: () => void;
}

interface FieldErrors {
  name?: string;
  currentEuro?: string;
  targetEuro?: string;
  fixedMonthlyEuro?: string;
  remainderPercentage?: string;
  linkedPropertyId?: string;
  linkedContractId?: string;
  general?: string;
}

export function PotModal({
  open,
  onOpenChange,
  initialPot,
  existingPots,
  properties,
  contracts,
  onSaved,
}: PotModalProps) {
  if (!open) {
    return null;
  }

  return (
    <PotModalInner
      key={initialPot?.id ?? "new"}
      open={open}
      onOpenChange={onOpenChange}
      initialPot={initialPot}
      existingPots={existingPots}
      properties={properties}
      contracts={contracts}
      onSaved={onSaved}
    />
  );
}

function PotModalInner({
  open,
  onOpenChange,
  initialPot,
  existingPots,
  properties,
  contracts,
  onSaved,
}: PotModalProps) {
  const isEditing = Boolean(initialPot);

  const [name, setName] = React.useState(initialPot?.name ?? "");
  const [ruleType, setRuleType] = React.useState<PotRuleType>(
    initialPot?.ruleType ?? "fill_to_target",
  );
  const [currentEuro, setCurrentEuro] = React.useState(
    initialPot ? centsToEuroInputString(initialPot.currentCents) : "0,00",
  );
  const [targetEuro, setTargetEuro] = React.useState(
    initialPot?.targetCents !== null && initialPot?.targetCents !== undefined
      ? centsToEuroInputString(initialPot.targetCents)
      : "",
  );
  const [fixedMonthlyEuro, setFixedMonthlyEuro] = React.useState(
    initialPot?.fixedMonthlyCents !== null &&
      initialPot?.fixedMonthlyCents !== undefined
      ? centsToEuroInputString(initialPot.fixedMonthlyCents)
      : "",
  );
  const [remainderPercentage, setRemainderPercentage] = React.useState(
    initialPot?.remainderPercentage !== null &&
      initialPot?.remainderPercentage !== undefined
      ? String(initialPot.remainderPercentage)
      : "",
  );
  const [linkedPropertyId, setLinkedPropertyId] = React.useState(
    initialPot?.linkedPropertyId ?? "",
  );
  const [linkedContractId, setLinkedContractId] = React.useState(
    initialPot?.linkedContractId ?? "",
  );
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [submitting, setSubmitting] = React.useState(false);

  const usedPercentageByOthers = React.useMemo(() => {
    return existingPots.reduce((sum, pot) => {
      if (initialPot && pot.id === initialPot.id) {
        return sum;
      }
      if (
        pot.ruleType === "percentage_of_remainder" &&
        pot.remainderPercentage !== null
      ) {
        return sum + pot.remainderPercentage;
      }
      return sum;
    }, 0);
  }, [existingPots, initialPot]);

  const availablePercentage = Math.max(0, 100 - usedPercentageByOthers);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: FieldErrors = {};

    if (name.trim().length === 0) {
      nextErrors.name = "Name ist erforderlich.";
    }

    const currentCents = parseEuroInputToCents(currentEuro);
    if (currentCents === null || currentCents < 0) {
      nextErrors.currentEuro =
        "Bitte einen gültigen nicht-negativen Stand eingeben.";
    }

    let targetCents: number | null = null;
    if (targetEuro.trim().length > 0) {
      const parsedTarget = parseEuroInputToCents(targetEuro);
      if (parsedTarget === null || parsedTarget < 0) {
        nextErrors.targetEuro = "Bitte einen gültigen Zielbetrag eingeben.";
      } else {
        targetCents = parsedTarget;
      }
    } else if (ruleType === "fill_to_target") {
      nextErrors.targetEuro =
        "Für die Regel „Bis Zielwert“ ist ein Zielbetrag erforderlich.";
    }

    let fixedMonthlyCents: number | null = null;
    if (ruleType === "fixed_monthly") {
      const parsedFixed = parseEuroInputToCents(fixedMonthlyEuro);
      if (parsedFixed === null || parsedFixed < 0) {
        nextErrors.fixedMonthlyEuro =
          "Bitte einen gültigen Monatsbetrag eingeben.";
      } else {
        fixedMonthlyCents = parsedFixed;
      }
    }

    let parsedPct: number | null = null;
    if (ruleType === "percentage_of_remainder") {
      const trimmedPct = remainderPercentage.trim();
      const num = Number(trimmedPct);
      if (
        trimmedPct.length === 0 ||
        !Number.isInteger(num) ||
        num < 0 ||
        num > 100
      ) {
        nextErrors.remainderPercentage =
          "Bitte eine ganze Zahl zwischen 0 und 100 eingeben.";
      } else if (num > availablePercentage) {
        nextErrors.remainderPercentage = `Maximal noch ${availablePercentage} % verfügbar.`;
      } else {
        parsedPct = num;
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      const endpoint = isEditing
        ? `/api/pots/${initialPot!.id}`
        : "/api/pots";
      const method = isEditing ? "PATCH" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ruleType,
          currentCents,
          targetCents,
          fixedMonthlyCents,
          remainderPercentage: parsedPct,
          linkedPropertyId: linkedPropertyId || null,
          linkedContractId: linkedContractId || null,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok) {
        setErrors({
          name: payload.fieldErrors?.name,
          currentEuro: payload.fieldErrors?.currentCents,
          targetEuro: payload.fieldErrors?.targetCents,
          fixedMonthlyEuro: payload.fieldErrors?.fixedMonthlyCents,
          remainderPercentage: payload.fieldErrors?.remainderPercentage,
          linkedPropertyId: payload.fieldErrors?.linkedPropertyId,
          linkedContractId: payload.fieldErrors?.linkedContractId,
          general: payload.error ?? "Speichern fehlgeschlagen.",
        });
        return;
      }

      onSaved();
      onOpenChange(false);
    } catch {
      setErrors({ general: "Netzwerkfehler beim Speichern." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Ziel-Topf bearbeiten" : "Neuer Ziel-Topf"}
      description="Priorisierte Spar- oder Tilgungsregel für den Wasserfall."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errors.general ? (
          <div className="rounded-lg border border-[var(--rose)]/35 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errors.general}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="pot-name">Topf-Name *</Label>
          <Input
            id="pot-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Instandhaltungsrücklage Musterstraße 1"
            hasError={Boolean(errors.name)}
          />
          {errors.name ? (
            <p className="text-xs text-[var(--rose)]">{errors.name}</p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pot-rule">Wasserfall-Regel</Label>
            <Select
              id="pot-rule"
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as PotRuleType)}
            >
              <option value="fill_to_target">Bis Zielwert auffüllen</option>
              <option value="fixed_monthly">Fester Monatsbetrag</option>
              <option value="percentage_of_remainder">% vom Rest</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pot-current">Aktueller Stand (€)</Label>
            <Input
              id="pot-current"
              inputMode="decimal"
              value={currentEuro}
              onChange={(e) => setCurrentEuro(e.target.value)}
              placeholder="0,00"
              className="tabular-nums"
              hasError={Boolean(errors.currentEuro)}
            />
            {errors.currentEuro ? (
              <p className="text-xs text-[var(--rose)]">{errors.currentEuro}</p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pot-target">
              Zielwert (€){" "}
              {ruleType === "fill_to_target" ? "*" : "(optionaler Deckel)"}
            </Label>
            <Input
              id="pot-target"
              inputMode="decimal"
              value={targetEuro}
              onChange={(e) => setTargetEuro(e.target.value)}
              placeholder="z. B. 10.000,00"
              className="tabular-nums"
              hasError={Boolean(errors.targetEuro)}
            />
            {errors.targetEuro ? (
              <p className="text-xs text-[var(--rose)]">{errors.targetEuro}</p>
            ) : null}
          </div>

          {ruleType === "fixed_monthly" ? (
            <div className="space-y-1.5">
              <Label htmlFor="pot-fixed">Fester Monatsbetrag (€) *</Label>
              <Input
                id="pot-fixed"
                inputMode="decimal"
                value={fixedMonthlyEuro}
                onChange={(e) => setFixedMonthlyEuro(e.target.value)}
                placeholder="z. B. 250,00"
                className="tabular-nums"
                hasError={Boolean(errors.fixedMonthlyEuro)}
              />
              {errors.fixedMonthlyEuro ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.fixedMonthlyEuro}
                </p>
              ) : null}
            </div>
          ) : null}

          {ruleType === "percentage_of_remainder" ? (
            <div className="space-y-1.5">
              <Label htmlFor="pot-pct">Anteil am Rest (%) *</Label>
              <Input
                id="pot-pct"
                inputMode="numeric"
                value={remainderPercentage}
                onChange={(e) => setRemainderPercentage(e.target.value)}
                placeholder="z. B. 50"
                className="tabular-nums"
                hasError={Boolean(errors.remainderPercentage)}
              />
              <p className="text-xs text-[var(--text-secondary)]">
                Noch verfügbar:{" "}
                <span className="tabular-nums font-medium">
                  {availablePercentage} %
                </span>{" "}
                von 100 %
              </p>
              {errors.remainderPercentage ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.remainderPercentage}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pot-property">Verknüpfte Immobilie</Label>
            <Select
              id="pot-property"
              value={linkedPropertyId}
              onChange={(e) => setLinkedPropertyId(e.target.value)}
              hasError={Boolean(errors.linkedPropertyId)}
            >
              <option value="">Keine Verknüpfung</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </Select>
            {errors.linkedPropertyId ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.linkedPropertyId}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pot-contract">Verknüpfter Vertrag</Label>
            <Select
              id="pot-contract"
              value={linkedContractId}
              onChange={(e) => setLinkedContractId(e.target.value)}
              hasError={Boolean(errors.linkedContractId)}
            >
              <option value="">Keine Verknüpfung</option>
              {contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.name}
                </option>
              ))}
            </Select>
            {errors.linkedContractId ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.linkedContractId}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Speichere..." : "Speichern"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
