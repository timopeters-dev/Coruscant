# AGENTS.md – Coruscant

> Workspace-Regeln: [`../AGENTS.md`](../AGENTS.md) (kurz; `../docs/` nur für Planung/Brainstorming lesen).

## 1. Workflow & Pflicht-Checks
- Lies vor neuen Features/Slices `docs/SPEC.md`. (Roadmap und Slice-Pläne liest nur `/plan-slice` bzw. der Plan, den dir der Nutzer nennt.)
- Nutze ausschließlich `pnpm`. Eine Aufgabe ist erst fertig, wenn `pnpm typecheck`, `pnpm lint` und `pnpm test` mit 0 Fehlern durchlaufen.
- **Argon / Hydrogen Entwicklungs-Workflow (`.agent/workflows/`):**
  1. **Planen (Argon):** `/plan-slice` → Analyse + kurzes Tech-Lead-Interview → Plan unter `../docs/tasks/coruscant/plan-slice-<nr>.md` speichern.
  2. **Umsetzen (Hydrogen):** Implementierung gemäß Plan in `../docs/tasks/coruscant/plan-slice-<nr>.md`.
  3. **Review (Argon):** `/review-slice` → Kritisches Principal-Engineer-Review auf `git diff`.
  4. **Fix (Hydrogen):** `/fix-review` → Befunde inkl. Regressionstests beheben.
- **Git-Workflow (`feature/*` → PR → `dev` → `main`):**
  - Entwickle **niemals** direkt auf `main` oder `dev`. Zweige für jedes Feature/Slice einen eigenen Branch (`feature/<name>` bzw. `fix/<name>`) von `dev` ab.
  - Niemals selbst auf `main` pushen oder mergen ohne explizite Freigabe.

## 2. Architektur-Grenzen
Struktur und Schichten: `docs/ARCHITECTURE.md` §4. Die Grenzen erzwingt `pnpm lint`.
- **`src/app/`** nur Routing: Seiten und API-Routen verdrahten, keine Logik. API-Routen nutzen `route()`/`readJson()` aus `src/backend/http.ts`; erwartbare Fehler sind `ApiError`s (`src/backend/errors.ts`).
- **`src/frontend/`** React-Oberfläche je Seite; vom Backend nur `import type`. API-Aufrufe über `src/frontend/lib/api.ts`.
- **`src/backend/`** Server: `db/` (einziger Ort für Drizzle/SQLite), `services/`, `integrations/`, `storage/`, `jobs/`.
- **Domänen-Isolation (`src/domain/<bereich>/`):** Alle Berechnungen (Wasserfall-Verteilung, Vertrags-Fortschreibung, Cashflow, Bilanz-Summen) gehören hierhin – ohne Next/React/DB/fs/Netzwerk.
- **`src/validation/`** zod-Schemas, geteilt von API und Formularen: Fachregeln nur dort prüfen, nicht zusätzlich von Hand.
- **Validierung & KI (`zod`):** API-Inputs und strukturierte KI-Outputs (z. B. Dokumenten-Extraktion) werden strikt über `zod`-Schemas validiert.
- **Generik statt Hardcoding:** Keine Sonderfälle für einzelne Kredite, Personen oder Verträge im Code – alles wird über generische DB-Datensätze und Regeln modelliert.

## 3. Arithmetik, Design & KI-Konfiguration
- **Geldbeträge:** Strikte Integer-Cent-Arithmetik (`amountCents`) – niemals `float` für Währungsberechnungen verwenden.
- **Zinssätze:** Strikte Integer-Basispunkte (`interestRateBps`, z. B. `350` = `3,50 %`).
- **KI-Konfiguration:** Modell nur über `GEMINI_MODEL` (Hartcodieren verhindert `pnpm lint`) hinter einem abstrakten KI-Adapter. KI mutiert Bestandsdaten niemals stillschweigend (immer 1-Klick-Bestätigung durch den Nutzer).
- **Design-System (`docs/DESIGN-SYSTEM.md`):** „Eichamt“ – Tabellenziffern für alle Beträge, Daten nur über `src/domain/core/date-format.ts` (`TT.MM.JJJJ` / `MM.JJJJ`), klare visuelle Trennung von *Geeicht/Ist* (solide) vs. *Modelliert/Schätzung* (`border-dashed`) vs. *KI-Vorschlag* (Amber).

## 4. Tests, Datenschutz & Sicherheit
- Für jede Domänen-Logik neben Happy-Paths zwingend Negativ- und Grenzfalltests (0-Cent-Werte, Überzahlungen, Rundungsgrenzen, ungültige KI-Outputs) in `tests/` abdecken (spiegelt `src/`, z. B. `src/domain/core/money.ts` → `tests/domain/core/money.test.ts`; Helfer in `tests/helpers/`).
- **Keine echten Daten in Code, Tests oder Kommentaren:** Ausschließlich eindeutig fiktive Dummy-Werte nutzen (z. B. *Musterbank*, *Musterstraße 1*).
- `data/*.db*`, `data/backups/`, `data/documents/`, `.env*`, `*.pdf` und `secrets/` bleiben in `.gitignore` ausgeschlossen.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
