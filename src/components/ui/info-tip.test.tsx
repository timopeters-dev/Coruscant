import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoTip } from "./info-tip";

// Hinweis: Im Projekt gibt es keine DOM-Testumgebung (kein jsdom/happy-dom, kein neues
// Paket erlaubt). Die Interaktion (Klick, Escape, Außenklick, Hover nur per Maus) wird
// daher manuell im Browser geprüft; hier steht der Ruhezustand des Markups.
describe("InfoTip (Ruhezustand)", () => {
  const html = renderToStaticMarkup(
    <InfoTip label="Darlehenszins" text="Sollzins p. a." id="tip-1" />,
  );

  it("Button ist beschriftet und geschlossen", () => {
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Erklärung: Darlehenszins"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="tip-1"');
  });

  it("Panel ist verborgen, hat role=note und den Text", () => {
    expect(html).toMatch(/<span id="tip-1" role="note" hidden=""/);
    expect(html).toContain("Sollzins p. a.");
  });

  it("Panel ist linksbündig verankert und nicht amber/gestrichelt", () => {
    expect(html).toContain("left-0");
    expect(html).toContain("max-w-xs");
    expect(html).not.toContain("amber");
    expect(html).not.toContain("border-dashed");
  });
});
