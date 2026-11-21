import { COMPANION_APP_NAME } from "./companion-app";
import {
  Building2,
  Calculator,
  FileSpreadsheet,
  Receipt,
  FlaskConical,
  GitFork,
  Inbox,
  LayoutDashboard,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Cockpit", Icon: LayoutDashboard },
  { href: "/vertraege", label: "Verträge", Icon: FileSpreadsheet },
  { href: "/allokation", label: "Allokation", Icon: GitFork },
  { href: "/planung", label: "Planung", Icon: FlaskConical },
  { href: "/dokumente", label: "Dokumente", Icon: Inbox },
] as const;

/** Zusätzliche Sprungziele der Befehlspalette (Unterseiten). */
export const COMMAND_EXTRA_PAGES = [
  {
    href: "/vertraege?tab=portfolio",
    label: "Portfolio",
    hint: "Vermietete Objekte",
    keywords: "Vermietung Miete Immobilien",
    Icon: Building2,
  },
  {
    href: "/planung/kaufrechner",
    label: "Kaufrechner",
    hint: "Immobilienkauf simulieren",
    keywords: "Immobilie Kauf Finanzierung",
    Icon: Calculator,
  },
  {
    href: "/dokumente/steuer",
    label: "Steuer-Übersicht",
    hint: "Jahres-Belegmappe",
    keywords: "Steuer Belege 35a",
    Icon: Receipt,
  },
] as const;

export function isNavItemActive(
  pathname: string | null | undefined,
  href: string,
): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const THEME_OPTIONS = [
  { value: "light", label: "Hell", Icon: Sun },
  { value: "dark", label: "Dunkel", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

export type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];

export function resolveActiveTheme(
  mounted: boolean,
  theme: string | undefined,
): ThemeValue {
  if (!mounted) return "system";
  const match = THEME_OPTIONS.find((option) => option.value === theme);
  return match ? match.value : "system";
}

export const FINANZ_COCKPIT_LINK = {
  label: COMPANION_APP_NAME,
  ariaLabel: `${COMPANION_APP_NAME} (öffnet in neuem Tab)`,
} as const;
