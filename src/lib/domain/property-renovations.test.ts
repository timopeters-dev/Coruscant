import { describe, expect, it } from "vitest";
import {
  MAX_RENOVATIONS,
  parseRenovations,
  RENOVATION_KINDS,
  serializeRenovations,
  type Renovation,
} from "./property-renovations";

describe("property-renovations", () => {
  it("returns [] for null, empty string, invalid JSON, and non-array JSON", () => {
    expect(parseRenovations(null)).toEqual([]);
    expect(parseRenovations("")).toEqual([]);
    expect(parseRenovations("   ")).toEqual([]);
    expect(parseRenovations("{not-json")).toEqual([]);
    expect(parseRenovations('{"year":2020,"kind":"roof"}')).toEqual([]);
    expect(parseRenovations('"roof"')).toEqual([]);
    expect(parseRenovations("42")).toEqual([]);
  });

  it("discards invalid entries and keeps valid ones", () => {
    const raw = JSON.stringify([
      { year: 2020, kind: "roof" },
      { year: 2021.5, kind: "heating" },
      { year: 2021, kind: "pool" },
      { year: 1799, kind: "facade" },
      { year: 2101, kind: "windows" },
      null,
      "invalid",
      { year: 2018, kind: "windows" },
    ]);

    expect(parseRenovations(raw)).toEqual([
      { year: 2018, kind: "windows" },
      { year: 2020, kind: "roof" },
    ]);
  });

  it("sorts by year then kind and deduplicates (year, kind)", () => {
    const raw = JSON.stringify([
      { year: 2021, kind: "roof" },
      { year: 2019, kind: "heating" },
      { year: 2021, kind: "heating" },
      { year: 2021, kind: "heating" },
      { year: 2019, kind: "bathroom" },
    ]);

    expect(parseRenovations(raw)).toEqual([
      { year: 2019, kind: "bathroom" },
      { year: 2019, kind: "heating" },
      { year: 2021, kind: "heating" },
      { year: 2021, kind: "roof" },
    ]);
  });

  it("caps parsed renovations at MAX_RENOVATIONS", () => {
    const many: Renovation[] = Array.from({ length: 12 }, (_, idx) => ({
      year: 2010 + idx,
      kind: RENOVATION_KINDS[idx % RENOVATION_KINDS.length]!,
    }));

    expect(parseRenovations(JSON.stringify(many))).toHaveLength(MAX_RENOVATIONS);
  });

  it("returns null from serializeRenovations for an empty list", () => {
    expect(serializeRenovations([])).toBeNull();
  });

  it("roundtrips renovations deterministically", () => {
    const input: Renovation[] = [
      { year: 2022, kind: "heating" },
      { year: 2018, kind: "roof" },
      { year: 2022, kind: "heating" },
    ];
    const serialized = serializeRenovations(input);
    expect(serialized).not.toBeNull();
    expect(parseRenovations(serialized)).toEqual([
      { year: 2018, kind: "roof" },
      { year: 2022, kind: "heating" },
    ]);
  });
});
