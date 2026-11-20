"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./animated-number";
import { CARD_SURFACE } from "./card";

export type KpiTone = "neutral" | "positive" | "negative" | "accent" | "bound";

const TONE: Record<KpiTone, { chip: string; glow: string }> = {
  neutral: {
    chip: "text-[var(--text-secondary)] bg-[var(--surface-elevated)]",
    glow: "var(--text-secondary)",
  },
  positive: {
    chip: "text-[var(--emerald)] bg-[color-mix(in_srgb,var(--emerald)_12%,transparent)]",
    glow: "var(--emerald)",
  },
  negative: {
    chip: "text-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_12%,transparent)]",
    glow: "var(--rose)",
  },
  accent: {
    chip: "text-[var(--accent)] bg-[var(--accent-soft)]",
    glow: "var(--accent)",
  },
  bound: {
    chip: "text-[var(--sky)] bg-[color-mix(in_srgb,var(--sky)_12%,transparent)]",
    glow: "var(--sky)",
  },
};

interface KpiCardProps {
  label: string;
  /** Ganzzahliger Wert (Cent). */
  value: number;
  format: (value: number) => string;
  icon: LucideIcon;
  tone?: KpiTone;
  /** Farbe der Zahl (z. B. emerald/rose) – sonst Primärtext. */
  valueClassName?: string;
  /** Modellierte Werte: gestrichelter Rahmen gemäß Design-System. */
  modeled?: boolean;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** Hervorgehobene Haupt-Kennzahl (größer, mit Farbschimmer). */
  hero?: boolean;
}

/** Kennzahl-Kachel: Label, große Zahl, optionale Details darunter. */
export function KpiCard({
  label,
  value,
  format,
  icon: Icon,
  tone = "neutral",
  valueClassName,
  modeled = false,
  badge,
  children,
  className,
  hero = false,
}: KpiCardProps) {
  const toneStyle = TONE[tone];
  return (
    <div
      className={cn(
        CARD_SURFACE,
        "group relative overflow-hidden p-5",
        modeled && "border-dashed border-[var(--border-sub)]",
        className,
      )}
    >
      {hero ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full opacity-[0.13] blur-3xl transition-opacity duration-500 group-hover:opacity-20 print:hidden"
          style={{ background: toneStyle.glow }}
        />
      ) : null}
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
              toneStyle.chip,
            )}
            aria-hidden="true"
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <p className="truncate text-sm font-medium text-[var(--text-secondary)]">
            {label}
          </p>
        </div>
        {badge}
      </div>
      <p
        className={cn(
          "relative mt-4 font-semibold tracking-[-0.02em] tabular-nums text-[var(--text-primary)]",
          hero ? "text-[1.95rem] leading-9" : "text-[1.7rem] leading-8",
          valueClassName,
        )}
      >
        <AnimatedNumber value={value} format={format} />
      </p>
      {children ? <div className="relative mt-3">{children}</div> : null}
    </div>
  );
}
