/**
 * Gemeinsame Klassen für alle Eingabeflächen (Input, Select, DatePicker …),
 * damit Höhe, Rahmen, Fokus-Glow und Fehlerzustand überall identisch sind.
 */
export const FIELD_BASE =
  "flex h-9 w-full items-center rounded-lg border bg-[var(--surface)] px-3 text-sm text-[var(--text-primary)] shadow-[var(--shadow-xs)] transition-[border-color,box-shadow,background-color] duration-150 ease-out " +
  "placeholder:text-[var(--text-muted)] " +
  "focus-visible:outline-hidden focus-visible:ring-[3px] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const FIELD_OK =
  "border-[var(--border)] hover:border-[var(--border-sub)] focus-visible:border-[var(--accent)] focus-visible:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)] data-[state=open]:border-[var(--accent)] data-[state=open]:ring-[3px] data-[state=open]:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]";

export const FIELD_ERROR =
  "border-[var(--rose)] focus-visible:border-[var(--rose)] focus-visible:ring-[color-mix(in_srgb,var(--rose)_22%,transparent)]";

/** Schwebende Fläche für Popover, Listboxen, Kalender und Tooltips. */
export const POPOVER_SURFACE =
  "z-[70] rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl outline-hidden";

/** Einheitlicher Fokus-Ring für klickbare Elemente ohne eigenen Rahmen. */
export const FOCUS_RING =
  "outline-hidden focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]";
