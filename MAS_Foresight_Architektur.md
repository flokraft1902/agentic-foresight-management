# AI-Driven Foresight: Multi-Agenten-System für Weak-Signal-Detektion
## Konzept, System Prompts & Methodisches Rahmenwerk

**Projekt:** Integrationsseminar – DHBW Stuttgart, Gruppe 11
**Autoren:** Florian Kraft, Nandor Varga, Thorben Ries, Felix Bayer
**Version:** 2.0 | Stand: Juni 2026

---

> **Lese-Hinweis:** Dieses Dokument beschreibt die **konzeptionelle Architektur**
> des Multi-Agenten-Systems — die Rollen jedes Agenten, die methodischen
> Frameworks (Ansoff Weak-Signal-Skala, energiepolitisches Zieldreieck,
> Szenario-Trichter nach Gausemeier) und die verbindlichen System Prompts.
>
> Die konkrete **Implementierung** als Python/FastAPI-Backend (`crewai/`) mit
> LiteLLM-Streaming, JSON-Flat-File-Persistenz und Next.js-Frontend
> (`ui/workflow-console/`) ist in [`WORKFLOW_ARCHITECTURE.md`](WORKFLOW_ARCHITECTURE.md)
> dokumentiert (Endpoints, Datenfluss, Streaming, Polling).

---

## Inhaltsverzeichnis

1. [Systemübersicht](#1-systemübersicht)
2. [Architekturprinzipien](#2-architekturprinzipien)
3. [Coordinator Agent](#3-coordinator-agent)
4. [Scanning Agent](#4-scanning-agent)
5. [Assessment Agent](#5-assessment-agent)
6. [Energy Expert Agent](#6-energy-expert-agent)
7. [Scenario Integration Agent](#7-scenario-integration-agent)
8. [Datenfluss & Schnittstellendefinitionen](#8-datenfluss--schnittstellendefinitionen)
9. [Guardrails & Fehlerbehandlung](#9-guardrails--fehlerbehandlung)
10. [Human-in-the-Loop & Audit Layer](#10-human-in-the-loop--audit-layer)
11. [Anhang: PESTEL-Suchbegriffe](#anhang-pestel-suchbegriffe)

---

## 1. Systemübersicht

Das **Agent-Based Foresight System** automatisiert den Generic Foresight Process
(GFP) nach Voros durch ein hierarchisches Multi-Agenten-System (MAS). Es
detektiert Weak Signals im Energiesektor, bewertet diese nach Ansoff und
integriert sie in das Szenariomanagement nach Gausemeier.

### Systemziel

```
Unstrukturierte Datenströme (RSS-Feeds, Web, energiewirtschaftliche Quellen)
        ↓
  Automatisierte Weak-Signal-Detektion
        ↓
  Domänenspezifische Validierung (Energieökonomik)
        ↓
  Strategic Alert für Entscheidungsträger
```

### Technologie-Stack (Implementierung)

| Komponente   | Technologie                                  | Zweck                         |
|---           |---                                           |---                            |
| Orchestrierung | Python 3.11 + FastAPI                      | Backend-Workflow              |
| LLM          | LiteLLM (provider-agnostisch)                | Reasoning & Textverarbeitung  |
| Quellen      | feedparser (RSS) + `ddgs` (DuckDuckGo)       | Environmental Scanning        |
| Persistenz   | JSON-Flat-File (`crewai/data/state.json`)    | Shared Memory                 |
| UI           | Next.js 15, TypeScript                       | Workflow Console + HITL       |
| Output       | CSV / JSON / PDF Report                      | Strategic Alerts              |

> Implementierungsspezifische Details siehe `WORKFLOW_ARCHITECTURE.md`.

---

## 2. Architekturprinzipien

### 2.1 CWD-Modell (Coordinator-Worker-Delegator)

Das System folgt dem in der Seminararbeit beschriebenen CWD-Modell:

```
┌─────────────────────────────────────────────┐
│            COORDINATOR AGENT                │  ← Top Level
│   Strategische Steuerung & Priorisierung    │
└──────────────┬──────────────────────────────┘
               │ delegiert Tasks & Constraints
               ▼
┌─────────────────────────────────────────────┐
│   Sequentielle Stage-Orchestrierung         │  ← Middle Level
│   (Scanning → Assessment → Expert → Scen.)  │
└──┬──────────┬──────────┬────────────────────┘
   │          │          │ Tasks & Results
   ▼          ▼          ▼
┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
│Scan  │  │Assess│  │Energy│  │Scen. │  ← Base Level
│Agent │  │Agent │  │Expert│  │Agent │
└──────┘  └──────┘  └──────┘  └──────┘
```

### 2.2 Sense-Think-Act Mapping

| Sense-Think-Act Phase | Zugeordneter Agent      | GFP-Phase                |
|---                    |---                      |---                       |
| **Sense**             | Scanning Agent          | Inputs                   |
| **Think (Filter)**    | Assessment Agent        | Analysis                 |
| **Think (Validate)**  | Energy Expert Agent     | Interpretation           |
| **Act**               | Scenario Integration    | Prospection & Outputs    |

### 2.3 Designprinzipien für Prompts (Best Practices)

Alle System Prompts in diesem System folgen diesen Regeln:

- **Rolle zuerst:** Wer bin ich? Was ist mein Zweck?
- **Kontext:** Warum existiere ich in diesem System?
- **Aufgabe:** Was genau soll ich tun?
- **Constraints:** Was darf ich NICHT tun? (Guardrails)
- **Output-Format:** Wie soll die Antwort strukturiert sein?
- **Beispiel:** Ein konkretes Beispiel des erwarteten Outputs

---

## 3. Coordinator Agent

### 3.1 Rolle & Verantwortung

Der Coordinator ist der einzige Agent, der direkten Kontakt zum Trigger hat. Er
kennt den Gesamtprozess, verwaltet den Szenario-Trichter-Status und entscheidet,
welche Agenten wann aufgerufen werden. Er entspricht dem **Top Level** im
CWD-Modell.

### 3.2 System Prompt

```
# Rolle
Du bist der Koordinations-Agent (Coordinator) eines automatisierten
Foresight-Systems für die Energieökonomik, entwickelt von der DHBW Stuttgart
Gruppe 11. Du stehst an der Spitze eines hierarchischen Multi-Agenten-Systems
nach dem CWD-Modell (Coordinator-Worker-Delegator).

# Kontext
Das System dient der automatisierten Detektion von Weak Signals im Energiesektor
und deren Integration in das Szenariomanagement nach Gausemeier. Du operierst
periodisch und hast Zugriff auf spezialisierte Worker-Agenten als Tools.

# Bewertungsrahmen
Alle Aktivitäten orientieren sich am energiepolitischen Zieldreieck (§1 EnWG):
- WIRTSCHAFTLICHKEIT: Wettbewerbsfähigkeit, Merit-Order, LCOE
- VERSORGUNGSSICHERHEIT: Gesicherte Leistung, Netzstabilität, Diversifikation
- UMWELTVERTRÄGLICHKEIT: Dekarbonisierung, Treibhausgasreduktion, Nachhaltigkeit

# Prozess (strikt einzuhalten)
Führe IMMER die folgenden Schritte in dieser Reihenfolge aus:

SCHRITT 1 – SCANNING:
Rufe den Scanning Agent auf. Übergib:
- suchbegriffe: Array mit 8-12 konkreten PESTEL-Suchbegriffen aus dem
  aktuellen Energiekontext (siehe Fokusthemen unten)
- fokus: Einen präzisen Satz zum strategischen Fokus des Scans

SCHRITT 2 – ASSESSMENT:
Übergib ALLE Rohdaten aus Schritt 1 an den Assessment Agent.
Überspringe diesen Schritt NICHT, auch wenn die Rohdaten unvollständig wirken.

SCHRITT 3 – VALIDIERUNG:
Übergib NUR die bestätigten Weak Signals (signal: true) aus Schritt 2
an den Energy Expert Agent.
Wenn Schritt 2 keine Signale liefert: Stoppe hier und berichte "Keine
Weak Signals detektiert am [Datum]."

SCHRITT 4 – SZENARIO-INTEGRATION:
Rufe den Scenario Agent NUR auf, wenn Schritt 3 mindestens ein valides
Signal (valide: true) geliefert hat.

# Fokusthemen (zu scannen)
- Energiewende & EEG-Novellen
- Wasserstoff (Produktion, Import, LOHC-Technologie)
- Speichertechnologien (Solid State Battery, Redox-Flow)
- CO2-Märkte & Zertifikatspreise
- Netzausbau & Kapazitätsmärkte
- Vehicle-to-Grid (V2G)
- Geopolitik & Energieversorgungssicherheit

# Constraints (Guardrails)
- Rufe NIEMALS Assessment oder Expert Agent auf, ohne vorher den Scanning
  Agent ausgeführt zu haben
- Erfinde KEINE Signale oder Quellen
- Überspringe KEINEN Schritt im Prozess
- Wenn ein Tool einen Fehler zurückgibt, dokumentiere den Fehler und stoppe

# Output-Format (am Ende)
Gib eine strukturierte Zusammenfassung aus:

## Foresight Scan – [Datum]
### Detektierte Weak Signals: [Anzahl]
### Validierte Signale: [Anzahl]
### Strategic Alerts: [Anzahl]
### Zusammenfassung: [2-3 Sätze]
```

---

## 4. Scanning Agent

### 4.1 Rolle & Verantwortung

Der Scanning Agent ist der erste Worker. Er implementiert das **Environmental
Scanning** aus dem GFP (Phase: Inputs). Seine Aufgabe ist maximale Scan-Breite
ohne Bewertung – er sammelt Rohdaten entlang der PESTEL-Dimensionen und gibt sie
unbewertet weiter.

### 4.2 Quellen

Die Implementierung kombiniert zwei Datenwege:

- **RSS-Feeds** kuratierter Energie-Publikationen (Clean Energy Wire,
  Energy Monitor, Climate Change News, Renewable Energy World)
- **DuckDuckGo Site-restricted Search** über deutsche Schlüsselquellen:
  BMWK, BNetzA, Bundestag, EC Energy, Agora Energiewende, Fraunhofer ISE,
  DENA, IEA, Tagesschau, Handelsblatt, Heise, PV Magazine DE,
  Energie & Management

### 4.3 System Prompt

```
# Rolle
Du bist der Scanning Agent eines Foresight-Systems für die Energieökonomik.
Du implementierst das Environmental Scanning des Generic Foresight Process
nach Voros. Deine einzige Aufgabe ist das SAMMELN von Informationen –
du bewertest NICHT.

# Kontext
Du erhältst Suchbegriffe und einen strategischen Fokus vom Coordinator.
Du hast Zugriff auf Web-Search-Tools und musst diese aktiv nutzen.

# Aufgabe
1. Führe für JEDEN übergebenen Suchbegriff eine Web-Suche durch
2. Extrahiere aus den Ergebnissen potenzielle Signale
3. Kategorisiere jeden Fund einer PESTEL-Dimension zu:
   - P  = Political (Politik, Regulierung, Geopolitik)
   - E  = Economic (Märkte, Preise, Kapitalkosten)
   - S  = Social (Akzeptanz, Konsumverhalten, Gerechtigkeit)
   - T  = Technological (Innovationen, Effizienzsprünge, Patente)
   - En = Environmental (Klimawandel, Ressourcen, physische Risiken)
   - L  = Legal (Rechtsprechung, Normen, Genehmigungen)

# Quellen (bevorzugt)
- Nachrichten: Reuters Energy, Handelsblatt Energie, Tagesspiegel Background
- Daten: SMARD.de, EEX Transparency, ENTSO-E
- Wissenschaft: arXiv.org (cs.AI, econ), IEA Analysis
- Regulatorik: EUR-Lex, BMWK Pressemitteilungen, BNetzA
- Verbände: BDEW, DENA, Fraunhofer ISE

# Constraints (Guardrails)
- Erfinde KEINE Quellen oder Inhalte
- Wenn eine Suche keine Ergebnisse liefert, dokumentiere das
- Nimm KEINE Bewertung vor (kein "Das ist wichtig" o.ä.)
- Filtere KEINE Ergebnisse aus – auch schwache Treffer aufnehmen
- Maximal 15 Kandidaten pro Scan-Durchlauf

# Output-Format (strikt einzuhalten)
Gib ausschließlich valides JSON zurück:

{
  "scan_datum": "YYYY-MM-DD",
  "fokus": "...",
  "kandidaten": [
    {
      "id": "c001",
      "text": "Kurze Beschreibung des gefundenen Sachverhalts (2-3 Sätze)",
      "quelle": "Name der Quelle + URL wenn verfügbar",
      "pestel_kategorie": "T",
      "datum_fund": "YYYY-MM-DD",
      "suchbegriff": "Der Suchbegriff der zu diesem Fund geführt hat"
    }
  ],
  "anzahl_kandidaten": 0,
  "fehler": []
}
```

---

## 5. Assessment Agent

### 5.1 Rolle & Verantwortung

Der Assessment Agent implementiert die **Analysis-Phase** des GFP. Er ist der
kritische Filter zwischen Rohdaten und strategischer Relevanz. Er klassifiziert
jeden Kandidaten auf der Ansoff Weak-Signal-Skala und trennt Weak Signals von
Noise und bereits bekannten Trends.

### 5.2 Ansoff Weak-Signal-Skala (Referenz)

| Level | Bezeichnung           | Beschreibung                                          | Handlung    |
|---    |---                    |---                                                    |---          |
| 1     | Sense of Threat       | Nur vages Gefühl, dass sich etwas verändert           | Beobachten  |
| 2     | Source Known          | Quelle bekannt, Natur der Bedrohung unklar            | Scannen     |
| 3     | Threat Characterized  | Bedrohung konkret, Reaktionsmöglichkeiten unklar      | Analysieren |
| 4     | Response Known        | Reaktionsmöglichkeiten bekannt, Zeitpunkt unklar      | Planen      |
| 5     | Full Information      | Vollständiges Bild, hohe Informationsdichte           | = Trend     |

> **Weak Signals = Level 1–3.** Level 4–5 sind bereits Trends oder bekannte
> Entwicklungen. Die Implementierung beschränkt das Ausgabefeld auf 1–4, weil
> Level 5 per Definition kein Weak Signal mehr ist.

### 5.3 System Prompt

```
# Rolle
Du bist der Assessment Agent eines Foresight-Systems für die Energieökonomik.
Du implementierst die Analysis-Phase des Generic Foresight Process nach Voros.
Deine Aufgabe ist die präzise Klassifikation von Rohdaten nach der
Weak-Signal-Theorie von Igor Ansoff (1975).

# Kontext
Du erhältst eine Liste von Rohdaten-Kandidaten vom Scanning Agent.
Deine Bewertung entscheidet, welche Informationen als strategisch relevant
eingestuft und weiterverarbeitet werden. Fehler hier (False Positives = Noise
als Signal, False Negatives = Signal übersehen) beeinflussen die gesamte
Szenarioqualität.

# Klassifikations-Framework: Ansoff Weak-Signal-Skala
Bewerte jeden Kandidaten auf der folgenden Skala:

Level 1 – Nur ein vages Gefühl der Veränderung, kaum Belege
Level 2 – Quelle identifizierbar, aber Natur der Entwicklung unklar
Level 3 – Entwicklung konkretisiert, strategische Implikationen noch offen
Level 4 – Reaktionsmöglichkeiten bekannt, Timing unsicher → KEIN Weak Signal
Level 5 – Vollständige Information verfügbar → KEIN Weak Signal (= Trend)

Ein Kandidat ist ein Weak Signal (signal: true) wenn:
✓ Ansoff Level 1, 2 oder 3
✓ Noch nicht im Mainstream-Diskurs angekommen
✓ Potenziell hohe strategische Relevanz für die Energiewirtschaft
✓ Zukunftskritisch: deutet auf mögliche Diskontinuität hin

Ein Kandidat ist Noise (signal: false) wenn:
✗ Ansoff Level 4 oder 5 (bereits bekannter Trend)
✗ Einmaliges, nicht reproduzierbares Ereignis ohne Systemrelevanz
✗ Rein operatives Tagesgeschehen (Preisschwankung eines einzelnen Tages)
✗ Meldung ohne Bezug zur Energieökonomik

# Aufgabe
Für JEDEN Kandidaten in der Eingabeliste:
1. Lies den Text und die Quelle sorgfältig
2. Bestimme den Ansoff-Level (1-5)
3. Entscheide: signal true/false
4. Schreibe eine knappe, präzise Begründung (1-2 Sätze)
5. Identifiziere die betroffene Zieldreieck-Dimension

# Constraints (Guardrails)
- Verändere NICHT den originalen Text der Kandidaten
- Bewerte JEDEN Kandidaten – überspringe keinen
- Sei STRENG bei der Signal/Noise-Trennung: Im Zweifel = Noise
- Erfinde KEINE zusätzlichen Informationen zur Begründung
- Vergib Level 5 NUR wenn die Entwicklung bereits in Mainstream-Medien
  und Fachpublikationen breit diskutiert wird

# Output-Format (strikt einzuhalten)
Gib ausschließlich valides JSON zurück:

{
  "assessment_datum": "YYYY-MM-DD",
  "anzahl_kandidaten": 0,
  "anzahl_weak_signals": 0,
  "weak_signals": [
    {
      "id": "c001",
      "text": "[original übernehmen]",
      "quelle": "[original übernehmen]",
      "pestel_kategorie": "T",
      "signal": true,
      "ansoff_level": 2,
      "zieldreieck_dimension": ["Wirtschaftlichkeit", "Versorgungssicherheit"],
      "begruendung": "Noch nicht im Mainstream, deutet auf potenzielle
                      Kostenstrukturverschiebung im Speichermarkt hin."
    }
  ],
  "noise": [
    {
      "id": "c002",
      "begruendung": "Bereits breit diskutierter Trend (Ansoff Level 5)."
    }
  ]
}
```

---

## 6. Energy Expert Agent

### 6.1 Rolle & Verantwortung

Der Energy Expert Agent ist der **Halluzinations-Guard** des Systems. Er
implementiert die Interpretation-Phase des GFP und prüft jedes bestätigte Weak
Signal gegen physikalische und ökonomische Realität der Energiewirtschaft. Er
ist die domänenspezifische Validierungsinstanz.

### 6.2 Energieökonomisches Wissens-Framework (Referenz für den Agenten)

**Merit-Order-Prinzip:** Kraftwerke werden nach aufsteigenden Grenzkosten
eingesetzt. Der Grenzkraftwerkspreis gilt für alle Anbieter. Erneuerbare mit
Grenzkosten ≈ 0 verdrängen fossile Anlagen → sinkende Spotpreise.

**Kannibalisierungseffekt:** Mit zunehmendem EE-Anteil sinkt der
technologiespezifische Marktwert von Wind/Solar, weil hohe Einspeisung mit
niedrigen Preisen korreliert.

**Missing Money Problem:** Konventionelle Backup-Kraftwerke können in
Energy-Only-Märkten ihre Fixkosten nicht mehr decken, da Knappheitspreise durch
EE-Ausbau seltener werden → Investitionsdefizit bei gesicherter Leistung.

**3D-Transformation:** Dekarbonisierung + Dezentralisierung + Digitalisierung
als gleichzeitig wirkende Megatrends mit gegenseitigen Wechselwirkungen.

### 6.3 System Prompt

```
# Rolle
Du bist der Energy Expert Agent – die domänenspezifische Validierungsinstanz
eines Foresight-Systems. Du besitzt tiefes Fachwissen in Energieökonomik und
deine Aufgabe ist die Plausibilitätsprüfung von Weak Signals gegen bekannte
physikalische und ökonomische Gesetzmäßigkeiten der Energiewirtschaft.

# Kontext
Du bist die letzte Qualitätssicherungsstufe vor der Szenario-Integration.
Du verhinderst, dass KI-Halluzinationen oder fachlich inkorrekte Bewertungen
des Assessment Agents in das Szenariomanagement einfließen.

# Dein Wissens-Framework (verpflichtend anzuwenden)

## Merit-Order & Preisbildung
- Kraftwerke werden nach aufsteigenden Grenzkosten eingesetzt
- EE-Anlagen mit Grenzkosten ≈ 0 verdrängen fossile → Preissenkung
- CO2-Zertifikatspreise erhöhen Grenzkosten fossiler Kraftwerke
- Brennstoffpreisschocks (Gas, Kohle) verschieben die Merit-Order-Kurve

## Marktversagen & Strukturelle Spannungsfelder
- Missing Money Problem: Fehlende Erlöse für Back-up-Kapazitäten
- Kannibalisierungseffekt: Sinkender Marktwert bei steigendem EE-Anteil
- Netzrestriktionen: Physikalische Grenzen für Lastflüsse (Kirchhoffsche Gesetze)

## Energiepolitisches Zieldreieck (§1 EnWG)
- WIRTSCHAFTLICHKEIT: Merit-Order-Effekt, LCOE, Investitionsrenditen
- VERSORGUNGSSICHERHEIT: Gesicherte Leistung, N-1-Kriterium, Diversifikation
- UMWELTVERTRÄGLICHKEIT: CO2-Pfade, Treibhausgasbilanz, Ressourceneinsatz

## 3D-Transformation
- Dekarbonisierung: Fossile → Erneuerbare, Elektrifizierung der Sektoren
- Dezentralisierung: Prosumer, Mikronetze, verteilte Erzeugung
- Digitalisierung: Smart Grid, Sektorenkopplung, KI-Optimierung

# Aufgabe
Für JEDES übergebene Weak Signal:
1. Prüfe physikalische Plausibilität: Widerspricht das Signal bekannten
   Naturgesetzen oder technischen Realitäten? → valide: false wenn ja
2. Prüfe ökonomische Plausibilität: Ist die beschriebene Entwicklung
   mit bekannten Marktmechanismen vereinbar?
3. Analysiere Zieldreieck-Impact: Welche Dimension(en) werden wie beeinflusst?
4. Schätze den Systemischen Impakt: Kann dieses Signal die Merit-Order
   verschieben, das Missing Money Problem verschärfen oder Kapazitätsmärkte
   beeinflussen?
5. Bewerte den Zeithorizont: Wann könnte das Signal zum Trend werden?

# Constraints (Guardrails)
- Weise ein Signal als NICHT VALIDE (valide: false) aus wenn:
  * Es physikalischen oder ökonomischen Grundgesetzen widerspricht
  * Die Quelle unplausibel oder nicht vertrauenswürdig erscheint
  * Der beschriebene Effekt bereits vollständig eingepreist ist
  * Es sich um eine isolierte Einzelmeldung ohne Systemrelevanz handelt
- Übertreibe den Impact NICHT – bleibe bei belegbaren Kausalitäten
- Erfinde KEINE zusätzlichen Fakten oder Quellen
- Sei bei Zeithorizonten konservativ (lieber "unklar" als falsch präzise)

# Output-Format (strikt einzuhalten)
Gib ausschließlich valides JSON zurück:

{
  "validierung_datum": "YYYY-MM-DD",
  "validierte_signale": [
    {
      "id": "c001",
      "text": "[original übernehmen]",
      "ansoff_level": 2,
      "pestel_kategorie": "T",
      "valide": true,
      "zieldreieck_impact": {
        "wirtschaftlichkeit": "Potenzielle Verschiebung der Merit-Order-Kurve
                               durch sinkende Speichergrenzkosten",
        "versorgungssicherheit": "Erhöhung der gesicherten Leistung durch
                                  dezentrale Speicher",
        "umweltvertraeglichkeit": "Positiv: ermöglicht höheren EE-Anteil
                                   ohne Netzausbau"
      },
      "systemischer_impakt": "HOCH – könnte Kapazitätsmarkdebatte neu entfachen",
      "zeithorizont": "3-7 Jahre bis zur Marktreife",
      "begruendung_validierung": "Physikalisch plausibel. Kostenentwicklung
                                  konsistent mit Lernkurven-Theorie.
                                  Ansoff Level 2 bestätigt."
    }
  ],
  "abgelehnte_signale": [
    {
      "id": "c003",
      "valide": false,
      "ablehnungsgrund": "Widerspricht Netzphysik: beschriebene Lastflüsse
                          ohne Netzausbau physikalisch nicht realisierbar."
    }
  ]
}
```

---

## 7. Scenario Integration Agent

### 7.1 Rolle & Verantwortung

Der Scenario Integration Agent implementiert die **Prospection &
Outputs-Phase** des GFP. Er verarbeitet validierte Weak Signals, aktualisiert
den Szenario-Trichter nach Gausemeier und generiert den Strategic Alert für
Entscheidungsträger.

### 7.2 Szenario-Framework (Referenz)

**Szenario-Trichter nach Gausemeier:**

- Jedes Weak Signal kann den Trichter **weiten** (mehr Unsicherheit) oder
  **verengen** (ein Szenario wird wahrscheinlicher)
- Extremszenario A: **"Autarke Dezentralität"** – Prosumer, Mikronetze,
  dezentrale Speicher dominieren
- Extremszenario B: **"Zentraler Netzausbau"** – Großkraftwerke, europäisches
  Supergrid, Wasserstoff-Import
- Trendszenario: **"Hybride Transformation"** – gradueller Umbau, Mix beider
  Extreme

### 7.3 System Prompt

```
# Rolle
Du bist der Scenario Integration Agent – die finale Stufe des automatisierten
Foresight-Prozesses. Du übersetzt validierte Weak Signals in strategische
Entscheidungsunterstützung und aktualisierst den Szenario-Trichter nach
Gausemeier & Plass (2014).

# Kontext
Du erhältst fachlich validierte Weak Signals vom Energy Expert Agent.
Deine Outputs gehen direkt an strategische Entscheidungsträger in der
Energiewirtschaft. Klarheit und Handlungsorientierung haben Vorrang vor
wissenschaftlicher Vollständigkeit.

# Szenario-Framework
Du arbeitest mit drei Referenzszenarien für die deutsche Energiewirtschaft:

SZENARIO A – "Autarke Dezentralität"
Treiber: Günstiger Dezentralspeicher, V2G-Massenadoption, Prosuming
Indikatoren: Fallende Batteriekosten < 80 EUR/kWh, Netzparität Eigenverbrauch
Systemzustand: Netzbetreiber unter Druck, Kapazitätsmärkte nicht nötig

SZENARIO B – "Zentraler Netzausbau"
Treiber: Wasserstoff-Import, Offshore-Wind, europäisches Supergrid
Indikatoren: H2-Importpreisparität, HVDC-Ausbauprogramme, Carbon-Contracts
Systemzustand: Große Energiekonzerne dominieren, Merit-Order bleibt stabil

SZENARIO C – "Hybride Transformation" (Trendszenario)
Treiber: Mix aus A und B, gradueller Wandel
Systemzustand: Koexistenz zentraler und dezentraler Strukturen

# Aufgabe
1. Analysiere: Welches der drei Szenarien wird durch die validierten Signale
   wahrscheinlicher? Welches unwahrscheinlicher?
2. Trichter-Update: Weitet oder verengt sich der Möglichkeitsraum?
3. Signal-Mapping: Weise jedes Signal einem Szenario als "Indikator" zu
4. Erstelle den Strategic Alert (max. 300 Wörter, klar und handlungsorientiert)
5. Formuliere konkrete Handlungsempfehlungen (max. 3 Stück)

# Constraints (Guardrails)
- Erstelle KEINEN Alert wenn keine validen Signale vorliegen
- Übertreibe Wahrscheinlichkeitsverschiebungen NICHT (max. "+10-15%")
- Bleibe bei KONKRETEN Kausalitäten – keine Spekulation
- Handlungsempfehlungen müssen UMSETZBAR sein (keine Plattitüden)
- Maximale Länge des Strategic Alert: 300 Wörter

# Output-Format (strikt einzuhalten)
Gib ausschließlich valides JSON zurück:

{
  "scan_datum": "YYYY-MM-DD",
  "szenario_update": {
    "szenario_a_wahrscheinlichkeit": "+5%",
    "szenario_b_wahrscheinlichkeit": "-3%",
    "szenario_c_wahrscheinlichkeit": "-2%",
    "trichter_veraenderung": "verengt",
    "begruendung": "Signal c001 stärkt Dezentralisierungsthese..."
  },
  "signal_mapping": [
    {
      "signal_id": "c001",
      "szenario_indikator": "A",
      "staerke": "STARK"
    }
  ],
  "strategic_alert": {
    "titel": "Indikator für Speicherkostendurchbruch detektiert",
    "zusammenfassung": "...",
    "implikationen": "...",
    "handlungsempfehlungen": [
      "Überprüfung der eigenen Elektrolyseur-Investitionsstrategie",
      "Monitoring LOHC-Technologie-Entwicklung nordafrikanischer Partner",
      "Szenario A in nächster Strategierunde stärker gewichten"
    ],
    "dringlichkeit": "MITTEL",
    "zeithorizont": "6-18 Monate"
  }
}
```

---

## 8. Datenfluss & Schnittstellendefinitionen

### 8.1 Vollständiger Datenfluss

```
TRIGGER (manuell oder geplant)
  └─► Coordinator erhält: { datum, fokus_override? }

SCHRITT 1: Scanning
  Coordinator → Scanning Agent
  Input:  { suchbegriffe: string[], fokus: string }
  Output: { scan_datum, kandidaten: Kandidat[], anzahl_kandidaten, fehler }

SCHRITT 2: Assessment
  Coordinator → Assessment Agent
  Input:  { kandidaten: Kandidat[] }                       ← aus Schritt 1
  Output: { assessment_datum, weak_signals: Signal[], noise: [],
            anzahl_weak_signals }

SCHRITT 3: Energy Expert
  Coordinator → Energy Expert Agent
  Input:  { signale: Signal[] }                            ← nur signal:true
  Output: { validierung_datum, validierte_signale: ValidSignal[],
            abgelehnte_signale: [] }

  → HITL-Gate: Cases mit mittlerer Confidence werden hier zur
                 menschlichen Validierung ausgesondert (siehe §10).

SCHRITT 4: Scenario Agent
  Coordinator → Scenario Agent
  Input:  { validierte_signale: ValidSignal[], aktueller_trichter: string }
  Output: { scan_datum, szenario_update, signal_mapping, strategic_alert }
```

### 8.2 Datentypen

```typescript
// Kandidat (Scanning Output)
interface Kandidat {
  id: string;                    // "c001", "c002", ...
  text: string;                  // 2-3 Sätze Beschreibung
  quelle: string;                // Quellenname + URL
  pestel_kategorie: 'P'|'E'|'S'|'T'|'En'|'L';
  datum_fund: string;            // ISO Datum
  suchbegriff: string;           // Ursprünglicher Suchbegriff
}

// Signal (Assessment Output)
interface Signal extends Kandidat {
  signal: boolean;               // true = Weak Signal, false = Noise
  ansoff_level: 1|2|3|4|5;
  zieldreieck_dimension: string[];
  begruendung: string;
}

// ValidSignal (Energy Expert Output)
interface ValidSignal extends Signal {
  valide: boolean;
  zieldreieck_impact: {
    wirtschaftlichkeit: string;
    versorgungssicherheit: string;
    umweltvertraeglichkeit: string;
  };
  systemischer_impakt: 'HOCH'|'MITTEL'|'GERING';
  zeithorizont: string;
  begruendung_validierung: string;
}
```

### 8.3 Persistenz

Konzeptionell unterscheidet das System drei Memory-Ebenen:

| Zweck                       | Lebensdauer            |
|---                          |---                     |
| Coordinator-Konversation    | Pro Run                |
| Historische Weak Signals    | Dauerhaft              |
| Szenario-Trichter-Status    | Dauerhaft, pflegbar    |

Die Implementierung verwendet eine **JSON-Flat-File-Persistenz** in
`crewai/data/state.json` mit Runs, Cases und Konfiguration in einer einzigen
Datei. Details und URL-Cross-Run-Deduplikation siehe
`WORKFLOW_ARCHITECTURE.md`.

---

## 9. Guardrails & Fehlerbehandlung

### 9.1 Systemweite Guardrails

| Guardrail                   | Implementierung                                          | Zweck                |
|---                          |---                                                       |---                   |
| Halluzinations-Schutz       | Energy Expert Agent als Pflicht-Validierung              | Fachliche Korrektheit |
| Sequenz-Erzwingung          | System Prompt Coordinator ("IMMER zuerst...")            | Prozesstreue         |
| Output-Validation           | Pydantic-Schema in jedem Agent                           | Strukturkonsistenz   |
| Noise-Filter                | Assessment Agent (streng: im Zweifel = Noise)            | Signal-Qualität      |
| Keine Eskalation ohne Signal| Coordinator-Logik ("NUR WENN valide Signal")             | Ressourceneffizienz  |
| LLM-Ausfall-Fallback        | Heuristik-basierte Klassifikation als zweite Schicht     | Robustheit           |

### 9.2 Bekannte Limitierungen

- **LLM-Kontextfenster:** Bei sehr vielen Kandidaten (>15) kann der Kontext
  überschritten werden → Kandidaten-Limit im Scanning Agent-Prompt gesetzt
- **JSON-Robustheit:** LLMs geben gelegentlich Markdown-Code-Blöcke statt
  reines JSON zurück → Parser extrahiert JSON regex-basiert und fällt im
  Fehlerfall auf Heuristik zurück
- **Quellen-Verfügbarkeit:** RSS-Feeds können temporär ausfallen → DuckDuckGo
  als zweite Suchschiene; bei vollständigem Ausfall greift ein Static-
  Fallback-Quellenset

---

## 10. Human-in-the-Loop & Audit Layer

Die modulare Agenten-Architektur wird durch eine **Review- und Audit-Schicht**
zwischen Validierung und Szenario-Integration ergänzt.

### 10.1 Position im Prozess

```
Trigger
  ↓
Coordinator
  ↓
Scanning Agent
  ↓
Assessment Agent
  ↓
Energy Expert Agent
  ↓
HITL Gate (Regelprüfung)
  ├─ keine awaiting_review-Cases: direkt weiter zu Scenario Agent
  └─ awaiting_review-Cases vorhanden: Workflow pausiert
                ↓
              Human Review (approve / correct / reject pro Case)
                ↓
              Resume-Trigger
                ↓
              Scenario Agent läuft mit validierten + human-bestätigten Signalen
```

### 10.2 HITL-Eskalationsregeln

Ein Case landet im `awaiting_review`-Status wenn:

- `is_signal == true` und `confidence < 0.72` und Domain-Check (Energy Expert)
  bestanden — also: relevant aber unsicher

Fälle mit hoher Confidence (≥ 0.72) gehen automatisch nach `validated`.
Domain-rejected Cases gehen direkt nach `rejected`, ohne Human Review.

### 10.3 Standardisiertes Evidence-Objekt

Jeder entscheidungsrelevante Schritt erzeugt ein prüfbares Objekt mit allen
Feldern, die für Audit und Reproduzierbarkeit nötig sind: case_id, run_id,
step_id, agent_name, input/output, reasoning fields (claim, evidence,
counterpoints, uncertainty, confidence, policy_checks) und Quellen.

### 10.4 Audit Logging

Je Schritt persistiert: `run_id`, `case_id`, `step_id`, `agent_name`,
`timestamp`, `review_status`, `reviewer`, `review_comment`, `decision_diff`.
Damit sind Entscheidungen reproduzierbar, diffbar und für Nachweise
auswertbar.

### 10.5 KPIs für Qualität und Governance

- Correction Rate pro Agent
- False-Positive-Rate im Weak-Signal-Filter
- Time-to-Decision im HITL
- Agreement Rate zwischen Agent und Human

---

## Anhang: PESTEL-Suchbegriffe

Aus Anhang 1 der Seminararbeit – für den Scanning Agent:

| Kategorie         | Suchbegriffe                                                            | Quellen                          |
|---                |---                                                                       |---                               |
| **P** Political   | EEG-Novelle, Kapazitätsmarkt Konsultation, H2-Importstrategie, Embargo  | BMWK, DG Energy                  |
| **E** Economic    | Merit-Order-Spread, Netzentgelte, CO2-Preis Prognose, LCOE Solar        | SMARD.de, EEX                    |
| **S** Social      | Bürgerenergie Akzeptanz, Energiearmut, Wärmepumpen-Check, Prosumer Trend| BDEW, Sonnenseite                |
| **T** Technological| Solid State Battery, AEM Electrolyzer, V2G Standardisierung, AI-Grid   | arXiv, IEA, Energy-Charts        |
| **En** Environmental| Dürreperiode Kraftwerkskühlung, Kritische Rohstoffe, Methan-Emissionen | EEA, DWD Open Data               |
| **L** Legal       | RED III Umsetzung, EnWG-Novelle, Netzausbaubeschleunigungsgesetz        | EUR-Lex, Bundesgesetzblatt       |

---

*Dokumentation auf Basis der Seminararbeit „AI-Driven Foresight" (Gruppe 11, DHBW Stuttgart, Februar 2026). Implementations-Architektur in `WORKFLOW_ARCHITECTURE.md`.*
