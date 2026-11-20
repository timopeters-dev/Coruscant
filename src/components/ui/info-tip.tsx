"use client";

import * as React from "react";
import { Info } from "lucide-react";

export type InfoTipMode = "closed" | "hover" | "pinned";
export type InfoTipEvent =
  | "mouseEnter"
  | "mouseLeave"
  | "click"
  | "focusOut"
  | "escape"
  | "outsideClick";

/**
 * Zustandsübergänge des Info-Panels. Ein Klick fixiert ein per Hover geöffnetes
 * Panel (statt es zu schließen); Verlassen mit der Maus schließt nur `hover`.
 */
export function nextInfoTipMode(
  mode: InfoTipMode,
  event: InfoTipEvent,
): InfoTipMode {
  switch (event) {
    case "mouseEnter":
      return mode === "closed" ? "hover" : mode;
    case "mouseLeave":
      return mode === "hover" ? "closed" : mode;
    case "click":
      return mode === "pinned" ? "closed" : "pinned";
    case "focusOut":
    case "escape":
    case "outsideClick":
      return "closed";
  }
}

interface InfoTipProps {
  /** Name des erklärten Feldes (für `aria-label`). */
  label: string;
  text: string;
  /** ID des Panels (für `aria-controls`). */
  id: string;
}

/**
 * Kleines Info-Symbol mit Erklärtext. Öffnet per Klick/Tap, Hover (nur Maus) und
 * Fokus; schließt bei Escape, Klick außerhalb und Blur. Kein Portal: das Panel
 * ist linksbündig am Symbol verankert, damit es im Dialog nicht übersteht.
 */
export function InfoTip({ label, text, id }: InfoTipProps) {
  const [mode, setMode] = React.useState<InfoTipMode>("closed");
  const open = mode !== "closed";
  const send = (event: InfoTipEvent) =>
    setMode((m) => nextInfoTipMode(m, event));
  const rootRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) send("outsideClick");
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") send("mouseEnter");
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") send("mouseLeave");
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          send("escape");
        }
      }}
    >
      <button
        type="button"
        aria-label={`Erklärung: ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => send("click")}
        onBlur={(e) => {
          if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
            send("focusOut");
          }
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors duration-150 outline-hidden hover:text-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)] aria-expanded:text-[var(--accent)]"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        id={id}
        role="note"
        hidden={!open}
        className="animate-pop absolute left-0 top-full z-20 mt-1.5 w-max max-w-xs rounded-lg border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl"
      >
        {text}
      </span>
    </span>
  );
}
