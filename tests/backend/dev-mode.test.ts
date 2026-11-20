import { describe, expect, it } from "vitest";
import { isDevMode } from "@/backend/dev-mode";

describe("isDevMode", () => {
  it("returns true in development unless CORUSCANT_DEV_MODE=false", () => {
    expect(isDevMode({ NODE_ENV: "development" })).toBe(true);
    expect(
      isDevMode({ NODE_ENV: "development", CORUSCANT_DEV_MODE: "true" }),
    ).toBe(true);
    expect(
      isDevMode({ NODE_ENV: "development", CORUSCANT_DEV_MODE: "false" }),
    ).toBe(false);
    expect(
      isDevMode({ NODE_ENV: "development", CORUSCANT_DEV_MODE: " FALSE " }),
    ).toBe(false);
  });

  it("always returns false in production even when CORUSCANT_DEV_MODE=true", () => {
    expect(isDevMode({ NODE_ENV: "production" })).toBe(false);
    expect(
      isDevMode({ NODE_ENV: "production", CORUSCANT_DEV_MODE: "true" }),
    ).toBe(false);
  });

  it("returns true in test or undefined NODE_ENV unless opted out", () => {
    expect(isDevMode({ NODE_ENV: "test" })).toBe(true);
    expect(isDevMode({})).toBe(true);
    expect(isDevMode({ NODE_ENV: "test", CORUSCANT_DEV_MODE: "false" })).toBe(
      false,
    );
  });
});
