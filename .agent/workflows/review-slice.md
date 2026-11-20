---
description: Führt ein kritisches Principal-Engineer-Review über den aktuellen Git-Diff durch
---

Lies `AGENTS.md`, `docs/SPEC.md` und `docs/DESIGN-SYSTEM.md`.
Führe im Terminal `git status` und `git diff` aus und prüfe die gesamten uncommitteten Änderungen wie ein kritischer Principal Engineer (Agent Argon).

Prüfe gezielt auf:
1. Fachliche Bugs bei Finanzdaten (Cent-Integer- und Bps-Pflicht ohne Floats, Vorzeichen, Überzahlungen in Töpfen, Datums-/Zinsgrenzen).
2. Architektur-Verstöße (DB-, HTTP- oder Next.js-Imports in `src/domain/`, Hardcoding von Einzelfällen, fehlende `zod`-Validierung bei KI/API, ungeschützte Secrets/PDFs).
3. Design-Verstöße (fehlende `tabular-nums`, fehlende Kennzeichnung von Modell vs. Ist, stillschweigende KI-Mutationen ohne Freigabe).
4. Fehlende Unit-, Negativ- oder Integrationstests gemäß `AGENTS.md` §4.

Regeln:
- Ignoriere reine Stilfragen (dafür gibt es Linter).
- Liste nur echte Bugs oder Risiken mit Dateiname, Zeilenbereich und konkretem Fix auf – oder antworte ausschließlich mit `LGTM`, wenn alles sauber ist.
