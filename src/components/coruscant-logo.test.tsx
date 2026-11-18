import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoruscantLogo } from "./coruscant-logo";

describe("CoruscantLogo", () => {
  it("ist dekoratives SVG mit viewBox", () => {
    const html = renderToStaticMarkup(<CoruscantLogo className="h-6 w-6" />);
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
  });

  it("mask-Referenz zeigt auf vorhandene id", () => {
    const html = renderToStaticMarkup(<CoruscantLogo />);
    const ref = /mask="url\(#([^)]+)\)"/.exec(html);
    expect(ref).not.toBeNull();
    expect(html).toContain(`id="${ref![1]}"`);
  });

  it("Masken-IDs sind eindeutig und enthalten nur erlaubte Zeichen", () => {
    const html = renderToStaticMarkup(
      <>
        <CoruscantLogo />
        <CoruscantLogo />
      </>,
    );
    const ids = [...html.matchAll(/<mask id="([^"]*)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
