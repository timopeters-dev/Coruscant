"use client";

import * as React from "react";
import { cn } from "./cn";
import { AnimatedNumber } from "./animated-number";
import { CARD_SURFACE } from "./card";

export type KpiTone = "neutral" | "positive" | "negative" | "accent" | "bound";

/** Farbiger Messstrich links an der Kachel – Farbe nur, wo sie Bedeutung trägt. */
const TONE_RULE: Record<KpiTone, string> = {
  neutral: "before:bg-[var(--border-sub)]",
  positive: "before:bg-[var(--emerald)]",
  negative: "before:bg-[var(--rose)]",
  accent: "before:bg-[var(--accent)]",
  bound: "before:bg-[var(--sky)]",
};

interface KpiCardProps {
  label: string;
  /** Ganzzahliger Wert (Cent). */
  value: number;
  format: (value: number) => string;
  tone?: KpiTone;
  /** Farbe der Zahl (z. B. emerald/rose) – sonst Primärtext. */
  valueClassName?: string;
  /** Modellierte Werte: gestrichelter Rahmen gemäß Design-System. */
  modeled?: boolean;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** Hervorgehobene Haupt-Kennzahl (größere Ziffern). */
  hero?: boolean;
}

/** Kennzahl-Kachel: Label, große Zahl, optionale Details darunter. */
export function KpiCard({
  label,
  value,
  format,
  tone = "neutral",
  valueClassName,
  modeled = false,
  badge,
  children,
  className,
  hero = false,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        CARD_SURFACE,
        "relative overflow-hidden p-5 pl-6 before:absolute before:inset-y-5 before:left-0 before:w-[3px]",
        TONE_RULE[tone],
        modeled && "border-dashed border-[var(--border-sub)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium text-[var(--text-secondary)]">
          {label}
        </p>
        {badge}
      </div>
      <p
        className={cn(
          "figure mt-2 text-[var(--text-primary)]",
          hero ? "text-[2.375rem] leading-[2.75rem]" : "text-[2rem] leading-10",
          valueClassName,
        )}
      >
        <AnimatedNumber value={value} format={format} />
      </p>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
