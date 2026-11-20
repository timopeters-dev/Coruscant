import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SliderField } from "@/frontend/planung/euro-slider-field";

const noop = () => {};

describe("SliderField", () => {
  it("rendert negative Prozentwerte, wenn das Regler-Minimum negativ ist", () => {
    const html = renderToStaticMarkup(
      <SliderField
        id="etf-return"
        label="ETF-Rendite"
        kind="percent"
        value={-5000}
        min={-5000}
        max={3000}
        step={50}
        onChange={noop}
      />,
    );
    expect(html).toContain('value="-50,00"');
    expect(html).toContain('min="-5000"');
  });

  it("rendert 0 % am unteren Rand ohne Fehler", () => {
    const html = renderToStaticMarkup(
      <SliderField
        id="safety"
        label="Aufschlag"
        kind="percent"
        value={0}
        min={0}
        max={500}
        step={25}
        onChange={noop}
      />,
    );
    expect(html).toContain('value="0,00"');
  });
});
