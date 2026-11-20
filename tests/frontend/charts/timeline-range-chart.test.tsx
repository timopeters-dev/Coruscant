import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimelineRangeChart, type TimelineRow } from "@/frontend/charts/timeline-range-chart";

describe("TimelineRangeChart", () => {
  it("renders filled, none, equal both, and differing both rows correctly", () => {
    const rows: TimelineRow[] = [
      { id: "p1", label: "Notgroschen", status: "filled", from: 0, to: 0 },
      { id: "p2", label: "Urlaub", status: "both", from: 24, to: 16 },
      { id: "p3", label: "Auto", status: "both", from: 30, to: 30 },
      { id: "p4", label: "Reserve", status: "none", from: null, to: null },
    ];

    const html = renderToStaticMarkup(
      <TimelineRangeChart
        rows={rows}
        xMax={36}
        xTicks={[
          { x: 0, label: "heute" },
          { x: 36, label: "01.2030" },
        ]}
        xTooltipLabel={(x) => `M${x}`}
        fromLabel="heute"
        toLabel="mit Änderung"
        ariaLabel="Füllzeitpunkte"
      />,
    );

    expect(html).toContain("bereits gefüllt");
    expect(html).toContain("nicht im Zeitraum");
    // p2 has baseline + scenario (2 points), p3 has only scenario (1 point) -> 3 total points
    const baselinePoints = html.match(/data-point="baseline"/g) ?? [];
    const scenarioPoints = html.match(/data-point="scenario"/g) ?? [];
    expect(baselinePoints).toHaveLength(1);
    expect(scenarioPoints).toHaveLength(2);
  });
});
