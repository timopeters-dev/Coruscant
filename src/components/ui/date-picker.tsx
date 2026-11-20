"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker, type ChevronProps } from "react-day-picker";
import { de } from "react-day-picker/locale";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  dateToIso,
  formatIsoDateInput,
  formatIsoMonthLabel,
  isWithinIsoBounds,
  isoToDate,
  MONTH_SHORT_DE,
  parseDateInput,
  parseIsoMonth,
  toIsoMonth,
} from "./date-input";
import { FIELD_BASE, FIELD_ERROR, FIELD_OK, POPOVER_SURFACE } from "./field-styles";

interface DatePickerProps {
  id?: string;
  /** ISO-Datum `YYYY-MM-DD` oder leer. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  hasError?: boolean;
  className?: string;
  placeholder?: string;
  /** Leeren erlauben (Standard: ja). */
  clearable?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

function CalendarChevron({ orientation, className }: ChevronProps) {
  const Icon =
    orientation === "left"
      ? ChevronLeft
      : orientation === "right"
        ? ChevronRight
        : orientation === "up"
          ? ChevronUp
          : ChevronDown;
  return <Icon className={cn("h-4 w-4", className)} aria-hidden="true" />;
}

const NAV_BUTTON =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-30 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]";

const FOOTER_BUTTON =
  "rounded-md px-2 py-1 text-xs font-medium transition-colors outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]";

/**
 * Datumsfeld: Eingabe als `TT.MM.JJJJ` oder Auswahl im Kalender-Popover.
 * Der Wert bleibt ein ISO-String; ungültige Eingaben werden nicht übernommen.
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  disabled = false,
  hasError = false,
  className,
  placeholder = "TT.MM.JJJJ",
  clearable = true,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<string | null>(null);
  const selected = isoToDate(value);
  const [month, setMonth] = React.useState<Date>(selected ?? new Date());

  const text = draft ?? formatIsoDateInput(value);
  const parsedDraft = draft === null ? undefined : parseDateInput(draft);
  const draftInvalid =
    draft !== null &&
    (parsedDraft === null ||
      (parsedDraft !== "" && !isWithinIsoBounds(parsedDraft ?? "", min, max)));

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseDateInput(draft);
    if (parsed === "" && clearable) {
      if (value !== "") onChange("");
      setDraft(null);
    } else if (parsed && isWithinIsoBounds(parsed, min, max)) {
      if (parsed !== value) onChange(parsed);
      setDraft(null);
    }
  };

  const minDate = isoToDate(min);
  const maxDate = isoToDate(max);
  const disabledMatchers = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];
  const thisYear = new Date().getFullYear();
  const startMonth = minDate ?? new Date(Math.min(thisYear - 40, 1980), 0, 1);
  const endMonth = maxDate ?? new Date(thisYear + 45, 11, 1);
  const today = new Date();
  const todayIso = dateToIso(today);
  const todayAllowed = isWithinIsoBounds(todayIso, min, max);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(isoToDate(value) ?? new Date());
        setOpen(next);
      }}
    >
      <Popover.Anchor asChild>
        <div
          className={cn(
            FIELD_BASE,
            "relative gap-1 p-0 focus-within:ring-[3px]",
            hasError || draftInvalid
              ? cn(FIELD_ERROR, "focus-within:ring-[color-mix(in_srgb,var(--rose)_22%,transparent)]")
              : cn(
                  FIELD_OK,
                  "focus-within:border-[var(--accent)] focus-within:ring-[var(--focus)]",
                  open &&
                    "border-[var(--accent)] ring-[3px] ring-[var(--focus)]",
                ),
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          <input
            id={id}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            aria-invalid={hasError || draftInvalid || undefined}
            value={text}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              const parsed = parseDateInput(next);
              if (
                parsed &&
                next.trim().length >= 8 &&
                isWithinIsoBounds(parsed, min, max) &&
                parsed !== value
              ) {
                onChange(parsed);
              }
            }}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitDraft();
              if (event.key === "ArrowDown" && event.altKey) {
                event.preventDefault();
                setOpen(true);
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent pl-3 text-sm tabular-nums text-[var(--text-primary)] outline-hidden placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed"
          />
          <Popover.Trigger asChild disabled={disabled}>
            <button
              type="button"
              aria-label="Kalender öffnen"
              tabIndex={-1}
              className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--accent)] data-[state=open]:text-[var(--accent)]"
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
            </button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(POPOVER_SURFACE, "animate-pop p-3")}
        >
          <DayPicker
            mode="single"
            locale={de}
            weekStartsOn={1}
            showOutsideDays
            fixedWeeks
            autoFocus
            captionLayout="dropdown"
            startMonth={startMonth}
            endMonth={endMonth}
            month={month}
            onMonthChange={setMonth}
            selected={selected}
            disabled={disabledMatchers}
            onSelect={(date) => {
              if (date) {
                onChange(dateToIso(date));
              } else if (clearable) {
                onChange("");
              }
              setDraft(null);
              setOpen(false);
            }}
            components={{ Chevron: CalendarChevron }}
            classNames={DAY_PICKER_CLASSES}
          />
          <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2">
            <button
              type="button"
              disabled={!todayAllowed}
              onClick={() => {
                onChange(todayIso);
                setDraft(null);
                setOpen(false);
              }}
              className={cn(
                FOOTER_BUTTON,
                "text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40",
              )}
            >
              Heute
            </button>
            {clearable && value ? (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setDraft(null);
                  setOpen(false);
                }}
                className={cn(
                  FOOTER_BUTTON,
                  "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]",
                )}
              >
                Leeren
              </button>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const DAY_PICKER_CLASSES = {
  root: "relative text-sm",
  months: "relative flex flex-col",
  month: "space-y-2",
  month_caption: "flex h-8 items-center pl-1",
  caption_label:
    "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold capitalize text-[var(--text-primary)] [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-[var(--text-secondary)]",
  dropdowns: "flex items-center gap-0.5",
  dropdown_root:
    "relative inline-flex items-center rounded-md transition-colors hover:bg-[var(--surface-elevated)] has-[select:focus-visible]:ring-[3px] has-[select:focus-visible]:ring-[var(--focus)]",
  dropdown:
    "absolute inset-0 z-10 w-full cursor-pointer appearance-none opacity-0",
  nav: "absolute right-0 top-0 flex items-center gap-0.5",
  button_previous: NAV_BUTTON,
  button_next: NAV_BUTTON,
  chevron: "",
  month_grid: "border-collapse",
  weekdays: "flex",
  weekday:
    "w-9 pb-1 text-center text-2xs font-medium text-[var(--text-muted)]",
  weeks: "",
  week: "flex",
  day: "group/day relative h-9 w-9 p-0 text-center",
  day_button:
    "relative m-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm tabular-nums text-[var(--text-primary)] transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-[var(--surface-elevated)] active:scale-95 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] " +
    "group-data-[selected=true]/day:bg-[var(--accent)] group-data-[selected=true]/day:font-semibold group-data-[selected=true]/day:text-white group-data-[selected=true]/day:shadow-[var(--shadow-accent)] " +
    "group-data-[today=true]/day:font-semibold group-data-[today=true]/day:text-[var(--accent)] group-data-[today=true]/day:group-data-[selected=true]/day:text-white " +
    "group-data-[outside=true]/day:text-[var(--text-muted)] group-data-[outside=true]/day:opacity-60 " +
    "group-data-[disabled=true]/day:pointer-events-none group-data-[disabled=true]/day:opacity-30",
  selected: "",
  today: "",
  outside: "",
  disabled: "",
  hidden: "invisible",
  footer: "",
};

interface MonthPickerProps {
  id?: string;
  /** `YYYY-MM` */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  hasError?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Monatsauswahl (`YYYY-MM`) mit Jahres-Navigation und Monatsraster. */
export function MonthPicker({
  id,
  value,
  onChange,
  min,
  max,
  disabled = false,
  hasError = false,
  className,
  "aria-label": ariaLabel,
}: MonthPickerProps) {
  const parsed = parseIsoMonth(value);
  const [open, setOpen] = React.useState(false);
  const [year, setYear] = React.useState(parsed?.year ?? new Date().getFullYear());
  const minParsed = parseIsoMonth(min);
  const maxParsed = parseIsoMonth(max);
  const gridRef = React.useRef<HTMLDivElement>(null);

  const isAllowed = (y: number, m: number) => {
    const iso = toIsoMonth(y, m);
    if (min && iso < min) return false;
    if (max && iso > max) return false;
    return true;
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setYear(parseIsoMonth(value)?.year ?? new Date().getFullYear());
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          data-invalid={hasError || undefined}
          disabled={disabled}
          className={cn(
            FIELD_BASE,
            "group justify-between gap-2 pr-2 text-left tabular-nums",
            hasError ? FIELD_ERROR : FIELD_OK,
            className,
          )}
        >
          <span className={cn("truncate", !parsed && "text-[var(--text-muted)]")}>
            {parsed ? formatIsoMonthLabel(value) : "Monat wählen"}
          </span>
          <CalendarDays
            className="h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-colors group-data-[state=open]:text-[var(--accent)]"
            aria-hidden="true"
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const target =
              gridRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
              gridRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
            target?.focus();
          }}
          className={cn(POPOVER_SURFACE, "animate-pop w-64 p-3")}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Vorheriges Jahr"
              className={NAV_BUTTON}
              disabled={minParsed !== null && year <= minParsed.year}
              onClick={() => setYear((y) => y - 1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
              {year}
            </span>
            <button
              type="button"
              aria-label="Nächstes Jahr"
              className={NAV_BUTTON}
              disabled={maxParsed !== null && year >= maxParsed.year}
              onClick={() => setYear((y) => y + 1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div ref={gridRef} className="grid grid-cols-3 gap-1">
            {MONTH_SHORT_DE.map((label, idx) => {
              const m = idx + 1;
              const active = parsed?.year === year && parsed.month === m;
              const allowed = isAllowed(year, m);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={active}
                  disabled={!allowed}
                  onClick={() => {
                    onChange(toIsoMonth(year, m));
                    setOpen(false);
                  }}
                  className={cn(
                    "h-9 rounded-lg text-sm transition-[background-color,color,transform] duration-150 active:scale-95 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:pointer-events-none disabled:opacity-30",
                    active
                      ? "bg-[var(--accent)] font-semibold text-white shadow-[var(--shadow-accent)]"
                      : "text-[var(--text-primary)] hover:bg-[var(--surface-elevated)]",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
