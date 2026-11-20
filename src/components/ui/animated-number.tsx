"use client";

import * as React from "react";
import { animate, useReducedMotion } from "motion/react";
import { EASE_OUT } from "./motion";

interface AnimatedNumberProps {
  /** Ganzzahliger Wert (z. B. Cent oder Basispunkte). */
  value: number;
  /** Formatierung des (ganzzahligen) Zwischenwerts, z. B. `formatCentsDE`. */
  format: (value: number) => string;
  className?: string;
  /** Startpunkt der Einblendung relativ zum Zielwert (0 … 1). */
  from?: number;
  duration?: number;
}

/**
 * Zeigt eine Kennzahl, die beim ersten Rendern und bei Änderungen sanft zum
 * Zielwert gleitet. Server und erster Paint zeigen immer den exakten Endwert;
 * Zwischenwerte sind reine Darstellung (gerundet auf ganze Einheiten).
 */
export function AnimatedNumber({
  value,
  format,
  className,
  from = 0.94,
  duration = 0.9,
}: AnimatedNumberProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const previous = React.useRef<number | null>(null);
  const reduceMotion = useReducedMotion();
  const formatRef = React.useRef(format);

  React.useEffect(() => {
    formatRef.current = format;
  }, [format]);

  React.useEffect(() => {
    const node = ref.current;
    const start = previous.current ?? Math.round(value * from);
    previous.current = value;
    if (!node || reduceMotion || start === value) {
      if (node) node.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(start, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (latest) => {
        node.textContent = formatRef.current(Math.round(latest));
      },
      onComplete: () => {
        node.textContent = formatRef.current(value);
      },
    });
    return () => controls.stop();
  }, [value, from, duration, reduceMotion]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
