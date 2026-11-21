import * as React from "react";
import { StatusBadge } from "./status-badge";
import { cn } from "./cn";
import { CARD_SURFACE } from "./card";

/**
 * Rechenband: Kennzahlen, die rechnerisch zusammenhängen, stehen als
 * Gleichung nebeneinander (z. B. Aktiva − Passiva = Nettovermögen) statt als
 * gleichförmige Kachel-Reihe. Auf schmalen Schirmen untereinander, die
 * Rechenzeichen werden dann zu Trennlinien.
 */
export function Equation({
  label,
  modeled = false,
  footer,
  className,
  children,
}: {
  /** Zugänglicher Name des Bandes (z. B. „Bilanz“). */
  label: string;
  /** Mindestens ein Glied ist modelliert → gestrichelter Rahmen. */
  modeled?: boolean;
  /** Fußzeile unter einer Haarlinie (Quelle, Stand, Aktion). */
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children).filter(React.isValidElement);
  const termCount = items.filter((child) => child.type === EquationTerm).length;
  const columns = Array.from({ length: termCount }, (_, index) =>
    index === termCount - 1 ? "minmax(0,1.15fr)" : "minmax(0,1fr)",
  ).join(" auto ");

  return (
    <section
      aria-label={label}
      className={cn(
        CARD_SURFACE,
        "grid gap-y-3 p-5 sm:p-6 md:grid-cols-(--eq-cols) md:gap-x-6 md:gap-y-5",
        modeled && "border-dashed border-[var(--border-sub)]",
        className,
      )}
      style={{ "--eq-cols": columns } as React.CSSProperties}
    >
      {items}
      {footer ? (
        <div className="col-span-full -mx-5 -mb-5 mt-1 border-t border-[var(--border)] px-5 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** Ein Glied der Gleichung: Bezeichnung, Betrag, optionale Details. */
export function EquationTerm({
  label,
  value,
  valueClassName,
  modeled = false,
  emphasis = false,
  size = "lg",
  children,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  modeled?: boolean;
  /** Ergebnis der Gleichung: größere Ziffern. */
  emphasis?: boolean;
  /** `md` für Bänder mit vielen Gliedern. */
  size?: "lg" | "md";
  children?: React.ReactNode;
}) {
  const figureSize =
    size === "lg"
      ? emphasis
        ? "text-[2.5rem] leading-[2.875rem] sm:text-[2.75rem] sm:leading-[3.125rem]"
        : "text-[2rem] leading-10"
      : emphasis
        ? "text-[2rem] leading-10"
        : "text-[1.625rem] leading-8";

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] [font-family:var(--font-sans)]">
          {label}
        </h2>
        {modeled ? <StatusBadge variant="modeled" /> : null}
      </div>
      <p
        className={cn(
          "figure mt-1.5 whitespace-nowrap text-[var(--text-primary)]",
          figureSize,
          valueClassName,
        )}
      >
        {value}
      </p>
      {children ? <div className="mt-2.5 space-y-1.5">{children}</div> : null}
    </div>
  );
}

/** Rechenzeichen zwischen den Gliedern – auf schmalen Schirmen als Trennlinie. */
export function EquationOperator({
  symbol,
  label,
}: {
  symbol: "+" | "−" | "=";
  label: string;
}) {
  return (
    <div
      className="flex items-center gap-3 md:flex-col md:items-center md:pt-5"
      aria-label={label}
      role="img"
    >
      <span className="h-px flex-1 bg-[var(--border)] md:hidden" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="font-[family-name:var(--font-display)] text-xl font-medium leading-6 text-[var(--text-muted)] md:text-[2rem] md:leading-10"
      >
        {symbol}
      </span>
      <span className="h-px flex-1 bg-[var(--border)] md:hidden" aria-hidden="true" />
    </div>
  );
}
