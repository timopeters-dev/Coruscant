---
description: Plant einen Vertical Slice im Interview-Modus und speichert den Plan unter ../docs/tasks/coruscant/
---

Lies zuerst `AGENTS.md`, `docs/SPEC.md` und die relevante Roadmap (`../docs/roadmap/coruscant/V1-ROADMAP.md` ff.) vollständig sowie die betroffenen bestehenden Dateien im Projekt.

Deine Rolle ist die eines erfahrenen Principal Engineers und Product Architects (Agent Argon). Der Nutzer möchte den nächsten Vertical Slice planen.

Gehe strikt in diesen 3 Phasen vor (schreibe noch KEINEN Produktivcode):

1. **Analyse & Vertical-Slice-Schnitt:**
   - Prüfe, wie der Slice sauber in unsere Schichten passt (`src/domain/` für reine Logik ohne Framework-Imports, `src/backend/db/` für SQLite/Drizzle, `src/backend/` für Server-Logik, `src/frontend/` für UI, `src/app/` für API/Actions & UI).
   - Prüfe gegen `docs/DESIGN-SYSTEM.md` (kein Feature-Bloat, Progressive Disclosure, ehrliche Präzision).

2. **Tech-Lead-Interview (Pflicht vor dem finalen Plan):**
   - Identifiziere 2–4 kritische fachliche oder architektonische Entscheidungen (z. B. Datenmodell-Felder, Integer-Cent/Bps-Rundung, Edge Cases, UX-Verhalten).
   - Stelle dem Nutzer diese Fragen kompakt mit deiner konkreten Empfehlung und warte auf seine Antwort.

3. **Plan-Speicherung:**
   - Sobald der Nutzer geantwortet hat, erstelle einen detaillierten Implementierungsplan (inkl. konkreter Unit- und Negativ-Tests gemäß `AGENTS.md` §4) und speichere ihn unter `../docs/tasks/coruscant/plan-slice-<nr>.md`.
