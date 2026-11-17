"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { CashflowItemRow } from "@/db/queries/allocation";
import {
  type CashflowDirection,
  type CashflowFrequency,
  normalizeItemToMonthlyCents,
} from "@/lib/domain/cashflow";
import {
  centsToEuroInputString,
  formatCentsDE,
  parseEuroInputToCents,
} from "@/lib/domain/money";

interface CashflowItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialItem?: CashflowItemRow | null;
  onSaved: () => void;
}

interface FieldErrors {
  name?: string;
  amountEuro?: string;
  general?: string;
}

export function CashflowItemModal({
  open,
  onOpenChange,
  initialItem,
  onSaved,
}: CashflowItemModalProps) {
  if (!open) {
    return null;
  }

  return (
    <CashflowItemModalInner
      key={initialItem?.id ?? "new"}
      open={open}
      onOpenChange={onOpenChange}
      initialItem={initialItem}
      onSaved={onSaved}
    />
  );
}

function CashflowItemModalInner({
  open,
  onOpenChange,
  initialItem,
  onSaved,
}: CashflowItemModalProps) {
  const isEditing = Boolean(initialItem);

  const [name, setName] = React.useState(initialItem?.name ?? "");
  const [direction, setDirection] = React.useState<CashflowDirection>(
    initialItem?.direction ?? "inflow",
  );
  const [amountEuro, setAmountEuro] = React.useState(
    initialItem ? centsToEuroInputString(initialItem.amountCents) : "",
  );
  const [frequency, setFrequency] = React.useState<CashflowFrequency>(
    initialItem?.frequency ?? "monthly",
  );
  const [active, setActive] = React.useState(initialItem?.active ?? true);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [submitting, setSubmitting] = React.useState(false);

  const parsedAmountCents = React.useMemo(
    () => parseEuroInputToCents(amountEuro),
    [amountEuro],
  );

  const normalizedMonthlyPreview = React.useMemo(() => {
    if (parsedAmountCents === null || parsedAmountCents < 0) {
      return null;
    }
    return normalizeItemToMonthlyCents(parsedAmountCents, frequency);
  }, [parsedAmountCents, frequency]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: FieldErrors = {};

    if (name.trim().length === 0) {
      nextErrors.name = "Name ist erforderlich.";
    }
    if (parsedAmountCents === null || parsedAmountCents < 0) {
      nextErrors.amountEuro =
        "Bitte einen gültigen nicht-negativen Euro-Betrag eingeben.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      const endpoint = isEditing
        ? `/api/cashflow-items/${initialItem!.id}`
        : "/api/cashflow-items";
      const method = isEditing ? "PATCH" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          direction,
          amountCents: parsedAmountCents,
          frequency,
          active,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok) {
        setErrors({
          name: payload.fieldErrors?.name,
          amountEuro: payload.fieldErrors?.amountCents,
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
      title={
        isEditing
          ? "Haushalts-Position bearbeiten"
          : "Neue Haushalts-Position (Modus A)"
      }
      description="Modellierte Pauschale oder regelmäßige Einnahme bzw. Ausgabe."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errors.general ? (
          <div className="rounded-lg border border-[var(--rose)]/35 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errors.general}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="cf-name">Bezeichnung *</Label>
          <Input
            id="cf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Haushalts-Nettoeinkommen"
            hasError={Boolean(errors.name)}
          />
          {errors.name ? (
            <p className="text-xs text-[var(--rose)]">{errors.name}</p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cf-direction">Art</Label>
            <Select
              id="cf-direction"
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as CashflowDirection)
              }
            >
              <option value="inflow">Einnahme (+)</option>
              <option value="outflow">Ausgabe (−)</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cf-frequency">Rhythmus</Label>
            <Select
              id="cf-frequency"
              value={frequency}
              onChange={(e) =>
                setFrequency(e.target.value as CashflowFrequency)
              }
            >
              <option value="monthly">Monatlich</option>
              <option value="quarterly">Quartalsweise (÷ 3)</option>
              <option value="yearly">Jährlich (÷ 12)</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cf-amount">Betrag (€) *</Label>
          <Input
            id="cf-amount"
            inputMode="decimal"
            value={amountEuro}
            onChange={(e) => setAmountEuro(e.target.value)}
            placeholder="0,00"
            className="tabular-nums"
            hasError={Boolean(errors.amountEuro)}
          />
          {errors.amountEuro ? (
            <p className="text-xs text-[var(--rose)]">{errors.amountEuro}</p>
          ) : null}
          {normalizedMonthlyPreview !== null ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Normalisierter Monatswert:{" "}
              <span className="tabular-nums font-medium text-[var(--text-primary)]">
                {formatCentsDE(normalizedMonthlyPreview)} / Monat
              </span>
            </p>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
          />
          <span>Position aktiv in Modus A berücksichtigen</span>
        </label>

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
