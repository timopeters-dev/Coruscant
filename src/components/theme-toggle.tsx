"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "Hell", Icon: Sun },
  { value: "dark", label: "Command Deck", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const currentTheme = mounted ? (theme ?? "system") : "system";

  return (
    <div
      role="group"
      aria-label="Farbschema wählen"
      className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5 print:hidden"
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => {
        const isActive = currentTheme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={isActive}
            title={label}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              isActive
                ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-xs"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
