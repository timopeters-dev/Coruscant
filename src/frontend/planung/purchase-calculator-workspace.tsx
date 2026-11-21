"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@/frontend/ui/button";
import {
  type PurchaseCalculatorWorkspaceProps, usePurchaseCalculator,
} from "./purchase-calculator/use-purchase-calculator";
import { PurchaseCalculatorInputs } from "./purchase-calculator/inputs";
import { PurchaseCalculatorResult } from "./purchase-calculator/result";

export function PurchaseCalculatorWorkspace(props: PurchaseCalculatorWorkspaceProps) {
  const ws = usePurchaseCalculator(props);
  const { handleReset } = ws;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div>
          <Link
            href="/planung"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Planung
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="page-title">
              Immobilien-Kaufrechner
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Reine Simulation – verändert keine gespeicherten Daten. Alle Werte vor Steuern.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Zurücksetzen
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <PurchaseCalculatorInputs ws={ws} />

        <PurchaseCalculatorResult ws={ws} />

      </div>
    </div>
  );
}
