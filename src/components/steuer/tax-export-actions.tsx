"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TaxExportActionsProps {
  year: number;
  disabled: boolean;
}

const linkClass =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)]";

export function TaxExportActions({ year, disabled }: TaxExportActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => window.print()}
      >
        <Printer className="h-4 w-4" aria-hidden="true" />
        Drucken
      </Button>
      {disabled ? (
        <>
          <span aria-disabled="true" className={`${linkClass} cursor-not-allowed opacity-50`}>
            <Download className="h-4 w-4" aria-hidden="true" />
            ZIP-Mappe
          </span>
          <span aria-disabled="true" className={`${linkClass} cursor-not-allowed opacity-50`}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            CSV
          </span>
        </>
      ) : (
        <>
          <a href={`/api/tax/export?year=${year}`} download className={linkClass}>
            <Download className="h-4 w-4" aria-hidden="true" />
            ZIP-Mappe
          </a>
          <a href={`/api/tax/export?year=${year}&format=csv`} download className={linkClass}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            CSV
          </a>
        </>
      )}
    </div>
  );
}
