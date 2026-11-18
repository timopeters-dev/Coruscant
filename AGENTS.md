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
- **Domänen-Isolation (`src/lib/domain/`):** Alle Berechnungen (Wasserfall-Verteilung, Vertrags-Fortschreibung, Cashflow, Bilanz-Summen) gehören hierhin. Isolation (kein Next/React/DB/fs) und „DB-Libs nur in `src/db/`“ erzwingt `pnpm lint`.
- **Datenbank (`src/db/`):** Alle SQLite-Zugriffe laufen über Drizzle ORM in `src/db/`.
- **Validierung & KI (`zod`):** API-Inputs und strukturierte KI-Outputs (z. B. Dokumenten-Extraktion) werden strikt über `zod`-Schemas validiert.
- **Generik statt Hardcoding:** Keine Sonderfälle für einzelne Kredite, Personen oder Verträge im Code – alles wird über generische DB-Datensätze und Regeln modelliert.

## 3. Arithmetik, Design & KI-Konfiguration
- **Geldbeträge:** Strikte Integer-Cent-Arithmetik (`amountCents`) – niemals `float` für Währungsberechnungen verwenden.
- **Zinssätze:** Strikte Integer-Basispunkte (`interestRateBps`, z. B. `350` = `3,50 %`).
- **KI-Konfiguration:** Modell nur über `GEMINI_MODEL` (Hartcodieren verhindert `pnpm lint`) hinter einem abstrakten KI-Adapter. KI mutiert Bestandsdaten niemals stillschweigend (immer 1-Klick-Bestätigung durch den Nutzer).
- **Design-System (`docs/DESIGN-SYSTEM.md`):** „Quiet Galactic Precision“ – `tabular-nums` für alle Beträge/Daten, klare visuelle Trennung von *Geeicht/Ist* (solide) vs. *Modelliert/Schätzung* (`border-dashed`) vs. *KI-Vorschlag* (Amber).

## 4. Tests, Datenschutz & Sicherheit
- Für jede Domänen-Logik neben Happy-Paths zwingend Negativ- und Grenzfalltests (0-Cent-Werte, Überzahlungen, Rundungsgrenzen, ungültige KI-Outputs) in `*.test.ts` abdecken.
- **Keine echten Daten in Code, Tests oder Kommentaren:** Ausschließlich eindeutig fiktive Dummy-Werte nutzen (z. B. *Musterbank*, *Musterstraße 1*).
- `data/*.db*`, `data/backups/`, `data/documents/`, `.env*`, `*.pdf` und `secrets/` bleiben in `.gitignore` ausgeschlossen.
