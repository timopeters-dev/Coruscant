import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let currentPath = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

import { AppShell } from "./app-shell";
import { NAV_ITEMS } from "./shell-config";

const countMatches = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const render = (path: string, url?: string | null) => {
  currentPath = path;
  return renderToStaticMarkup(
    <AppShell finanzCockpitUrl={url}>
      <p>Inhalt</p>
    </AppShell>,
  );
};
const COCKPIT = "http://cockpit.example.test";

describe("AppShell Grundgerüst", () => {
  const html = render("/");
  it("beide Navigationen vorhanden", () => {
    expect(html).toContain('aria-label="Hauptnavigation"');
    expect(html).toContain('aria-label="Mobile Navigation"');
  });
  it("Hauptnavigation: Label nur ab lg sichtbar, Titel als Tooltip", () => {
    for (const { label } of NAV_ITEMS) {
      expect(
        countMatches(
          html,
          new RegExp(`<span class="sr-only lg:not-sr-only">${label}</span>`, "g"),
        ),
      ).toBe(1);
      expect(html).toContain(`title="${label}"`);
    }
  });
  it("Mobile-Leiste: Label immer sichtbar", () => {
    for (const { label } of NAV_ITEMS)
      expect(countMatches(html, new RegExp(`<span>${label}</span>`, "g"))).toBe(1);
  });
  it("Fokus bleibt im Kontrastmodus sichtbar (outline-hidden statt outline-none)", () => {
    expect(html).toContain("outline-hidden");
    expect(html).not.toContain("outline-none");
  });
});

describe("aktiver Zustand", () => {
  it("/vertraege/abc: zwei aria-current am Link /vertraege", () => {
    const html = render("/vertraege/abc");
    expect(countMatches(html, /aria-current="page"/g)).toBe(2);
    expect(
      countMatches(html, /<a href="\/vertraege"[^>]*aria-current="page"/g),
    ).toBe(2);
  });
  it("/: zwei aria-current, Startseiten-Link ohne", () => {
    const html = render("/");
    expect(countMatches(html, /aria-current="page"/g)).toBe(2);
    expect(
      countMatches(html, /<a href="\/"[^>]*aria-current="page"/g),
    ).toBe(2);
    expect(html).not.toMatch(/<a href="\/"[^>]*aria-label="Coruscant – Startseite"[^>]*aria-current/);
  });
  it("unbekannter Pfad: kein aria-current", () => {
    expect(countMatches(render("/unbekannt"), /aria-current/g)).toBe(0);
  });
});

describe("Wortmarke", () => {
  const html = render("/");
  it("Startseiten-Link mit Logo und Text", () => {
    const m = /<a href="\/"[^>]*aria-label="Coruscant – Startseite"[^>]*>(.*?)<\/a>/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('<svg');
    expect(m![1]).toContain('aria-hidden="true"');
    expect(m![1]).toContain("Coruscant");
  });
  it("kein C-Quadrat", () => {
    expect(html).not.toMatch(/>C</);
  });
});

describe("externer Link", () => {
  it("genau ein Link mit allen Attributen, außerhalb der Hauptnavigation", () => {
    const html = render("/", COCKPIT);
    expect(countMatches(html, new RegExp(`href="${COCKPIT}"`, "g"))).toBe(1);
    const a = /<a [^>]*href="http:\/\/cockpit\.example\.test"[^>]*>/.exec(html)![0];
    expect(a).toContain('target="_blank"');
    expect(a).toContain('rel="noopener noreferrer"');
    expect(a).toContain('aria-label="Finanz Cockpit (öffnet in neuem Tab)"');
    expect(html).toContain("<span>Finanz Cockpit</span>");
    const navStart = html.indexOf('aria-label="Hauptnavigation"');
    const navEnd = html.indexOf("</nav>", navStart);
    expect(html.indexOf(COCKPIT)).toBeGreaterThan(navEnd);
    expect(html).not.toContain("finanz_cockpit");
  });
  it.each([null, undefined, ""])("ohne URL (%s) kein Link, kein Trennstrich", (u) => {
    const html = render("/", u);
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain("Finanz Cockpit");
    expect(html).not.toContain("w-px");
  });
});
