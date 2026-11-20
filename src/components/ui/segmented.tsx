"use client";

import * as React from "react";
import { LayoutGroup, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { SPRING_SNAPPY } from "./motion";

/**
 * Bausteine für Segment-Umschalter (Tabs, Zeitraum, Ansicht): eine Schiene mit
 * gleitender Pille. Die Semantik (role="tab", aria-pressed, Link …) bleibt beim
 * Aufrufer; hier kommt nur der einheitliche Look samt Animation her.
 */
export const SEGMENT_TRACK =
  "relative inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5 shadow-[inset_0_1px_2px_rgb(15_23_42/0.04)]";

export function segmentItemClass(active: boolean, size: "sm" | "md" = "sm") {
  return cn(
    "relative inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-150 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)] motion-reduce:transition-none",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
    active
      ? "text-[var(--text-primary)]"
      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
  );
}

/** Umschließt eine Segment-Gruppe, damit die Pille nur innerhalb gleitet. */
export function SegmentGroup({ children }: { children: React.ReactNode }) {
  const id = React.useId();
  return <LayoutGroup id={id}>{children}</LayoutGroup>;
}

/** Gleitende Pille hinter dem aktiven Segment. */
export function SegmentPill({ className }: { className?: string }) {
  return (
    <motion.span
      layoutId="segment-pill"
      aria-hidden="true"
      transition={SPRING_SNAPPY}
      className={cn(
        "absolute inset-0 -z-0 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] dark:border-[var(--border-sub)]/60",
        className,
      )}
    />
  );
}

/** Inhalt eines Segments über der Pille. */
export function SegmentLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative z-10 inline-flex items-center gap-1.5">
      {children}
    </span>
  );
}
