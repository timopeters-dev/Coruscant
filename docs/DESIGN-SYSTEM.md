# Design-System: „Quiet Galactic Precision“ (Coruscant)

Verbindliche UX- und UI-Leitplanken für alle Komponenten in **Coruscant**.

---

## 1. UX-Grundsätze
1. **Ruhe statt Trading-Terminal:** Keine blinkenden Ticker, keine grellen Neon-Farben, maximal 3 visuelle Ebenen.
2. **Progressive Disclosure:** Hauptansichten zeigen Status, Summen und Meilensteine; Formulare liegen in Modals oder Drawers.
3. **Ehrliche Präzision:** Modellierte Werte (Modus A / Pauschalen) tragen `border-dashed` + Badge *Modelliert*; geeichte Werte (`finanz_cockpit` / PDF-Auszug) tragen soliden Rahmen + *Geeicht*.
4. **1-Klick-Freigabe bei KI:** KI macht Vorschläge, mutiert aber niemals stillschweigend Bestandsdaten.

---

## 2. Farbpalette (Light & Dark Mode)

### Basis-Flächen & Text
| Token / Rolle | Light Mode | Dark Mode („Command Deck“) | Verwendung |
| :--- | :--- | :--- | :--- |
| **Background** | `#F8FAFC` | `#0B1120` | Seiten-Hintergrund |
| **Surface (Card)** | `#FFFFFF` | `#111827` | Karten, Modals, Panels |
| **Surface Elevated** | `#F1F5F9` | `#1E293B` | Hover-States, Sub-Container, Tabellen-Header |
| **Border** | `#E2E8F0` | `#1E293B` / `#334155` | Feine 1px-Rahmen statt harter Schatten |
| **Text Primary** | `#0F172A` | `#F8FAFC` | Überschriften, Hauptbeträge |
| **Text Secondary** | `#475569` | `#94A3B8` | Labels, Erklärtexte, Metadaten |

### Akzent- & Finanz-Semantik
| Bedeutung | Light Mode | Dark Mode | Einsatz |
| :--- | :--- | :--- | :--- |
| **Primary Accent (Indigo)** | `#4F46E5` | `#6366F1` | Primäre Buttons, aktive Navigation, Fokus |
| **KI / Meilenstein (Amber)** | `#D97706` | `#F59E0B` | KI-Vorschläge, Eich-Hinweise, Meilensteine |
| **Positiv / Aktiva (Emerald)** | `#059669` | `#34D399` | Nettovermögen, Überschuss, gefüllte Töpfe |
| **Negativ / Passiva (Rose)** | `#E11D48` | `#FB7185` | Kredite/Restschuld, Abflüsse, Unterdeckung |
| **Gebundenes Vermögen (Sky)** | `#0284C7` | `#38BDF8` | Immobilie #0, Bauspar-Guthaben |

---

## 3. Typografie & Tokens
- **UI-Schrift:** `Inter` (System-Sans-Fallback).
- **Zahlen-Pflicht:** Alle Beträge, Prozentsätze und Datumsangaben nutzen **`tabular-nums`**.
- **Radien:** Karten `rounded-xl` (`p-5`/`p-6`), Buttons/Inputs `rounded-lg`, Badges `rounded-md`.
- **Print:** `@media print` rendert strikt im hellen Layout.
