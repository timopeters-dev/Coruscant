import type { Transition } from "motion/react";

/** Zentrale Motion-Parameter: ruhig, schnell, ohne Nachschwingen. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const SPRING_SNAPPY: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 40,
  mass: 0.8,
};

export const SPRING_SOFT: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 34,
  mass: 0.9,
};

export const FADE: Transition = { duration: 0.18, ease: EASE_OUT };
