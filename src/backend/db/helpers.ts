import crypto from "node:crypto";
import type { getDb } from "./connection";

export type Db = ReturnType<typeof getDb>;
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Lesende Hilfsfunktionen laufen in und außerhalb einer Transaktion. */
export type DbOrTx = Db | DbTx;

export const newId = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

/**
 * PATCH-Semantik: `undefined` bedeutet „unverändert“, `null` „leeren“.
 * Liefert `existing`, überschrieben mit allen gesetzten Feldern aus `patch`.
 */
export function mergePatch<T extends object, P extends object>(existing: T, patch: P): Merged<T, P> {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return { ...existing, ...defined } as Merged<T, P>;
}

type Merged<T, P> = {
  [K in keyof T | keyof P]: K extends keyof T
    ? K extends keyof P
      ? T[K] | Exclude<P[K], undefined>
      : T[K]
    : K extends keyof P
      ? P[K]
      : never;
};

/** Erste Zeile eines `.returning()` – fehlt sie, ist das ein Programmfehler. */
export function firstRow<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row) throw new Error(`Failed to write ${what}`);
  return row;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT_UNIQUE")
  );
}
