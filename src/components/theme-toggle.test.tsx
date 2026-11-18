import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const currentTheme: string | undefined = "dark";
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: currentTheme, setTheme: vi.fn() }),
}));

import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  const html = renderToStaticMarkup(<ThemeToggle />);

  it("Gruppe mit Label", () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Farbschema wählen"');
  });

  it("drei Buttons mit aria-label und title", () => {
    expect(html.match(/<button[^>]*type="button"/g)).toHaveLength(3);
    for (const l of ["Hell", "Dunkel", "System"]) {
      expect(html).toContain(`aria-label="${l}"`);
      expect(html).toContain(`title="${l}"`);
    }
  });

  it("Server-Render: nur System gedrückt, auch bei Theme dark", () => {
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="System"/);
  });

  it("Fokus bleibt im Kontrastmodus sichtbar", () => {
    expect(html).toContain("outline-hidden");
    expect(html).not.toContain("outline-none");
  });

  it("kein Command Deck, kein sichtbarer Label-Text", () => {
    expect(html).not.toContain("Command Deck");
    expect(html).not.toMatch(/>(Hell|Dunkel|System)</);
  });
});
