import { describe, expect, it } from "vitest";
import { rangeFillStyle } from "./range-fill";

const fill = (v: number, min: number, max: number) =>
  (rangeFillStyle(v, min, max) as Record<string, string>)["--fill"];

describe("rangeFillStyle", () => {
  it("maps value linearly between min and max", () => {
    expect(fill(0, 0, 200)).toBe("0%");
    expect(fill(50, 0, 200)).toBe("25%");
    expect(fill(200, 0, 200)).toBe("100%");
    expect(fill(15, 10, 20)).toBe("50%");
  });

  it("clamps values outside the range", () => {
    expect(fill(-5, 0, 10)).toBe("0%");
    expect(fill(99, 0, 10)).toBe("100%");
  });

  it("returns 0% for an empty or invalid range", () => {
    expect(fill(5, 10, 10)).toBe("0%");
    expect(fill(5, 10, 0)).toBe("0%");
    expect(fill(Number.NaN, 0, 10)).toBe("0%");
  });
});
