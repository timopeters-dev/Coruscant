import { getSqlite } from "@/backend/db/connection";
import { json } from "@/backend/http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const timestamp = new Date().toISOString();
  try {
    const sqlite = getSqlite();
    const ping = sqlite.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    if (ping?.ok !== 1) throw new Error("Database ping failed");
    return json({
      status: "ok",
      db: "connected",
      journalMode: String(sqlite.pragma("journal_mode", { simple: true }) ?? ""),
      foreignKeys: Number(sqlite.pragma("foreign_keys", { simple: true }) ?? 0) === 1,
      timestamp,
    });
  } catch {
    return json({ status: "error", db: "disconnected", journalMode: "unknown", foreignKeys: false, timestamp }, 503);
  }
}
