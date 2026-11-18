"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { THEME_OPTIONS, resolveActiveTheme } from "@/components/shell-config";

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
    <div
      role="group"
      aria-label="Farbschema wählen"
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5 print:hidden"
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
              "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] motion-reduce:transition-none",
              isActive
                ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-xs"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
