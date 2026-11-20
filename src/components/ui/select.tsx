"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_BASE, FIELD_ERROR, FIELD_OK, POPOVER_SURFACE } from "./field-styles";

/**
 * Select im App-Look: Trigger wie ein Eingabefeld, Listbox als schwebendes
 * Panel. Die API bleibt die eines nativen `<select>` (Kinder `<option>` /
 * `<optgroup>`, `onChange(e)` mit `e.target.value`), damit Aufrufer
 * unverändert bleiben.
 */
export interface SelectProps
  extends Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    "onChange" | "value" | "defaultValue"
  > {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  hasError?: boolean;
}

export interface ParsedOption {
  value: string;
  label: React.ReactNode;
  text: string;
  disabled: boolean;
  group: string | null;
}

function nodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

/** Liest `<option>`/`<optgroup>`-Kinder (auch in Fragmenten/Arrays) aus. */
export function parseSelectOptions(
  children: React.ReactNode,
  group: string | null = null,
): ParsedOption[] {
  const result: ParsedOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      const props = child.props as { children?: React.ReactNode };
      result.push(...parseSelectOptions(props.children, group));
      return;
    }
    if (child.type === "optgroup") {
      const props = child.props as { label?: string; children?: React.ReactNode };
      result.push(...parseSelectOptions(props.children, props.label ?? null));
      return;
    }
    if (child.type === "option") {
      const props = child.props as {
        value?: string | number;
        disabled?: boolean;
        children?: React.ReactNode;
      };
      const text = nodeText(props.children);
      result.push({
        value: props.value !== undefined ? String(props.value) : text,
        label: props.children,
        text,
        disabled: Boolean(props.disabled),
        group,
      });
    }
  });
  return result;
}

function makeChangeEvent(value: string, name?: string) {
  const target = { value, name: name ?? "" };
  return { target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>;
}

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className,
      hasError = false,
      children,
      value,
      defaultValue,
      onChange,
      disabled,
      id,
      name,
      required,
      "aria-label": ariaLabel,
      "aria-describedby": ariaDescribedBy,
      title,
    },
    ref,
  ) => {
    const options = React.useMemo(() => parseSelectOptions(children), [children]);
    const [uncontrolled, setUncontrolled] = React.useState(
      defaultValue !== undefined ? String(defaultValue) : (options[0]?.value ?? ""),
    );
    const current = value !== undefined ? String(value) : uncontrolled;
    const selected = options.find((o) => o.value === current) ?? null;

    const [open, setOpen] = React.useState(false);
    const [activeIndex, setActiveIndex] = React.useState(-1);
    const listId = React.useId();
    const listRef = React.useRef<HTMLDivElement>(null);
    const typeahead = React.useRef({ buffer: "", at: 0 });

    const commit = (next: ParsedOption) => {
      if (next.disabled) return;
      if (value === undefined) setUncontrolled(next.value);
      if (next.value !== current) onChange?.(makeChangeEvent(next.value, name));
      setOpen(false);
    };

    const enabledIndex = (from: number, step: 1 | -1) => {
      for (let i = from; i >= 0 && i < options.length; i += step) {
        if (!options[i]!.disabled) return i;
      }
      return -1;
    };

    const openList = () => {
      const idx = options.findIndex((o) => o.value === current);
      setActiveIndex(idx >= 0 ? idx : enabledIndex(0, 1));
      setOpen(true);
    };

    React.useEffect(() => {
      if (!open || activeIndex < 0) return;
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-index="${activeIndex}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    }, [open, activeIndex]);

    const handleTypeahead = (key: string) => {
      const now = Date.now();
      const state = typeahead.current;
      state.buffer = now - state.at > 600 ? key : state.buffer + key;
      state.at = now;
      const needle = state.buffer.toLowerCase();
      const start = Math.max(0, activeIndex);
      const ordered = [...options.slice(start + 1), ...options.slice(0, start + 1)];
      const hit = ordered.find(
        (o) => !o.disabled && o.text.toLowerCase().startsWith(needle),
      );
      if (hit) setActiveIndex(options.indexOf(hit));
    };

    const handleListKeyDown = (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const next = enabledIndex(activeIndex + 1, 1);
          if (next >= 0) setActiveIndex(next);
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const next = enabledIndex(activeIndex - 1, -1);
          if (next >= 0) setActiveIndex(next);
          break;
        }
        case "Home":
          event.preventDefault();
          setActiveIndex(enabledIndex(0, 1));
          break;
        case "End":
          event.preventDefault();
          setActiveIndex(enabledIndex(options.length - 1, -1));
          break;
        case "Enter":
        case " ": {
          event.preventDefault();
          const option = options[activeIndex];
          if (option) commit(option);
          break;
        }
        case "Tab":
          setOpen(false);
          break;
        default:
          if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
            handleTypeahead(event.key);
          }
      }
    };

    let lastGroup: string | null = null;

    return (
      <Popover.Root
        open={open}
        onOpenChange={(next) => (next ? openList() : setOpen(false))}
      >
        <Popover.Trigger asChild disabled={disabled}>
          <button
            ref={ref}
            id={id}
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-invalid={hasError || undefined}
            aria-required={required || undefined}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            title={title}
            disabled={disabled}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
                event.preventDefault();
                openList();
              }
            }}
            className={cn(
              FIELD_BASE,
              "group justify-between gap-2 pr-2.5 text-left",
              hasError ? FIELD_ERROR : FIELD_OK,
              className,
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                !selected?.text && "text-[var(--text-muted)]",
              )}
            >
              {selected ? selected.label : "Bitte wählen"}
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-200 group-aria-expanded:rotate-180"
              aria-hidden="true"
            />
          </button>
        </Popover.Trigger>
        {name ? <input type="hidden" name={name} value={current} /> : null}
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              listRef.current?.focus({ preventScroll: true });
            }}
            className={cn(
              POPOVER_SURFACE,
              "animate-pop min-w-[var(--radix-popover-trigger-width)] max-w-[min(28rem,calc(100vw-1.5rem))] overflow-hidden p-1",
            )}
          >
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-activedescendant={
                activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
              }
              onKeyDown={handleListKeyDown}
              className="max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain outline-hidden"
            >
              {options.map((option, index) => {
                const showGroup = option.group !== null && option.group !== lastGroup;
                lastGroup = option.group;
                const isSelected = option.value === current;
                const isActive = index === activeIndex;
                return (
                  <React.Fragment key={`${option.group ?? ""}-${option.value}-${index}`}>
                    {showGroup ? (
                      <div
                        role="presentation"
                        className="eyebrow px-2.5 pb-1 pt-2.5 first:pt-1.5"
                      >
                        {option.group}
                      </div>
                    ) : null}
                    <div
                      id={`${listId}-opt-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      onPointerMove={() => {
                        if (!option.disabled && activeIndex !== index) setActiveIndex(index);
                      }}
                      onClick={() => commit(option)}
                      className={cn(
                        "relative flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-8 text-sm transition-colors duration-100",
                        isActive && !option.disabled && "bg-[var(--surface-elevated)]",
                        isSelected
                          ? "font-medium text-[var(--text-primary)]"
                          : "text-[var(--text-primary)]/90",
                        option.disabled && "cursor-not-allowed opacity-45",
                        !option.text && "text-[var(--text-secondary)]",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {option.label}
                      </span>
                      {isSelected ? (
                        <Check
                          className="absolute right-2.5 h-3.5 w-3.5 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  },
);
Select.displayName = "Select";
