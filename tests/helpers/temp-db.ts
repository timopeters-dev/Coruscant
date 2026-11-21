import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { closeDb } from "@/backend/db/connection";

/**
 * Jede Testfunktion bekommt eine frische SQLite-Datei in einem eigenen
 * Temp-Ordner. `dirs` legt dort Unterordner an und setzt sie als
 * Umgebungsvariable (z. B. `{ DOCUMENTS_DIR: "documents" }`).
 * Gibt eine Funktion zurück, die den aktuellen Temp-Ordner liefert.
 */
export function withTempDatabase(options: { dirs?: Record<string, string> } = {}): () => string {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-test-"));
    vi.stubEnv("DATABASE_URL", path.join(dir, "test.db"));
    for (const [envVar, subdir] of Object.entries(options.dirs ?? {})) {
      vi.stubEnv(envVar, path.join(dir, subdir));
    }
  });
  afterEach(() => {
    closeDb();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return () => dir;
}
