import { NextResponse } from "next/server";
import { z } from "zod";
import { getSqlite } from "@/db";

export const dynamic = "force-dynamic";

const healthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  db: z.enum(["connected", "disconnected"]),
  journalMode: z.string(),
  foreignKeys: z.boolean(),
  timestamp: z.string().datetime(),
});

export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString();

  try {
    const sqlite = getSqlite();
    const ping = sqlite.prepare("SELECT 1 AS ok").get() as
      | { ok: number }
      | undefined;

    if (!ping || ping.ok !== 1) {
      throw new Error("Database ping failed");
    }

    const journalMode = String(
      sqlite.pragma("journal_mode", { simple: true }) ?? "",
    );
    const foreignKeysRaw = Number(
      sqlite.pragma("foreign_keys", { simple: true }) ?? 0,
    );

    const payload = healthResponseSchema.parse({
      status: "ok",
      db: "connected",
      journalMode,
      foreignKeys: foreignKeysRaw === 1,
      timestamp,
    });

    return NextResponse.json(payload, { status: 200 });
  } catch {
    const payload = healthResponseSchema.parse({
      status: "error",
      db: "disconnected",
      journalMode: "unknown",
      foreignKeys: false,
      timestamp,
    });

    return NextResponse.json(payload, { status: 503 });
  }
}
