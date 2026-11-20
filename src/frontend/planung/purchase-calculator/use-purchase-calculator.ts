"use client";

import * as React from "react";
import { formatBpsDE } from "@/domain/core/money";
import { evaluatePotDeadlines } from "@/domain/allocation/pot-deadline";
import {
  calculateHouseholdImpact, calculatePropertyPurchase, evaluateEquitySource,
  type PropertyPurchaseInput,
} from "@/domain/planning/purchase";
import { CURRENT_PURCHASE_COST_RULE_SET } from "@/domain/planning/purchase-defaults";
import { validatePropertyPurchaseForm } from "@/validation/property-purchase";
import {
  buildBreakdownSegments, buildInitialFormState, buildPurchaseHints, defaultEquityForPot,
  getExampleDefaultPurchaseCostsCents, pickDefaultEquityPot, type EquityPotOption,
} from "../purchase-calculator-state";

export interface PurchaseCalculatorWorkspaceProps {
  asOfDate: string;
  monthlySurplusCents: number;
  hasHouseholdData: boolean;
  isDummy: boolean;
  pots: EquityPotOption[];
}

export function formatYield(bps: number | null): string {
  return bps === null ? "–" : formatBpsDE(bps);
}

export function bpsToPercentWidth(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Zustand, Ableitungen und Aktionen von PurchaseCalculatorWorkspace. */
export function usePurchaseCalculator({
  asOfDate,
  monthlySurplusCents,
  hasHouseholdData,
  isDummy,
  pots,
}: PurchaseCalculatorWorkspaceProps) {
  const defaultPot = React.useMemo(() => pickDefaultEquityPot(pots), [pots]);
  const fallbackEquityCents = React.useMemo(
    () => getExampleDefaultPurchaseCostsCents(),
    [],
  );

  const [selectedPotId, setSelectedPotId] = React.useState<string>(
    () => defaultPot?.id ?? "",
  );
  const [equityAdoptedFromPot, setEquityAdoptedFromPot] = React.useState<string | null>(
    () => defaultPot?.name ?? null,
  );
  const [form, setForm] = React.useState<PropertyPurchaseInput>(() =>
    buildInitialFormState(defaultEquityForPot(defaultPot, fallbackEquityCents)),
  );

  const deferredForm = React.useDeferredValue(form);

  const deadlines = React.useMemo(
    () =>
      evaluatePotDeadlines({
        pots,
        monthlySurplusCents,
        todayIsoDate: asOfDate,
      }),
    [pots, monthlySurplusCents, asOfDate],
  );

  const selectedPot = React.useMemo(
    () => pots.find((p) => p.id === selectedPotId) ?? null,
    [pots, selectedPotId],
  );

  const computed = React.useMemo(() => {
    const validation = validatePropertyPurchaseForm(deferredForm);
    if (!validation.ok) {
      return { ok: false as const, fieldErrors: validation.fieldErrors };
    }
    try {
      const result = calculatePropertyPurchase(validation.input);
      return { ok: true as const, input: validation.input, result };
    } catch (error) {
      return {
        ok: false as const,
        fieldErrors: {
          _form:
            error instanceof RangeError
              ? error.message
              : "Berechnung nicht möglich.",
        },
      };
    }
  }, [deferredForm]);

  const equitySource = React.useMemo(() => {
    if (!computed.ok) return null;
    return evaluateEquitySource({
      requiredEquityCents: computed.result.equity.requiredCents,
      pot: selectedPot,
      deadlines,
    });
  }, [computed, selectedPot, deadlines]);

  const householdImpact = React.useMemo(() => {
    if (!computed.ok) return null;
    return calculateHouseholdImpact(
      monthlySurplusCents,
      computed.result.cashflow.monthlyCashflowCents,
    );
  }, [computed, monthlySurplusCents]);

  const hints = React.useMemo(() => {
    if (!computed.ok) return [];
    return buildPurchaseHints(computed.result, equitySource, {
      hasHouseholdData,
      isDummy,
    });
  }, [computed, equitySource, hasHouseholdData, isDummy]);

  const breakdown = React.useMemo(() => {
    if (!computed.ok) return null;
    return buildBreakdownSegments(computed.result, computed.input);
  }, [computed]);

  function handlePotChange(potId: string) {
    setSelectedPotId(potId);
    const pot = pots.find((p) => p.id === potId) ?? null;
    if (pot) {
      setForm((prev) => ({
        ...prev,
        equityCents: defaultEquityForPot(pot, fallbackEquityCents),
      }));
      setEquityAdoptedFromPot(pot.name);
    } else {
      setEquityAdoptedFromPot(null);
    }
  }

  function handleReset() {
    setSelectedPotId(defaultPot?.id ?? "");
    setEquityAdoptedFromPot(defaultPot?.name ?? null);
    setForm(
      buildInitialFormState(
        defaultEquityForPot(defaultPot, fallbackEquityCents),
      ),
    );
  }

  const ruleSetItemsByKey = React.useMemo(
    () =>
      new Map(CURRENT_PURCHASE_COST_RULE_SET.items.map((item) => [item.key, item])),
    [],
  );

  return {
    asOfDate,
    breakdown,
    computed,
    deadlines,
    defaultPot,
    deferredForm,
    equityAdoptedFromPot,
    equitySource,
    fallbackEquityCents,
    form,
    handlePotChange,
    handleReset,
    hasHouseholdData,
    hints,
    householdImpact,
    isDummy,
    monthlySurplusCents,
    pots,
    ruleSetItemsByKey,
    selectedPot,
    selectedPotId,
    setEquityAdoptedFromPot,
    setForm,
    setSelectedPotId,
  };
}

export type PurchaseCalculatorState = ReturnType<typeof usePurchaseCalculator>;
