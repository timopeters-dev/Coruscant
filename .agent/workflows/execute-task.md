---
description: Setzt einen geplanten Slice aus ../docs/tasks/coruscant/ vollständig um und führt alle Pflicht-Checks aus
---

Lies zuerst `AGENTS.md`, `docs/SPEC.md` und `docs/DESIGN-SYSTEM.md`.

Finde und lies anschließend die angegebene Plan-Datei unter `../docs/tasks/coruscant/` (wenn der Nutzer z. B. `task 3` oder `3` angibt, suche nach `../docs/tasks/coruscant/plan-slice-3.md` bzw. dem passenden Dateinamen in `../docs/tasks/coruscant/`).

Deine Aufgaben (Agent Hydrogen):
1. **Git-Branch prüfen:**
   - Prüfe `git branch --show-current`. Entwickle niemals direkt auf `main` oder `dev` – erstelle falls nötig einen passenden Branch (z. B. `feature/slice-<nr>`) von `dev`.
2. **Plan strikt umsetzen:**
   - Arbeite alle Schritte aus dem Plan in `../docs/tasks/coruscant/` vollständig und sauber ab.
   - Halte die Architektur-Grenzen ein: Reine Domänen-Logik in `src/domain/` (ohne Next.js-/React-/HTTP-/DB-Imports), SQLite-Zugriffe nur über Drizzle in `src/backend/db/`, Validierung über `zod`.
   - Nutze strikte Integer-Cent- (`amountCents`) und Basispunkt-Arithmetik (`interestRateBps`) ohne `float`.
   - Beachte `docs/DESIGN-SYSTEM.md` (`tabular-nums`, Light/Dark-Tokens, klare Kennzeichnung von *Geeicht* vs. *Modelliert* vs. *KI-Vorschlag*).
   - Schreibe alle im Plan vorgesehenen Happy-Path-, Grenz- und Negativtests (`tests/…/*.test.ts`, spiegelt `src/`) mit fiktiven Dummy-Daten.
3. **Pflicht-Checks (vor Abschluss zwingend):**
   - Führe `pnpm typecheck`, `pnpm lint` und `pnpm test` aus und behebe alle Fehler, bis alles mit 0 Fehlern durchläuft.
4. **Übergabe:**
   - Fasse kurz zusammen, was umgesetzt wurde und welche Checks bestanden sind, damit im nächsten Schritt `/review-slice` (Agent Argon) laufen kann.
