"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { CloseButton } from "./dialog";
import { EASE_OUT } from "./motion";
import { OverlayPortal, useModalBehavior } from "./overlay";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  className,
}: SheetProps) {
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLElement>(null);
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  useModalBehavior(open, close, panelRef);

  return (
    <OverlayPortal>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-50 flex justify-end">
            <motion.div
              className="fixed inset-0 bg-[var(--backdrop)] backdrop-blur-[3px]"
              aria-hidden="true"
              onClick={close}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: EASE_OUT }}
            />
            <motion.aside
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              initial={{ x: "100%", opacity: 0.6 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{
                x: "100%",
                opacity: 0.6,
                transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
              }}
              transition={{ type: "spring", stiffness: 380, damping: 40, mass: 0.9 }}
              className={cn(
                "relative z-10 flex h-full w-full max-w-lg flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] outline-hidden sm:m-2 sm:h-[calc(100%-1rem)] sm:rounded-2xl sm:border",
                className,
              )}
            >
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
                <div className="min-w-0 space-y-1">
                  <h2
                    id={titleId}
                    className="truncate text-base font-semibold tracking-tight text-[var(--text-primary)]"
                  >
                    {title}
                  </h2>
                  {subtitle ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
                <CloseButton label="Detailansicht schließen" onClick={close} />
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
                {children}
              </div>
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
    </OverlayPortal>
  );
}
