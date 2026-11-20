import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sparkline } from "@/frontend/charts/sparkline";

describe("Sparkline", () => {
  it("renders nothing when fewer than 2 values are provided", () => {
    expect(renderToStaticMarkup(<Sparkline values={[]} role="liabilities" />)).toBe("");
    expect(renderToStaticMarkup(<Sparkline values={[100_000]} role="liabilities" />)).toBe("");
  });

  it("renders a dashed path with role color and aria-hidden for >= 2 values", () => {
    const html = renderToStaticMarkup(
      <Sparkline values={[1_000_000, 750_000, 500_000]} role="liabilities" />,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<path ");
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toContain('stroke="var(--rose)"');
  });
});
