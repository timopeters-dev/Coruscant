"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { EASE_OUT } from "./motion";

interface CollapseProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  id?: string;
}

/**
 * Weiches Auf-/Zuklappen per Höhen-Animation. Geschlossen wird nichts gerendert
 * (wie ein bedingtes `{open ? … : null}`), offen wird nach der Animation
 * `overflow: visible`, damit Tooltips und Fokusringe nicht abgeschnitten werden.
 */
export function Collapse({ open, children, className, id }: CollapseProps) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : 0.32;
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="collapse"
          id={id}
          className={className}
          style={{ overflow: "hidden" }}
          initial={{ height: 0, opacity: 0 }}
          animate={{
            height: "auto",
            opacity: 1,
            transitionEnd: { overflow: "visible" },
          }}
          exit={{ height: 0, opacity: 0, overflow: "hidden" }}
          transition={{
            height: { duration, ease: EASE_OUT },
            opacity: { duration: reduceMotion ? 0 : 0.2, ease: EASE_OUT },
          }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Pfeil für Aufklapper: dreht sich sanft von → nach ↓. */
export function CollapseChevron({
  open,
  className,
}: {
  open: boolean;
  className?: string;
}) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        "h-4 w-4 shrink-0 transition-transform duration-200 ease-out",
        open && "rotate-90",
        className,
      )}
    />
  );
}
