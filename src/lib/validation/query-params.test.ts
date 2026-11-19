import { describe, expect, it } from "vitest";
import { coerceStrictInt, getParam } from "./query-params";

describe("getParam", () => {
  it("liest String, erstes Array-Element und undefined aus einem Record", () => {
    expect(getParam({ a: "1" }, "a")).toBe("1");
    expect(getParam({ a: ["1", "2"] }, "a")).toBe("1");
    expect(getParam({ a: undefined }, "a")).toBeUndefined();
    expect(getParam({}, "a")).toBeUndefined();
  });

  it("nimmt bei URLSearchParams mit doppeltem Schlüssel den ersten Wert", () => {
    const params = new URLSearchParams("a=1&a=2");
    expect(getParam(params, "a")).toBe("1");
    expect(getParam(params, "b")).toBeUndefined();
  });
});

describe("coerceStrictInt", () => {
  const schema = coerceStrictInt(-10, 100);

  it.each(["0", " 42 ", "-10", "100"])("akzeptiert %j", (raw) => {
    expect(schema.safeParse(raw).success).toBe(true);
  });

  it.each([
    "",
    "abc",
    "1.5",
    "1,5",
    "1e3",
    "+5",
    "0x10",
    "12abc",
    "Infinity",
    "NaN",
    "99999999999999999999",
    "-11",
    "101",
  ])("lehnt %j ab", (raw) => {
    expect(schema.safeParse(raw).success).toBe(false);
  });

  it("lehnt undefined ab", () => {
    expect(schema.safeParse(undefined).success).toBe(false);
  });
});
