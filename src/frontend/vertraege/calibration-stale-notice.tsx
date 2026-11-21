"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

interface CalibrationStaleNoticeProps {
  months: number;
}

export function CalibrationStaleNotice({ months }: CalibrationStaleNoticeProps) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3.5 py-2.5 text-xs text-[var(--text-primary)]"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]" />
      <p className="leading-relaxed">
        Stand ist <span className="tabular-nums font-medium">{months}</span>{" "}
        Monate alt. Kontoauszug in der{" "}
        <Link
          href="/dokumente"
          className="font-medium text-[var(--amber)] underline underline-offset-2 hover:opacity-80"
        >
          Inbox
        </Link>{" "}
        hochladen, um neu zu eichen.
      </p>
    </div>
  );
}
