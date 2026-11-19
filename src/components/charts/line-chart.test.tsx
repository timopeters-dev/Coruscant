import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LineChart,
  shouldCloseOnPointerLeave,
  type LineSeries,
} from "./line-chart";

const sampleSeries: LineSeries[] = [
  {
    id: "a",
    label: "Sondertilgung",
    role: "optionA",
    dashed: true,
    points: [
      { x: 0, y: 0 },
      { x: 12, y: 500_000 },
      { x: 24, y: 1_200_000 },
    ],
  },
  {
    id: "b",
    label: "ETF-Ansparung",
    role: "optionB",
    dashed: false,
    points: [
      { x: 0, y: 0 },
      { x: 12, y: 600_000 },
      { x: 24, y: 1_500_000 },
    ],
  },
];

describe("LineChart", () => {
  it("renders a path per series with expected dasharray, token color, aria-label, and tabular-nums", () => {
    const html = renderToStaticMarkup(
      <LineChart
        series={sampleSeries}
        xTicks={[
          { x: 0, label: "heute" },
          { x: 24, label: "01/2029" },
        ]}
        xTooltipLabel={(x) => `Monat ${x}`}
        ariaLabel="Vergleich Sondertilgung und ETF"
      />,
    );

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Vergleich Sondertilgung und ETF"');
    const pathMatches = html.match(/<path /g) ?? [];
    expect(pathMatches).toHaveLength(2);
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toContain('stroke="var(--sky)"');
    expect(html).toContain('stroke="var(--accent)"');
    expect(html).toContain("tabular-nums");
  });

  it("renders empty text without svg when fewer than 2 points exist", () => {
    const html = renderToStaticMarkup(
      <LineChart
        series={[
          {
            id: "a",
            label: "Leer",
            role: "optionA",
            dashed: true,
            points: [{ x: 0, y: 0 }],
          },
        ]}
        xTicks={[{ x: 0, label: "heute" }]}
        xTooltipLabel={() => "heute"}
        ariaLabel="Leeres Diagramm"
        emptyText="Zu wenige Datenpunkte."
      />,
    );

    expect(html).not.toContain("<svg");
    expect(html).toContain("Zu wenige Datenpunkte.");
  });

  it("keeps tooltip open on touch pointerleave but closes on mouse/pen pointerleave", () => {
    expect(shouldCloseOnPointerLeave("touch")).toBe(false);
    expect(shouldCloseOnPointerLeave("mouse")).toBe(true);
    expect(shouldCloseOnPointerLeave("pen")).toBe(true);
  });

  it("splits path with M on gapBefore, draws circles for isolated single points, and renders negative y-ticks", () => {
    const html = renderToStaticMarkup(
      <LineChart
        series={[
          {
            id: "net",
            label: "Nettovermögen",
            role: "netWorth",
            dashed: true,
            points: [
              { x: 1, y: -50_000 },
              { x: 2, y: 100_000, gapBefore: true },
              { x: 10, y: 200_000, gapBefore: true },
              { x: 11, y: 250_000 },
            ],
          },
        ]}
        xTicks={[
          { x: 1, label: "01.11." },
          { x: 11, label: "heute" },
        ]}
        xTooltipLabel={(x) => `Tag ${x}`}
        ariaLabel="Nettovermögen mit Lücken"
      />,
    );

    const pathMatch = html.match(/<path d="([^"]+)"/);
    expect(pathMatch?.[1]).toBeDefined();
    const mCount = ((pathMatch?.[1] ?? "").match(/M/g) ?? []).length;
    expect(mCount).toBe(3); // start + 2 gapBefore points
    // Points 1 (isolated before gap) and 2 (isolated between two gaps) get <circle>
    const circleMatches = html.match(/<circle /g) ?? [];
    expect(circleMatches).toHaveLength(2);
    // Negative y-tick with unicode minus and 0 € tick
    expect(html).toContain("0 €");
    expect(html).toContain("−");
  });
});
