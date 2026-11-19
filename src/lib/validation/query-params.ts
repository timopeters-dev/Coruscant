import { z } from "zod";

export type RawSearchParams =
  | Record<string, string | string[] | undefined>
  | URLSearchParams;

export function getParam(
  params: RawSearchParams,
  key: string,
): string | undefined {
  if (params instanceof URLSearchParams) {
    const val = params.get(key);
    return val === null ? undefined : val;
  }
  const raw = params[key];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

export function coerceStrictInt(min: number, max: number) {
  return z.preprocess((value) => {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!/^-?\d+$/.test(trimmed)) {
        return Number.NaN;
      }
      return Number(trimmed);
    }
    return value;
  }, z.number().int().min(min).max(max));
}
