# SPEC: Coruscant (Haushalts- & Vermögens-Zentrale)

## 1. Ziel & Kernprinzipien
Local-First Haushalts-, Vertrags-, Dokumenten- und Vermögens-Zentrale als übergeordneter Hub zum bestehenden persönlichen [`finanz_cockpit`](../finanz_cockpit).
- **Local-First & Privacy:** Alle Daten liegen lokal in SQLite (`data/coruscant.db`, WAL-Modus, `foreign_keys = ON`), PDFs im lokalen Dateisystem (`data/documents/`).
- **Präzise Integer-Arithmetik:** Geldbeträge strikt als Integer in Cent (`amountCents`), Zinssätze strikt als Basispunkte (`interestRateBps`, z. B. `350` = `3,50 %`). Keine `float`-Berechnungen.
- **Domänen-Isolation:** Reine TypeScript-Logik in `src/lib/domain/` ohne Next.js-, React-, HTTP- oder DB-Imports, abgesichert durch Vitest.
- **Zwei-Sphären-Prinzip:** Strikte Trennung zwischen `personal` (`finanz_cockpit`) und `household` (`Coruscant`), ohne die Ehefrau als aktive App-Nutzerin vorauszusetzen.
- **Generik statt Hardcoding:** Keine Sonderfälle für bestimmte Kredite oder Verträge im Code; alles wird dynamisch über DB-Datensätze konfiguriert.

## 2. Tech-Stack
- **Framework:** Next.js (App Router), React, TypeScript (`strict: true`)
- **Datenbank & Speicher:** SQLite (`better-sqlite3`) + Drizzle ORM (`src/db/`), PDFs unter `data/documents/<jahr>/<uuid>.pdf`
- **UI & Validierung:** Tailwind CSS v4, `shadcn/ui`, Lucide Icons, `zod`
- **KI-Adapter:** Abstrakter KI-Adapter (Standard: Google Gemini REST-API via `process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL`)
- **Tests & Tooling:** Vitest, ESLint, `pnpm`

## 3. Datenmodell (`src/db/schema.ts` – Zielbild v1)
- `properties`: `id`, `name`, `usage` (`owner_occupied` | `rented`), `purchaseDate`, `purchasePriceCents`, `estimatedValueCents`, `maintenanceReservePotId`, `monthlyColdRentCents` (v3), `monthlyNonRecoverableCostsCents` (v3), `monthlyMaintenanceAllowanceCents` (v3), `depreciationBasisCents` (v3), `updatedAt`
- `financial_contracts`: `id`, `name`, `provider`, `sphere` (`household` | `personal`), `category` (`loan` | `savings_contract`), `status` (`active` | `paused` | `closed`), `currentBalanceCents`, `balanceAsOfDate`, `monthlyRateCents`, `interestRateBps`, `linkedPropertyId` (FK set null), `milestoneDate`, `milestoneLabel`, `repaymentType` (`annuity` | `installment` | `lump_sum`), `specialRepaymentMaxYearlyCents`, `fixedInterestUntil`, `targetSumCents`, `allocationThresholdPercent`, `futureLoanInterestRateBps`, `updatedAt`
- `cashflow_items`: `id`, `name`, `direction` (`inflow` | `outflow`), `amountCents`, `frequency` (`monthly` | `quarterly` | `yearly`), `source` (`manual` | `finanz_cockpit_sync` | `contract_linked` | `property_linked` – abgeleitet, nicht persistiert), `linkedContractId` (FK cascade), `active`, `updatedAt`
- `pots`: `id`, `name`, `priority`, `currentCents`, `targetCents`, `targetDate` (YYYY-MM-DD, optional, nur mit `targetCents`; warnt nur, ändert die Wasserfall-Reihenfolge nicht), `ruleType` (`fill_to_target` | `fixed_monthly` | `percentage_of_remainder`), `fixedMonthlyCents`, `remainderPercentage`, `linkedContractId` (FK set null), `linkedPropertyId` (FK set null), `externalLinkKind` (`account` | `position` | NULL), `externalLinkRef` (finanz_cockpit `accounts.id` bzw. `holdings.id`; CHECK: beide Spalten gemeinsam NULL oder gesetzt; UNIQUE-Index auf `(externalLinkKind, externalLinkRef)` = strikte 1:1-Kopplung), `externalLinkScope` (`personal` | `household`, beim Sync gesetzt; `personal` zählt nicht zu `householdLiquidCents`), `externalSyncedAt` (ISO; Alter der geeichten Bankdaten: `balanceAsOf` bzw. `lastPriceAt`, Fallback `fetchedAt` – nicht der Abruf-Zeitpunkt; Basis für „Stand vom“ und das Zeitfenster offener Überweisungen), `externalLinkedAt` (ISO; Zeitpunkt der letzten Änderung der Kopplung, begrenzt das Fenster offener Überweisungen nach unten), `purpose` (`emergency_fund` | `goal` | `investment` | NULL; Zweck für den Investment-Coach, NULL = nicht festgelegt), `updatedAt`
- `pot_allocations`: `id`, `potId` (FK cascade), `amountCents`, `sourceLabel` (z. B. *„Monatsüberschuss“*, *„Einmalzufluss“*), `allocatedAt`
- `documents`: `id`, `filename`, `storagePath`, `sha256Hash` (UNIQUE), `status` (`pending_review` | `verified`), `documentType` (`invoice` | `bauspar_statement` | `loan_statement` | `contract` | `tax_notice` | `other`), `documentDate`, `issuer`, `totalAmountCents`, `linkedPropertyId` (FK set null), `linkedContractId` (FK set null), `isTaxRelevant`, `taxYear`, `taxCategory` (`handwerker_35a` | `haushaltsnahe_dl_35a` | `werbungskosten_vv` | `capital_gains` | `other`), `deductibleAmountCents`, `detectedBalanceCents`, `createdAt`
- `external_snapshots`: `id`, `source` (`finanz_cockpit`), `liquidCashCents`, `etfStocksCents`, `cryptoCents`, `totalPersonalNetWorthCents`, `householdJson`, `accountsJson`, `positionsJson` (nullable JSON-Texte, tolerant geparst), `fetchedAt`
- **Bridge-Vertrag (`finanz_cockpit` → `external_snapshots`):** optionale Felder `accounts[]` (`id`, `name`, `type`, `scope`, `balanceCents`, `holdingsValueCents`, optional `balanceAsOf` = Alter des Saldos in `finanz_cockpit`, nicht der Abrufzeitpunkt) und `positions[]` (`id`, `accountId`, `marketValueCents`, `lastPriceAt` …). Zeitstempel werden beim Parsen auf `toISOString()` normalisiert.

## 4. Funktionsumfang nach Versionen
- **v1 (Horizont 1 – Ordnung & Überblick):** Haushalts-Bilanz, generisches Vertrags-/Kreditregister, `Immobilie #0`, Cashflow-Adapter Modus A (Split-Modell), Wasserfall-Vorschlags-Engine, `finanz_cockpit`-Bridge, KI-Dokumenten-Inbox mit Vertrags-Eichung & Steuer-Tagging.
- **v2 (Horizont 2 – Strategie & Investieren, ab April):** Szenario-Labor (*Sondertilgung vs. ETF*, *Gehaltssprung*), KI-Investment-Coach auf Echtzeit-/Depotdaten, zentraler Steuer-Jahressammler.
- **v3 (Horizont 3 – Immobilien-Skalierung & Kontoumstieg):** Vermietungs-UI am Objektmodell (`usage === 'rented'`), Immobilien-Kaufrechner, Cashflow-Adapter Modus B (echtes Gemeinschaftskonto).

## 5. Routen-Architektur (v1)
1. **`/` (Haushalts-Cockpit):** Hero-KPIs (Aktiva, Passiva, Nettovermögen inkl. `finanz_cockpit`), Balken *Frei vs. Gebunden vs. Schulden* und Meilenstein-Zeitachse. Keine langen Tabellen oder Bearbeitungsformulare.
2. **`/vertraege` (Verträge & Immobilien):** Alle Kredite, Darlehen, Bausparer und Immobilien; CRUD via Modal; Detail-Drawer mit projiziertem vs. geeichtem Stand und Belegen sowie dem Tab *Portfolio* (`?tab=portfolio`) für vermietete Objekte (vor Steuern, *Modelliert*).
3. **`/allokation` (Cashflow & Wasserfall):** Haushalts-Positionen (Modus A), priorisierte Ziel-Töpfe und „Geld verteilen“-Modal mit 1-Klick-Vorschlag.
4. **`/dokumente` (KI-Dokumenten-Inbox):** PDF-Upload, Queue *„Zu prüfen“* (Split-Screen: PDF links, KI-Vorschlag + Eich-Checkbox rechts) und Archiv mit Steuer-Filter.
   Unterseite **`/dokumente/steuer?jahr=YYYY`** (Steuer-Sammler, read-only): Jahres-Belegmappe aus verifizierten, steuerrelevanten Belegen je Kategorie (inkl. Bucket *Nicht zugeordnet*), § 35a-Richtwert je Kategorie gedeckelt (*Modelliert*, unverbindlich), Print (`@media print`) und Export via `GET /api/tax/summary?year=` sowie `GET /api/tax/export?year=&format=zip|csv|json` (ZIP mit `uebersicht.csv`/`.json`, `LIESMICH.txt` und PDFs). Keine DB-Mutation.
5. **`/planung` (Szenario-Labor, v2):** Read-only Simulation ohne DB-Mutation: *Sondertilgung vs. ETF* (gleiches Monatsbudget, Endbesteuerung, Break-even-Rendite) und *Gehaltssprung* (Füllzeitpunkt der Ziel-Töpfe über den Wasserfall). Ergebnisse sind *Modelliert* (`border-dashed`).
   Zusätzlich: **Investment-Coach-Drawer** (stateless, nur auf Klick): Bewertung (*KI-Vorschlag*, Amber) und Q&A-Chat auf einem anonymisierten, serverseitig gebauten Kontext (Allowlist: ETF-Name/ISIN, sonst nur Refs/Enums/Integer; „Was die KI sieht“ zeigt den exakten Kontext). Rebalancing-Tabelle ist *Modelliert* (`border-dashed`). Keine DB-Mutation, keine Persistenz von Bewertungen oder Chats (`POST /api/coach/assessment`, `POST /api/coach/chat`).
   Unterseite **`/planung/kaufrechner`** (Kaufrechner, stateless, vor Steuern, *Modelliert*, keine DB-Mutation).
