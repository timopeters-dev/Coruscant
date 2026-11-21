"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useTheme } from "next-themes";
import { ArrowUpRight, CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/frontend/ui/cn";
import {
  COMMAND_EXTRA_PAGES,
  NAV_ITEMS,
  THEME_OPTIONS,
} from "./shell-config";
import { BespinMark } from "./bespin-mark";
import { COMPANION_APP_NAME } from "./companion-app";

const ITEM =
  "group flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] transition-colors duration-100 data-[selected=true]:bg-[var(--surface-elevated)] data-[disabled=true]:opacity-40";

const GROUP =
  "[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3";

function ItemIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition-colors group-data-[selected=true]:border-[var(--text-secondary)] group-data-[selected=true]:text-[var(--text-primary)]">
      {children}
    </span>
  );
}

function EnterHint() {
  return (
    <CornerDownLeft
      className="ml-auto h-3.5 w-3.5 text-[var(--text-muted)] opacity-0 transition-opacity group-data-[selected=true]:opacity-100"
      aria-hidden="true"
    />
  );
}

/** Befehlspalette (⌘K / Strg+K): schnell navigieren und Darstellung wechseln. */
export function CommandMenu({
  finanzCockpitUrl,
}: {
  finanzCockpitUrl: string | null;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);
  const [isMac, setIsMac] = React.useState(true);

  React.useEffect(() => {
    // Plattform erst im Browser bekannt; SSR zeigt das Mac-Symbol.
    const platform = navigator.platform || navigator.userAgent;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalige Plattform-Erkennung nach Hydration
    setIsMac(/Mac|iPhone|iPad/i.test(platform));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Befehlspalette öffnen"
        aria-keyshortcuts="Meta+K Control+K"
        className="group inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border-sub)] bg-[var(--surface)] px-2 text-xs text-[var(--text-secondary)] transition-colors outline-hidden hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] sm:pr-1.5 print:hidden"
      >
        <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <kbd className="hidden rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-px font-sans text-3xs font-medium text-[var(--text-secondary)] sm:inline">
          {isMac ? "⌘K" : "Strg K"}
        </kbd>
      </button>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Befehlspalette"
        loop
        overlayClassName="fixed inset-0 z-[80] bg-[var(--backdrop)] backdrop-blur-[3px] animate-fade"
        contentClassName="fixed left-1/2 top-[12vh] z-[81] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 outline-hidden"
      >
        <div className="animate-pop overflow-hidden rounded-2xl border border-[var(--border-sub)] bg-[var(--surface-overlay)] shadow-[var(--shadow-lg)]">
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
            <Search
              className="h-4 w-4 shrink-0 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <Command.Input
              placeholder="Seite oder Aktion suchen …"
              className="h-12 w-full bg-transparent text-sm text-[var(--text-primary)] outline-hidden placeholder:text-[var(--text-muted)]"
            />
            <kbd className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-px text-3xs font-medium text-[var(--text-secondary)]">
              Esc
            </kbd>
          </div>
          <Command.List className="max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain p-2 transition-[height] duration-200 ease-out [height:var(--cmdk-list-height)]">
            <Command.Empty className="px-3 py-8 text-center text-sm text-[var(--text-secondary)]">
              Nichts gefunden.
            </Command.Empty>

            <Command.Group heading="Navigation" className={GROUP}>
              {[...NAV_ITEMS, ...COMMAND_EXTRA_PAGES].map(({ href, label, Icon, ...rest }) => (
                <Command.Item
                  key={href}
                  value={`${label} ${"keywords" in rest ? rest.keywords : ""}`}
                  onSelect={() => run(() => router.push(href))}
                  className={ITEM}
                >
                  <ItemIcon>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </ItemIcon>
                  <span className="truncate">{label}</span>
                  {"hint" in rest ? (
                    <span className="truncate text-xs text-[var(--text-secondary)]">
                      {rest.hint}
                    </span>
                  ) : null}
                  <EnterHint />
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Darstellung" className={GROUP}>
              {THEME_OPTIONS.map(({ value, label, Icon }) => (
                <Command.Item
                  key={value}
                  value={`Farbschema ${label} Theme`}
                  onSelect={() => run(() => setTheme(value))}
                  className={ITEM}
                >
                  <ItemIcon>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </ItemIcon>
                  <span>Farbschema: {label}</span>
                  <EnterHint />
                </Command.Item>
              ))}
            </Command.Group>

            {finanzCockpitUrl ? (
              <Command.Group heading="Extern" className={GROUP}>
                <Command.Item
                  value={`${COMPANION_APP_NAME} öffnen extern`}
                  onSelect={() =>
                    run(() =>
                      window.open(finanzCockpitUrl, "_blank", "noopener,noreferrer"),
                    )
                  }
                  className={cn(ITEM)}
                >
                  <ItemIcon>
                    <BespinMark className="h-3.5 w-3.5" />
                  </ItemIcon>
                  <span>{COMPANION_APP_NAME} öffnen</span>
                  <ArrowUpRight className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
                  <EnterHint />
                </Command.Item>
              </Command.Group>
            ) : null}
          </Command.List>
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-2 text-2xs text-[var(--text-muted)]">
            <span>↑↓ navigieren · ↵ öffnen</span>
            <span>Coruscant</span>
          </div>
        </div>
      </Command.Dialog>
    </>
  );
}
