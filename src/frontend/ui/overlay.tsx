"use client";

import * as React from "react";
import { createPortal } from "react-dom";

const emptySubscribe = () => () => {};

/** `true` erst im Browser nach dem Mount (SSR/Tests rendern inline). */
export function useIsMounted(): boolean {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Hängt Overlays an `document.body`, damit `position: fixed` nicht von
 * animierten/transformierten Vorfahren eingefangen wird.
 */
export function OverlayPortal({ children }: { children: React.ReactNode }) {
  const mounted = useIsMounted();
  if (!mounted) return <>{children}</>;
  return createPortal(children, document.body);
}

// Stapel offener Overlays: nur das oberste reagiert auf Escape/Tab.
const overlayStack: symbol[] = [];
let scrollLockCount = 0;
let previousOverflow = "";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Gemeinsames Verhalten modaler Overlays: Escape schließt (außer ein inneres
 * Popover hat das Event schon verbraucht), Tab bleibt im Panel, Body-Scroll
 * ist gesperrt und der Fokus kehrt beim Schließen zum Auslöser zurück.
 */
export function useModalBehavior(
  open: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLElement | null>,
) {
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!open) return;
    const token = Symbol("overlay");
    overlayStack.push(token);
    const isTop = () => overlayStack[overlayStack.length - 1] === token;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (scrollLockCount === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLockCount += 1;

    const focusFrame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const autofocus = panel.querySelector<HTMLElement>("[autofocus]");
      (autofocus ?? panel).focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const active = document.activeElement;
      if (active && active !== document.body && !panel.contains(active)) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === active);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      const idx = overlayStack.indexOf(token);
      if (idx >= 0) overlayStack.splice(idx, 1);
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) {
        document.body.style.overflow = previousOverflow;
      }
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, panelRef]);
}
