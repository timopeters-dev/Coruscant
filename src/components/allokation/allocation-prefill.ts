import type { RecommendationResult } from "@/lib/domain/recommendation";
import { z } from "zod";

export interface AllocationPrefillEntry {
  potId: string;
  amountCents: number;
}

export interface AllocationPrefill {
  amountCents: number;
  entries: AllocationPrefillEntry[];
}

export function buildAllocationPrefillHref(
  result: RecommendationResult,
): string | null {
  const byPot = new Map<string, number>();
  for (const item of result.items) {
    if (item.target.type !== "pot" || item.amountCents <= 0) continue;
    byPot.set(
      item.target.potId,
      (byPot.get(item.target.potId) ?? 0) + item.amountCents,
    );
  }
  if (byPot.size === 0) return null;

  const posten = Array.from(byPot.entries())
    .map(([potId, cents]) => `${encodeURIComponent(potId)}:${cents}`)
    .join(",");

  return `/allokation?verteilen=einmal&posten=${posten}`;
}

const prefillSchema = z.object({
  verteilen: z.literal("einmal"),
  entries: z
    .array(
      z.object({
        potId: z.string().min(1),
        amountCents: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(20),
});

export function parseAllocationPrefill(
  searchParams: {
    verteilen?: string | string[] | null;
    posten?: string | string[] | null;
  },
  pots: readonly { id: string }[],
): AllocationPrefill | null {
  const verteilen = Array.isArray(searchParams.verteilen)
    ? searchParams.verteilen[0]
    : searchParams.verteilen;
  const postenRaw = Array.isArray(searchParams.posten)
    ? searchParams.posten[0]
    : searchParams.posten;

  if (verteilen !== "einmal" || typeof postenRaw !== "string") {
    return null;
  }
  const trimmed = postenRaw.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(",");
  if (parts.length === 0 || parts.length > 20) return null;

  const knownIds = new Set(pots.map((p) => p.id));
  const seenIds = new Set<string>();
  const entries: AllocationPrefillEntry[] = [];

  for (const part of parts) {
    const colonIdx = part.lastIndexOf(":");
    if (colonIdx <= 0) return null;
    let potId: string;
    try {
      potId = decodeURIComponent(part.slice(0, colonIdx));
    } catch {
      return null;
    }
    const centsStr = part.slice(colonIdx + 1);
    if (!/^\d+$/.test(centsStr)) return null;
    const amountCents = Number(centsStr);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
    if (!knownIds.has(potId) || seenIds.has(potId)) return null;
    seenIds.add(potId);
    entries.push({ potId, amountCents });
  }

  const parsed = prefillSchema.safeParse({ verteilen, entries });
  if (!parsed.success) return null;

  const total = parsed.data.entries.reduce((acc, e) => acc + e.amountCents, 0);
  if (!Number.isSafeInteger(total) || total <= 0) return null;

  return {
    amountCents: total,
    entries: parsed.data.entries,
  };
}
