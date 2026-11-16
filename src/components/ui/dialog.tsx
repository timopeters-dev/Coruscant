"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: DialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
          <div className="space-y-1">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-[var(--text-primary)]"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="text-xs text-[var(--text-secondary)]"
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Dialog schließen"
            className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
