---
description: Setzt Befunde aus einem unabhängigen Code-Review inkl. Regressionstests um
---

Lies `AGENTS.md` und `docs/SPEC.md`. Ein unabhängiges Principal-Engineer-Review hat die unten stehenden Bugs, Edge Cases und fehlenden Tests gefunden.

Deine Aufgaben (Agent Hydrogen):
1. Analysiere jeden Punkt kritisch und behebe alle validen Bugs sauber im Code (ignoriere reines Over-Engineering, falls vorhanden).
2. Ergänze für jeden gefixten Bug zwingend die genannten Unit- bzw. Integrationstests, damit keine Regressionen auftreten.
3. Führe `pnpm typecheck`, `pnpm lint` und `pnpm test` aus und behebe alle Fehler, bis alles mit 0 Fehlern durchläuft.

Review-Befunde:
