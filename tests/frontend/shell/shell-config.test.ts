import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FINANZ_COCKPIT_LINK,
  NAV_ITEMS,
  THEME_OPTIONS,
  isNavItemActive,
  resolveActiveTheme,
} from "@/frontend/shell/shell-config";

describe("isNavItemActive", () => {
  it("Cockpit nur exakt auf /", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/vertraege", "/")).toBe(false);
  });

  it("Unterseiten aktivieren ihren Eintrag", () => {
    expect(isNavItemActive("/vertraege", "/vertraege")).toBe(true);
    expect(isNavItemActive("/vertraege/123", "/vertraege")).toBe(true);
    expect(isNavItemActive("/dokumente/steuer", "/dokumente")).toBe(true);
  });

  it("verlangt eine Segmentgrenze", () => {
    expect(isNavItemActive("/vertraege-alt", "/vertraege")).toBe(false);
    expect(isNavItemActive("/planungen", "/planung")).toBe(false);
  });

  it("behandelt leere Pfade", () => {
    expect(isNavItemActive(null, "/")).toBe(false);
    expect(isNavItemActive(undefined, "/vertraege")).toBe(false);
    expect(isNavItemActive("", "/")).toBe(false);
  });

  it("akzeptiert abschließenden Slash", () => {
    expect(isNavItemActive("/planung/", "/planung")).toBe(true);
  });

  it("genau ein Eintrag je bekannter Route, keiner bei unbekannter", () => {
    const routes = [
      "/",
      "/vertraege",
      "/vertraege/x",
      "/allokation",
      "/planung",
      "/planung/kaufrechner",
      "/dokumente",
      "/dokumente/steuer",
    ];
    for (const route of routes) {
      const active = NAV_ITEMS.filter((i) => isNavItemActive(route, i.href));
      expect(active, route).toHaveLength(1);
    }
    expect(
      NAV_ITEMS.filter((i) => isNavItemActive("/unbekannt", i.href)),
    ).toHaveLength(0);
  });
});

describe("THEME_OPTIONS", () => {
  it("Werte und Labels", () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual([
      "light",
      "dark",
      "system",
    ]);
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual([
      "Hell",
      "Dunkel",
      "System",
    ]);
  });

  it("enthält kein „Command Deck“", () => {
    for (const o of THEME_OPTIONS) expect(o.label).not.toContain("Command Deck");
  });
});

describe("resolveActiveTheme", () => {
  it("vor dem Mount immer System", () => {
    expect(resolveActiveTheme(false, "dark")).toBe("system");
  });

  it("gemountet: bekannte Werte", () => {
    expect(resolveActiveTheme(true, "light")).toBe("light");
    expect(resolveActiveTheme(true, "dark")).toBe("dark");
    expect(resolveActiveTheme(true, "system")).toBe("system");
  });

  it("unbekannte Werte fallen auf System", () => {
    expect(resolveActiveTheme(true, undefined)).toBe("system");
    expect(resolveActiveTheme(true, "")).toBe("system");
    expect(resolveActiveTheme(true, "command-deck")).toBe("system");
  });
});

describe("FINANZ_COCKPIT_LINK", () => {
  it("Label und Aria-Label", () => {
    expect(FINANZ_COCKPIT_LINK.label).toBe("Bespin");
    expect(FINANZ_COCKPIT_LINK.ariaLabel).toContain(FINANZ_COCKPIT_LINK.label);
    expect(FINANZ_COCKPIT_LINK.ariaLabel).toContain("neuem Tab");
    expect(FINANZ_COCKPIT_LINK.label).not.toContain("_");
  });
});

describe("src/app/icon.svg", () => {
  const svg = readFileSync(
    path.resolve(process.cwd(), "src/app/icon.svg"),
    "utf8",
  );

  it("ist wohlgeformt und passend aufgebaut", () => {
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain("prefers-color-scheme: dark");
  });

  it("nutzt keine CSS-Variablen", () => {
    expect(svg).not.toContain("var(--");
  });
});
