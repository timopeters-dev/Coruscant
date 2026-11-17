# v3 Roadmap: Immobilien-Skalierung & Gemeinschaftskonto (Horizont 3)

Vorausschau für **Coruscant v3**, sobald die erste vermietete Kapitalanlage-Immobilie konkret wird und/oder das 3-Konten-/Gemeinschaftskonto-Modell eingeführt wird.

## Geplante Vertical Slices (v3 – Entwurf)
* **Slice 10 – Immobilien-Kaufrechner:** Simulation von Kaufpreis, Kaufnebenkosten (Eigenkapitalbedarf gegen den Wohnungs-EK-Topf), Kaltmiete, Zins, Tilgung und nicht-umlagefähigen Kosten.
* **Slice 11 – Vermietungs-Profil (`usage === 'rented'`):** Erweiterung der UI um Mieteinnahmen, Objekt-Kredite, Bewirtschaftungskosten und V+V-Steuerlogik pro Mietobjekt.
* **Slice 12 – Cashflow-Adapter Modus B (Gemeinschaftskonto):** Anbindung eines realen Gemeinschaftskontos (Bank-API / CSV) mit automatischer Erkennung der „Taschengeld“-Daueraufträge.
* **Slice 13 – KI-gestützte Immobilien-Wertschätzung (Optional / Web-Grounding):** Anonymisierte Objekt-Fakten (Region/PLZ ohne Adresse, Wohnfläche, Baujahr, Sanierungen, Miete) kombiniert mit aktuellem Web-Grounding liefern eine begründete **Wertspanne** als unverbindlichen KI-Vorschlag (1-Klick-Übernahme in `estimatedValueCents`).
