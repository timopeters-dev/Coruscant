export const RENOVATION_KINDS = [
  "roof",
  "windows",
  "heating",
  "facade",
  "insulation",
  "bathroom",
  "kitchen",
  "electrical",
  "plumbing",
  "full",
] as const;

export type RenovationKind = (typeof RENOVATION_KINDS)[number];

export interface Renovation {
  year: number;
  kind: RenovationKind;
}

export const MAX_RENOVATIONS = 10;

const MIN_RENOVATION_YEAR = 1800;
const MAX_RENOVATION_YEAR = 2100;

const RENOVATION_KIND_SET = new Set<string>(RENOVATION_KINDS);

function isRenovationKind(value: unknown): value is RenovationKind {
  return typeof value === "string" && RENOVATION_KIND_SET.has(value);
}

function isValidRenovationEntry(value: unknown): value is Renovation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.year === "number" &&
    Number.isInteger(candidate.year) &&
    candidate.year >= MIN_RENOVATION_YEAR &&
    candidate.year <= MAX_RENOVATION_YEAR &&
    isRenovationKind(candidate.kind)
  );
}

export function normalizeRenovations(
  entries: readonly Renovation[],
): Renovation[] {
  const seen = new Set<string>();
  const valid: Renovation[] = [];

  for (const entry of entries) {
    if (!isValidRenovationEntry(entry)) {
      continue;
    }
    const key = `${entry.year}:${entry.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    valid.push({ year: entry.year, kind: entry.kind });
  }

  valid.sort((a, b) => {
    if (a.year !== b.year) {
      return a.year - b.year;
    }
    return a.kind.localeCompare(b.kind);
  });

  return valid.slice(0, MAX_RENOVATIONS);
}

export function parseRenovations(raw: string | null): Renovation[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return normalizeRenovations(parsed as Renovation[]);
}

export function serializeRenovations(
  list: readonly Renovation[],
): string | null {
  const normalized = normalizeRenovations(list);
  if (normalized.length === 0) {
    return null;
  }
  return JSON.stringify(normalized);
}
