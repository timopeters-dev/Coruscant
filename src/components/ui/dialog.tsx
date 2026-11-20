"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE_OUT, SPRING_SOFT } from "./motion";
import { OverlayPortal, useModalBehavior } from "./overlay";

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
  const panelRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  useModalBehavior(open, close, panelRef);

  return (
    <OverlayPortal>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
            <motion.div
              className="fixed inset-0 bg-[var(--backdrop)] backdrop-blur-[3px]"
              aria-hidden="true"
              onClick={close}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description ? descriptionId : undefined}
              tabIndex={-1}
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{
                opacity: 0,
                y: 8,
                scale: 0.985,
                transition: { duration: 0.14, ease: EASE_OUT },
              }}
              transition={SPRING_SOFT}
              className={cn(
                "relative z-10 flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg),inset_0_1px_0_0_var(--hairline-highlight)] outline-hidden sm:max-h-[90vh] sm:rounded-2xl",
                className,
              )}
            >
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
                <div className="min-w-0 space-y-1">
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
                <CloseButton label="Dialog schließen" onClick={close} />
              </div>

              <div className="overflow-y-auto overscroll-contain px-6 py-5">
                {children}
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </OverlayPortal>
  );
}

export function CloseButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-[var(--text-secondary)] transition-[background-color,color,transform] duration-150 hover:rotate-90 hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)] motion-reduce:hover:rotate-0"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
