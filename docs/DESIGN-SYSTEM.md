# Design-System: „Eichamt“ (Coruscant)

Verbindliche UX- und UI-Leitplanken für alle Komponenten in **Coruscant**.

Leitidee: Coruscant ist ein Messinstrument für das eigene Vermögen. Die App unterscheidet ständig zwischen *geeicht* (gemessen) und *modelliert* (gerechnet) – diese Unterscheidung trägt die Gestaltung.

---

## 1. UX-Grundsätze
1. **Ruhe statt Trading-Terminal:** Keine Ticker, keine Leuchteffekte, maximal 3 visuelle Ebenen.
2. **Progressive Disclosure:** Hauptansichten zeigen Status, Summen und Meilensteine; Formulare liegen in Modals oder Drawers.
3. **Ehrliche Präzision:** Modellierte Werte (Modus A / Pauschalen) tragen `border-dashed` + Badge *Modelliert*; geeichte Werte (`finanz_cockpit` / PDF-Auszug) tragen soliden Rahmen + *Geeicht*.
4. **1-Klick-Freigabe bei KI:** KI macht Vorschläge, mutiert aber niemals stillschweigend Bestandsdaten.

---

## 2. Farbe: Tinte auf Kalkpapier

**Farbe gehört dem Geld.** Bedien-Elemente (Buttons, Navigation, Schalter, Segment-Umschalter, Checkboxen) sind einfarbig in Tinte. Farbe erscheint nur, wo sie finanzielle Bedeutung trägt. Die Variablennamen in `globals.css` sind historisch (`--emerald`, `--rose` …) und bleiben stabil; Komponenten referenzieren nur Rollen.

### Basis-Flächen & Text
| Token | Light | Dark | Verwendung |
| :--- | :--- | :--- | :--- |
| `--bg` (Kalkpapier) | `#ECEEEA` | `#111715` | Seiten-Hintergrund, Header |
| `--surface` (Bogen) | `#F8F9F6` | `#171E1C` | Karten, Modals, Panels |
| `--surface-elevated` | `#E4E7E2` | `#1F2825` | Sub-Container, Hover, leere Skalen |
| `--border` / `--border-sub` | `#D3D8D2` / `#B6BDB6` | `#29332F` / `#3C4843` | Haarlinien / Feld- und Steuerrahmen |
| `--text-primary` (Tinte) | `#18201D` | `#E3E8E2` | Überschriften, Beträge |
| `--text-secondary` (Graphit) | `#535E59` | `#9AA49E` | Labels, Erklärtexte |
| `--accent` | = Tinte | = Tinte (hell) | Primär-Button, aktive Navigation, Füllungen |

### Finanz-Semantik
| Rolle | Token | Light | Dark |
| :--- | :--- | :--- | :--- |
| Positiv / Aktiva (Patina) | `--emerald` | `#2E6B4C` | `#78C49A` |
| Negativ / Passiva (Karmin) | `--rose` | `#A8283A` | `#EE8B8B` |
| Gebunden: Immobilien, Bauspar (Stahlblau) | `--sky` | `#2F5D8A` | `#8DB2DE` |
| KI-Vorschlag / Meilenstein (Signalocker) | `--amber` | `#A35F00` | `#E0A548` |

- **Fokus:** `--focus` (Stahlblau-Mischung), 3px-Ring per `focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]` mit `outline-hidden` (nicht `outline-none`).
- **Print:** `@media print` rendert strikt im hellen Layout.

---

## 3. Typografie
- **Schrift:** Barlow (DIN-nah, echte Tabellenziffern) für UI und Fließtext; **Barlow Semi Condensed** (`--font-display`) für `h1`–`h4`, Seitentitel (`.page-title`) und große Beträge (`figure`-Utility).
- **Ziffern:** `tabular-nums` ist global gesetzt; die Klasse bleibt an Beträgen trotzdem erlaubt.
- **Grade:** an Barlow angepasst (`text-sm` = 15px, `text-xs` = 13px); für Kleinsttext `text-2xs` (12px) und `text-3xs` (11px) statt `text-[11px]`/`text-[10px]`.
- **Keine Versalien-Labels:** Abschnitts-Überschriften in Karten/Formularen nutzen `section-label` (Satzschreibung, halbschmal). `eyebrow` ist ebenfalls Satzschreibung.
- **Keine Deko-Pfeile:** Linktexte enden nicht auf `→`; Pfeile nur für echte Übergänge (vorher → nachher).

## 4. Datumsanzeige
- Tagesgenau: **`TT.MM.JJJJ`**, monatsgenau: **`MM.JJJJ`** (kein erfundener Tag), Zeitpunkte: **`TT.MM.JJJJ, HH:MM`** (Europe/Berlin).
- Ausschließlich über `src/lib/domain/date-format.ts` (`formatDateDE`, `formatMonthDE`, `formatMonthPartsDE`, `formatDateTimeDE`). Kein rohes ISO in der Oberfläche, keine lokalen Formatter.
- Gespeichert wird weiterhin ISO (`YYYY-MM-DD` / `YYYY-MM`).

## 5. Flächen, Formen, Struktur
- **Karten:** `CARD_SURFACE` (`src/components/ui/card.tsx`) – Bogen mit einer Haarlinie, **kein Schatten**. Klickbare Karten (`<Card interactive>`) wechseln beim Hover nur die Linie zu Tinte, kein Anheben.
- **Radien:** bewusst klein (Tailwind-Skala in `@theme` überschrieben: `md` 3px, `lg` 5px, `xl` 7px, `2xl` 10px) – Hierarchie über Größe, nicht über Weichheit.
- **Keine Kästen in Kästen:** Listen innerhalb einer Karte sind Zeilen mit Haarlinien (`divide-y`), Kennzahl-Gruppen Spalten mit Trennlinien.
- **Header & Dock:** deckend auf Kalkpapier, Haarlinie unten bzw. oben; aktiver Navigationspunkt mit Tintenstrich.
- **Kein Ambient-Hintergrund**, keine Verläufe, keine Glows, keine Icon-Chips als Dekoration.
- **Nummerierung** nur bei echten Folgen (z. B. Wasserfall-Priorität der Töpfe) – als schlichte halbschmale Ziffer, nicht als `#1`-Badge.

## 6. Signatur-Elemente
- **Eichskala:** Jeder Fortschritts-/Anteilsbalken trägt `.meter` – flache Skala mit Kerben alle 10 %, Füllung in Tinte oder Semantikfarbe. `.scale-ticks` ergänzt eine Teilstrich-Skala (0/50/100 %) unter Balken, wo Anteile gelesen werden.
- **Prüfzeichen im `StatusBadge`:** Geeicht = Eichmarke (voller Kern im Ring), Modelliert = gestrichelter Ring, KI-Vorschlag = Raute, Eich-Hinweis = Dreieck. Detailwerte stehen hinter einer feinen Trennlinie, nicht hinter `·`.
- **Bilanzgleichung (Cockpit):** Aktiva − Passiva = Nettovermögen als ein Band mit Rechenzeichen statt drei gleichförmiger Kennzahl-Kacheln.
- **Slider:** Tintenfüllung bis zum Schieber über `rangeFillStyle(value, min, max)` (`src/components/ui/range-fill.ts`).

## 7. Bewegung
- **Prinzip:** Bewegung beantwortet Handlungen (Öffnen, Umschalten, Bestätigen). Der einzige automatische Moment: Skalen (`.meter`) und Chart-Serien decken sich beim ersten Rendern einmal von links auf.
- Seiten blenden nur kurz ein (`.page-enter`, ohne Versatz). Kein gestaffeltes Einblenden, kein Hover-Anheben, Kennzahlen zählen beim Laden **nicht** hoch (`AnimatedNumber` animiert nur Wertänderungen).
- Easing `--ease-out`, Dauern `--dur-fast` 120 ms / `--dur` 200 ms / `--dur-slow` 380 ms; Federn zentral in `src/components/ui/motion.ts`.
- **Pflicht:** `prefers-reduced-motion` schaltet alle Animationen ab; Druck rendert ohne Animation.

## 8. Komponenten-Bausteine (`src/components/ui/`)
- `Select` – eigene Listbox (Radix Popover), API wie natives `<select>`, Tastatur & Type-ahead.
- `DatePicker` / `MonthPicker` – Eingabe `TT.MM.JJJJ` oder Kalender (react-day-picker, de, Montag zuerst); Werte bleiben ISO.
- `Dialog` / `Sheet` – animiert, Portal nach `body`, Fokus-Falle, Scroll-Lock, Escape respektiert innere Popover.
- Segment-Umschalter (`segmented.tsx`) – Schiene mit gleitender Tinten-Pille für Tabs, Zeiträume und Ansichten.
- `KpiCard` – Kennzahl-Kachel mit farbigem Messstrich links (nur Semantikfarbe), ohne Icon.
- Befehlspalette (`command-menu.tsx`, ⌘K / Strg+K) für Navigation und Farbschema.
- `InfoTip` – erklärt Schalter, Umschalter und Fachbegriffe direkt am Element (`align="end"` für Symbole am rechten Rand).
- `Collapse` / `CollapseChevron` – weiches Auf-/Zuklappen für per State gesteuerte Bereiche.
- Formulare in geteilten Ansichten nutzen Container-Queries (`@container`, `@md:`/`@xl:`).
- Native Checkboxen, Radios und Slider sind global im App-Look gestylt (`globals.css`).
