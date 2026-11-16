# Coruscant – Haushalts- & Vermögens-Zentrale

Local-First Finanz-, Vertrags-, Dokumenten- und Strategie-Cockpit für den gemeinsamen Haushalt – entwickelt als übergeordneter Hub mit Integration des persönlichen [`finanz_cockpit`](../finanz_cockpit) über eine schlanke Summary-Bridge.

Siehe [docs/SPEC.md](docs/SPEC.md) für die Gesamtspezifikation und [docs/V1-ROADMAP.md](docs/V1-ROADMAP.md) für die Slice-Planung.

## Tech-Stack
- **App & UI:** Next.js (App Router), React, TypeScript (`strict`), Tailwind CSS v4, `shadcn/ui`, Lucide Icons
- **Validierung & KI:** `zod` + abstrakter KI-Adapter (Standard: Google Gemini API via `GEMINI_MODEL`)
- **Datenbank & Speicher:** SQLite (`better-sqlite3`, WAL-Modus) + Drizzle ORM (`data/coruscant.db`), PDFs im lokalen Dateisystem (`data/documents/`)
- **Qualität:** Vitest, ESLint, `pnpm`

## Die 4 Haupt-Routen (v1)
- **`/` (Haushalts-Cockpit):** Aktiva, Passiva, echtes Nettovermögen (inkl. `finanz_cockpit`-Sync), Frei-vs.-Gebunden-Balken und Meilenstein-Zeitachse.
- **`/vertraege` (Verträge & Immobilien):** Generisches Register für Kredite, Privatdarlehen, Bausparverträge und `Immobilie #0` (CRUD via Modal, projizierter vs. geeichter Stand).
- **`/allokation` (Cashflow & Wasserfall):** Haushalts-Positionen (Cashflow-Adapter Modus A), priorisierte Töpfe und „Geld verteilen“-Vorschläge mit 1-Klick-Bestätigung.
- **`/dokumente` (KI-Dokumenten-Inbox):** PDF-Upload, KI-Extraktion (`zod`), Split-Screen-Review inkl. Steuer-Tagging und Vertrags-Eichung.

## Setup (ab Slice 1)
```bash
pnpm install
cp .env.example .env.local   # GEMINI_API_KEY, FINANZ_COCKPIT_URL & Token eintragen
pnpm db:migrate
pnpm dev                     # http://localhost:3000
```

## Entwicklungs-Workflow (Argon & Hydrogen)
1. **Planen (Agent Argon):** `/plan-slice` mit dem Prompt aus `docs/V1-ROADMAP.md` → erzeugt `tasks/plan-slice-<nr>.md`.
2. **Umsetzen (Agent Hydrogen):** Implementierung des Plans inkl. Unit-/Negativtests (`pnpm typecheck && pnpm lint && pnpm test`).
3. **Review (Agent Argon):** `/review-slice` → prüft `git diff` gegen `AGENTS.md` und `docs/DESIGN-SYSTEM.md`.
4. **Fix (Agent Hydrogen):** `/fix-review` → setzt Review-Befunde inkl. Regressionstests um.
