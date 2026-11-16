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
- Unterjährig projiziert `src/lib/domain/` den aktuellen Stand von Krediten und Bausparern anhand von Rate und Zinssatz (`interestRateBps`).
- Jahresauszüge über die **KI-Dokumenten-Inbox** dienen als exakte **Eich-Punkte** (`balanceAsOfDate`), um Gebühren oder Wertstellungsdifferenzen abzufangen.
