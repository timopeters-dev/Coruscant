"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PurchaseCalculatorCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Immobilien-Kaufrechner</CardTitle>
          <p className="text-sm text-[var(--text-secondary)]">
            Gesamtkosten, Eigenkapitalbedarf und Break-even vor Steuern durchrechnen.
          </p>
        </div>
        <StatusBadge variant="modeled" />
      </CardHeader>
      <CardContent>
        <Link
          href="/planung/kaufrechner"
          className={buttonVariants({ variant: "outline" })}
        >
          Kaufrechner öffnen
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
