# System-Architektur (Coruscant)

## 1. Hub- & Baustein-Modell (`finanz_cockpit` Integration)
- **`finanz_cockpit` (Raspberry Pi 3B):** Bleibt alleinige Source of Truth für persönliche Konten, Einzelbuchungen und Depot. Stellt einen geschützten Read-Only-Endpoint `GET /api/external/summary` (Bearer-Token) bereit.
- **`Coruscant` (Entwicklungsrechner → x86-Homeserver):** Konsumiert nur aggregierte Summen (`liquidCashCents`, `etfStocksCents`, `cryptoCents`) über `external_snapshots` und führt darüber die Haushalts-, Vertrags-, Dokumenten- und Strategie-Welt.

## 2. Zwei-Sphären-Trennung & Cashflow-Adapter
- **`Persönlich`:** Kommt live aus `finanz_cockpit`.
- **`Haushalt`:** Wirtschaftliche Einheit des Haushalts; setzt die Ehefrau **nie** als aktive App-Nutzerin voraus.
- **Cashflow-Adapter:**
  - *Modus A (v1 – Split-Modell):* Frei konfigurierbare `cashflow_items` (Pauschalen + verknüpfte Vertragsraten) berechnen den monatlichen freien Überschuss.
  - *Modus B (v3 – Gemeinschaftskonto):* Reale Bankdaten eines Gemeinschaftskontos ersetzen die Schätzungen; „Taschengeld“-Daueraufträge werden als Sphären-Transfers behandelt.

## 3. Vertrags-Fortschreibung & Dokumenten-Eichung
- Unterjährig projiziert `src/domain/contracts/` den aktuellen Stand von Krediten und Bausparern anhand von Rate und Zinssatz (`interestRateBps`).
- Jahresauszüge über die **KI-Dokumenten-Inbox** dienen als exakte **Eich-Punkte** (`balanceAsOfDate`), um Gebühren oder Wertstellungsdifferenzen abzufangen.

## 4. Code-Struktur & Schichten
```
src/
  app/          Next.js-Routing: Seiten (Server Components) und API-Routen – nur Verdrahtung
  frontend/     React-Oberfläche
    <seite>/    eine Ordner je Seite (allokation, bericht, cockpit, dokumente, planung, steuer, vertraege);
                große Komponenten als Ordner: use-….ts (Zustand/Aktionen) + Abschnitts-Komponenten
    ui/         Design-Bausteine (Field, SegmentedControl, Card, Dialog …)
    charts/     Diagramme
    shell/      App-Rahmen, Navigation, Theme
    lib/api.ts  API-Client (kein eigenes fetch/try/catch je Aufruf)
  backend/
    http.ts     route(), readJson(), readUploadedFile(), fileResponse()
    errors.ts   ApiError & Co. – erwartbare Fehler tragen Status und Feldfehler selbst
    db/         Drizzle-Schema, Verbindung, Migration; queries/ je Fachobjekt; helpers.ts (mergePatch …)
    services/   Abläufe über mehrere Bausteine (Beleg-Eingang, Bespin-Sync, Bewertung, Coach, Steuer-Export)
    integrations/ Gemini, finanz_cockpit, ImmoAnalyse
    storage/    Datei-Ablage (file-store.ts: traversal-sicher), PDFs, Objektbilder, Steuer-Archiv
    jobs/       Scheduler und Hintergrund-Jobs
  validation/   zod-Schemas (API-Verträge, KI-Outputs, Formulare) – eine Quelle für Fachregeln
  domain/       reine Berechnungen je Bereich: core, contracts, allocation, cockpit, properties,
                planning, recommendation, report, tax, documents
tests/          spiegelt src/; helpers/ (withTempDatabase, apiRequest, …), fixtures/
```

Abhängigkeiten zeigen nur nach unten: `app → frontend | backend → validation → domain`.
`pnpm lint` erzwingt das (siehe `eslint.config.mjs`): Das Frontend importiert vom Backend nur
Typen, die Domäne kein Framework, keine DB und kein Netzwerk; Planung und Berater-Bericht
rechnen rein lokal (kein `fetch`, kein Browser-Speicher, kein API-Client).

