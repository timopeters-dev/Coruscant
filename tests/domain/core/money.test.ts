import { describe, expect, it } from "vitest";
import {
  allocateProportionally,
  assertNonNegativeInteger,
  assertSafeInteger,
  bpsToPercentInputString,
  centsToEuroInputString,
  formatBpsDE,
  formatCentsDE,
  formatEuroDE,
  formatWholeEuroDE,
  parseEuroInputToCents,
  parsePercentInputToBps,
  roundHalfUpBigInt,
} from "@/domain/core/money";

describe("assertSafeInteger", () => {
  it("accepts safe integers and normalizes -0 to 0", () => {
    expect(assertSafeInteger(0)).toBe(0);
    expect(Object.is(assertSafeInteger(-0), 0)).toBe(true);
    expect(assertSafeInteger(123456)).toBe(123456);
    expect(assertSafeInteger(-999)).toBe(-999);
    expect(assertSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("throws RangeError for floats, NaN, Infinity, and unsafe integers", () => {
    expect(() => assertSafeInteger(12.34)).toThrow(RangeError);
    expect(() => assertSafeInteger(0.1 + 0.2)).toThrow(RangeError);
    expect(() => assertSafeInteger(Number.NaN)).toThrow(RangeError);
    expect(() => assertSafeInteger(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => assertSafeInteger(Number.NEGATIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => assertSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
  });
});

describe("formatCentsDE", () => {
  it("formats happy paths in German locale", () => {
    expect(formatCentsDE(0)).toBe("0,00 €");
    expect(formatCentsDE(100)).toBe("1,00 €");
    expect(formatCentsDE(123456)).toBe("1.234,56 €");
    expect(formatCentsDE(-5000)).toBe("-50,00 €");
    expect(formatCentsDE(5000, { showPlusSign: true })).toBe("+50,00 €");
    expect(formatCentsDE(0, { showPlusSign: true })).toBe("0,00 €");
    expect(formatCentsDE(-5000, { showPlusSign: true })).toBe("-50,00 €");
  });

  it("handles single-digit cents, -0, and large safe integers accurately", () => {
    expect(formatCentsDE(1)).toBe("0,01 €");
    expect(formatCentsDE(-1)).toBe("-0,01 €");
    expect(formatCentsDE(9)).toBe("0,09 €");
    expect(formatCentsDE(-9)).toBe("-0,09 €");
    expect(formatCentsDE(-0)).toBe("0,00 €");
    expect(formatCentsDE(999_999_999_99)).toBe("999.999.999,99 €");
  });

  it("rejects non-integer inputs", () => {
    expect(() => formatCentsDE(12.34)).toThrow(RangeError);
    expect(() => formatCentsDE(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatEuroDE", () => {
  it("formats whole euros without decimals and non-zero cents with two decimals", () => {
    expect(formatEuroDE(0)).toBe("0 €");
    expect(formatEuroDE(-0)).toBe("0 €");
    expect(formatEuroDE(200_000)).toBe("2.000 €");
    expect(formatEuroDE(200_050)).toBe("2.000,50 €");
    expect(formatEuroDE(200_005)).toBe("2.000,05 €");
    expect(formatEuroDE(-5000)).toBe("-50 €");
    expect(formatEuroDE(-5025)).toBe("-50,25 €");
    expect(formatEuroDE(5000, { showPlusSign: true })).toBe("+50 €");
    expect(formatEuroDE(0, { showPlusSign: true })).toBe("0 €");
    expect(formatEuroDE(Number.MAX_SAFE_INTEGER)).toBe("90.071.992.547.409,91 €");
  });

  it("rejects non-integer inputs", () => {
    expect(() => formatEuroDE(12.34)).toThrow(RangeError);
    expect(() => formatEuroDE(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatWholeEuroDE", () => {
  it("rounds half-up to whole euros with Unicode minus", () => {
    expect(formatWholeEuroDE(0)).toBe("0 €");
    expect(formatWholeEuroDE(149)).toBe("1 €");
    expect(formatWholeEuroDE(150)).toBe("2 €");
    expect(formatWholeEuroDE(-150)).toBe("−2 €");
  });
});

describe("formatBpsDE", () => {
  it("formats basis points without float arithmetic", () => {
    expect(formatBpsDE(350)).toBe("3,50 %");
    expect(formatBpsDE(1000)).toBe("10,00 %");
    expect(formatBpsDE(0)).toBe("0,00 %");
    expect(formatBpsDE(-0)).toBe("0,00 %");
    expect(formatBpsDE(-25)).toBe("-0,25 %");
    expect(formatBpsDE(5)).toBe("0,05 %");
  });

  it("rejects non-integer inputs", () => {
    expect(() => formatBpsDE(3.5)).toThrow(RangeError);
  });
});

describe("parseEuroInputToCents", () => {
  it("parses valid German and dot-decimal Euro strings", () => {
    expect(parseEuroInputToCents("1.234,56")).toBe(123456);
    expect(parseEuroInputToCents("1234.56")).toBe(123456);
    expect(parseEuroInputToCents("42,5")).toBe(4250);
    expect(parseEuroInputToCents("-10,05")).toBe(-1005);
    expect(parseEuroInputToCents("0")).toBe(0);
    expect(parseEuroInputToCents("-0,00")).toBe(0);
    expect(parseEuroInputToCents("100")).toBe(10000);
    expect(parseEuroInputToCents(" 1.000 ")).toBe(100000);
    expect(parseEuroInputToCents("250,99 €")).toBe(25099);
  });

  it("returns null for invalid inputs and >2 decimal places", () => {
    expect(parseEuroInputToCents("")).toBeNull();
    expect(parseEuroInputToCents("   ")).toBeNull();
    expect(parseEuroInputToCents("abc")).toBeNull();
    expect(parseEuroInputToCents("12,345")).toBeNull();
    expect(parseEuroInputToCents("12.3456")).toBeNull();
    expect(parseEuroInputToCents("12,3,4")).toBeNull();
    expect(parseEuroInputToCents("--10")).toBeNull();
    expect(parseEuroInputToCents("€")).toBeNull();
  });
});

describe("assertNonNegativeInteger", () => {
  it("accepts 0, -0 (normalized to 0), and positive safe integers", () => {
    expect(assertNonNegativeInteger(0)).toBe(0);
    expect(Object.is(assertNonNegativeInteger(-0), 0)).toBe(true);
    expect(assertNonNegativeInteger(1)).toBe(1);
    expect(assertNonNegativeInteger(500_000)).toBe(500_000);
  });

  it("throws RangeError for negative integers, floats, and NaN", () => {
    expect(() => assertNonNegativeInteger(-1)).toThrow(RangeError);
    expect(() => assertNonNegativeInteger(1.5)).toThrow(RangeError);
    expect(() => assertNonNegativeInteger(Number.NaN)).toThrow(RangeError);
  });
});

describe("roundHalfUpBigInt", () => {
  it("rounds half-up accurately for BigInt ratios", () => {
    expect(roundHalfUpBigInt(0n, 3n)).toBe(0n);
    expect(roundHalfUpBigInt(1n, 2n)).toBe(1n);
    expect(roundHalfUpBigInt(100n, 3n)).toBe(33n);
    expect(roundHalfUpBigInt(200n, 3n)).toBe(67n);
    expect(roundHalfUpBigInt(5n, 2n)).toBe(3n);
  });

  it("throws RangeError for negative numerators or non-positive denominators", () => {
    expect(() => roundHalfUpBigInt(-1n, 2n)).toThrow(RangeError);
    expect(() => roundHalfUpBigInt(1n, 0n)).toThrow(RangeError);
    expect(() => roundHalfUpBigInt(1n, -2n)).toThrow(RangeError);
  });
});

describe("parsePercentInputToBps", () => {
  it("parses valid German and dot-decimal percentages into basis points", () => {
    expect(parsePercentInputToBps("3,5")).toBe(350);
    expect(parsePercentInputToBps("3.50")).toBe(350);
    expect(parsePercentInputToBps("3,50 %")).toBe(350);
    expect(parsePercentInputToBps("0")).toBe(0);
    expect(parsePercentInputToBps("0,00%")).toBe(0);
    expect(parsePercentInputToBps("12")).toBe(1200);
    expect(parsePercentInputToBps("12,05")).toBe(1205);
  });

  it("rejects negative values, >2 decimals, empty strings, and malformed input", () => {
    expect(parsePercentInputToBps("-1")).toBeNull();
    expect(parsePercentInputToBps("-0,50")).toBeNull();
    expect(parsePercentInputToBps("3,555")).toBeNull();
    expect(parsePercentInputToBps("")).toBeNull();
    expect(parsePercentInputToBps("   ")).toBeNull();
    expect(parsePercentInputToBps("%")).toBeNull();
    expect(parsePercentInputToBps("abc")).toBeNull();
    expect(parsePercentInputToBps("3,,5")).toBeNull();
    expect(parsePercentInputToBps("3.5,0")).toBeNull();
  });
});

describe("input string round-trips", () => {
  it("round-trips centsToEuroInputString with parseEuroInputToCents", () => {
    const samples = [0, 1, 50, 35050, 48000000, -12345];
    for (const value of samples) {
      const str = centsToEuroInputString(value);
      expect(parseEuroInputToCents(str)).toBe(value);
    }
    expect(centsToEuroInputString(48000000)).toBe("480000,00");
    expect(centsToEuroInputString(35050)).toBe("350,50");
  });

  it("round-trips bpsToPercentInputString with parsePercentInputToBps", () => {
    const samples = [0, 5, 350, 1205, 10000];
    for (const value of samples) {
      const str = bpsToPercentInputString(value);
      expect(parsePercentInputToBps(str)).toBe(value);
    }
    expect(bpsToPercentInputString(350)).toBe("3,50");
    expect(() => bpsToPercentInputString(-1)).toThrow(RangeError);
  });
});

describe("allocateProportionally", () => {
  it("verteilt exakt nach Largest-Remainder", () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportionally(0, [3, 4])).toEqual([0, 0]);
    expect(allocateProportionally(10, [0, 0])).toEqual([0, 0]);
  });

  it("wirft bei negativen oder Float-Werten", () => {
    expect(() => allocateProportionally(-1, [1])).toThrow(RangeError);
    expect(() => allocateProportionally(1, [-1])).toThrow(RangeError);
    expect(() => allocateProportionally(1.5, [1])).toThrow(RangeError);
  });
});
