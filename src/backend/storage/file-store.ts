import fs from "node:fs";
import path from "node:path";
import { isFileNotFound } from "@/backend/errors";

/** Ein Pfad, der aus dem Ablageordner herausführen könnte – wird nie angefasst. */
export class PathTraversalError extends Error {
  constructor(message = "Ungültiger Speicherpfad.") {
    super(message);
    this.name = "PathTraversalError";
  }
}

export interface FileStoreConfig {
  /** Umgebungsvariable für den Ablageordner, z. B. `DOCUMENTS_DIR`. */
  envVar: string;
  defaultDir: string;
  /** Nur so geformte, vom Store selbst vergebene Pfade sind gültig. */
  pathPattern: RegExp;
  traversalMessage: string;
}

/**
 * Dateiablage unterhalb eines festen Ordners. Jeder Zugriff prüft den
 * relativen Pfad gegen `pathPattern` und – beim Lesen – zusätzlich den
 * realen Pfad, damit auch Symlinks nicht aus dem Ordner herausführen.
 */
export function createFileStore(config: FileStoreConfig) {
  const unsafe = () => new PathTraversalError(config.traversalMessage);

  function baseDir(customBaseDir?: string): string {
    const raw = customBaseDir ?? process.env[config.envVar]?.trim() ?? config.defaultDir;
    const target = raw.length > 0 ? raw : config.defaultDir;
    return path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), target);
  }

  function resolveSafe(storagePath: string, customBaseDir?: string): string {
    if (
      !storagePath ||
      storagePath.includes("\0") ||
      storagePath.includes("\\") ||
      path.isAbsolute(storagePath) ||
      storagePath.split("/").includes("..") ||
      !config.pathPattern.test(storagePath)
    ) {
      throw unsafe();
    }
    const base = baseDir(customBaseDir);
    const target = path.resolve(base, storagePath);
    if (!target.startsWith(base + path.sep)) throw unsafe();
    return target;
  }

  return {
    baseDir,
    resolveSafe,

    /** Schreibt eine neue Datei; existiert sie schon, schlägt das fehl. */
    writeNew(storagePath: string, buffer: Buffer, customBaseDir?: string): void {
      const target = resolveSafe(storagePath, customBaseDir);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer, { flag: "wx" });
    },

    read(storagePath: string, customBaseDir?: string): Buffer {
      const base = baseDir(customBaseDir);
      const realTarget = fs.realpathSync(resolveSafe(storagePath, base));
      if (!realTarget.startsWith(fs.realpathSync(base) + path.sep)) throw unsafe();
      return fs.readFileSync(realTarget);
    },

    deleteIfExists(storagePath: string, customBaseDir?: string): void {
      try {
        fs.unlinkSync(resolveSafe(storagePath, customBaseDir));
      } catch (error) {
        if (!isFileNotFound(error)) throw error;
      }
    },

    /** Größe in Bytes; fehlende Dateien und unsichere Pfade liefern `null`. */
    size(storagePath: string, customBaseDir?: string): number | null {
      try {
        const stat = fs.statSync(resolveSafe(storagePath, customBaseDir));
        return stat.isFile() ? stat.size : null;
      } catch (error) {
        if (error instanceof PathTraversalError || isFileNotFound(error)) return null;
        throw error;
      }
    },
  };
}
