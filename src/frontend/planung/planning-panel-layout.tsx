"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Button } from "@/frontend/ui/button";
import { Card, CardContent } from "@/frontend/ui/card";
import { cn } from "@/frontend/ui/cn";

interface PlanningPanelLayoutProps {
  title: string;
  intro: string;
  controls: React.ReactNode;
  advanced?: React.ReactNode;
  advancedModified?: boolean;
  onReset: () => void;
  isStale?: boolean;
  result: React.ReactNode;
}

export function PlanningPanelLayout({
  title,
  intro,
  controls,
  advanced,
  advancedModified = false,
  onReset,
  isStale = false,
  result,
}: PlanningPanelLayoutProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-[var(--text-secondary)]">{intro}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Zurücksetzen
        </Button>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* DOM order: controls first for Tab order; visual order on mobile: result first */}
        <Card className="order-last lg:order-first">
          <CardContent className="flex flex-col gap-5 pt-5">
            {controls}
            {advanced ? (
              <details className="rounded-lg border border-[var(--border)] px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Erweitert
                  {advancedModified ? (
                    <span className="ml-1.5 text-xs font-normal text-[var(--text-secondary)]">
                      (angepasst)
                    </span>
                  ) : null}
                </summary>
                <div className="mt-4 flex flex-col gap-4">{advanced}</div>
              </details>
            ) : null}
          </CardContent>
        </Card>

        <section
          aria-label="Ergebnis"
          aria-busy={isStale}
          className={cn(
            "order-first flex flex-col gap-4 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface)] p-5 transition-opacity lg:sticky lg:top-6 lg:order-last",
            isStale && "opacity-70",
          )}
        >
          <div className="flex justify-end">
            <StatusBadge variant="modeled" />
          </div>
          {result}
        </section>
      </div>
    </div>
  );
}
