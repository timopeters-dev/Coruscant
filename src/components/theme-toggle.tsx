"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { THEME_OPTIONS, resolveActiveTheme } from "@/components/shell-config";
import { SegmentGroup } from "@/components/ui/segmented";
import { SPRING_SNAPPY } from "@/components/ui/motion";

const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const active = resolveActiveTheme(mounted, theme);

  return (
    <SegmentGroup>
      <div
        role="group"
        aria-label="Farbschema wählen"
        className="inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border border-[var(--border-sub)] p-0.5 print:hidden"
      >
        {THEME_OPTIONS.map(({ value, label, Icon }) => {
          const isActive = active === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={isActive}
              aria-label={label}
              title={label}
              className={cn(
                "relative inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] motion-reduce:transition-none",
                isActive
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              {isActive ? (
                <motion.span
                  layoutId="segment-pill"
                  aria-hidden="true"
                  transition={SPRING_SNAPPY}
                  className="absolute inset-0 rounded-md bg-[var(--surface-elevated)]"
                />
              ) : null}
              <Icon className="relative h-3.5 w-3.5" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </SegmentGroup>
  );
}
