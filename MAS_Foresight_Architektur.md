# AI-Driven Foresight: Multi-Agenten-System in n8n
## Architektur-Dokumentation & System Prompts

**Projekt:** Integrationsseminar – DHBW Stuttgart, Gruppe 11  
**Autoren:** Florian Kraft, Nandor Varga, Thorben Ries, Felix Bayer  
**Version:** 1.0 | Stand: Juni 2025  

---

> **Hinweis zur Implementation:** Dieses Dokument beschreibt die ursprüngliche
> n8n-basierte Architektur aus der Seminararbeit. Parallel dazu existiert im
> Repository eine zweite Implementation derselben Architektur als
> Python/FastAPI-Backend mit Next.js-UI:
>
> - `crewai/` — FastAPI-Backend. Implementiert die unten beschriebenen vier
>   Stages konkret als:
>   - **Scanning** über kuratierte RSS-Feeds **plus** DuckDuckGo Site-restricted
>     Suche für die in §5.3 / §11.4 / Anhang 1 genannten deutschen Quellen
>     (BMWK, BNetzA, Bundestag, Agora, Fraunhofer ISE, DENA, IEA, Tagesschau,
>     Handelsblatt, Heise, PV Magazine).
>   - **Assessment** als LLM-Klassifikation pro Case, liefert `is_signal`,
>     `confidence`, `ansoff_level (1-4)`, `pestel_category` und
>     `zieldreieck_dimensions` (siehe §6.3 Ansoff-Skala und §4 Zieldreieck).
>   - **Energy Expert** als zweiter LLM-Call mit dem in §7.3 spezifizierten
>     Wissensrahmen (Merit-Order, Missing-Money, Kannibalisierung, 3D-
>     Transformation, Zieldreieck §1 EnWG); liefert `is_valid`,
>     `systemic_impact (HOCH|MITTEL|GERING)`, `time_horizon` und einen Detail-
>     Text pro Zieldreieck-Dimension.
>   - **HITL-Gate** (§14): Workflow stoppt nach dem Expert-Step bei Cases mit
>     mittlerer Confidence, wartet auf den Human-Review und setzt per
>     Resume-Endpoint im Scenario-Step fort.
>   - **Scenario** mit Streaming-Strategic-Alert.
>   - Persistenz aktuell als flat JSON-Store (entspricht §10.3 n8n Static
>     Data Approach).
> - `ui/workflow-console/` — Live-Timeline mit Progress-Bars und
>   Streaming-Cursor, Run-History, Case-Filter mit Awaiting-Highlight,
>   HITL-Banner mit Resume-Button, Human-Review mit PESTEL- und Zieldreieck-
>   Anzeige.
>
> Beide Implementationen folgen dem hier beschriebenen Coordinator-Worker-
> Delegator-Modell und denselben Stage-Definitionen. Die n8n-Workflow-Exporte
> liegen in `n8n/`, die laufende Architektur und Datenflüsse des
> CrewAI-Backends sind in `WORKFLOW_ARCHITECTURE.md` dokumentiert.

---

## Inhaltsverzeichnis

1. [Systemübersicht](#1-systemübersicht)
2. [Architekturprinzipien](#2-architekturprinzipien)
3. [Workflow-Struktur in n8n](#3-workflow-struktur-in-n8n)
4. [Coordinator Agent](#4-coordinator-agent)
5. [Scanning Agent](#5-scanning-agent)
6. [Assessment Agent](#6-assessment-agent)
7. [Energy Expert Agent](#7-energy-expert-agent)
8. [Scenario Integration Agent](#8-scenario-integration-agent)
9. [Datenfluss & Schnittstellendefinitionen](#9-datenfluss--schnittstellendefinitionen)
10. [Shared Memory & Persistenz](#10-shared-memory--persistenz)
11. [Guardrails & Fehlerbehandlung](#11-guardrails--fehlerbehandlung)
12. [n8n Konfigurationsreferenz](#12-n8n-konfigurationsreferenz)
13. [Deployment & Import/Export](#13-deployment--importexport)
14. [Human-in-the-Loop & Audit Layer](#14-human-in-the-loop--audit-layer)
15. [Dedizierte Review UI (Next.js)](#15-dedizierte-review-ui-nextjs)

---

## 1. Systemübersicht

Das **Agent-Based Foresight System** automatisiert den Generic Foresight Process (GFP) nach Voros durch ein hierarchisches Multi-Agenten-System (MAS). Es detektiert Weak Signals im Energiesektor, bewertet diese nach Ansoff und integriert sie in das Szenariomanagement nach Gausemeier.

### Systemziel

```
Unstrukturierte Datenströme (Web, APIs, Fachjournale)
        ↓
  Automatisierte Weak-Signal-Detektion
        ↓
  Domänenspezifische Validierung (Energieökonomik)
        ↓
  Strategic Alert für Entscheidungsträger
```

### Technologie-Stack

| Komponente | Technologie | Zweck |
|---|---|---|
| Orchestrierung | n8n (self-hosted / cloud) | Workflow-Engine |
| LLM | Google Gemini Pro / GPT-4o | Reasoning & Textverarbeitung |
| Web Search | SerpAPI / Tavily | Environmental Scanning |
| Persistenz | n8n Static Data / Airtable | Shared Memory / Szenario-Trichter |
| Output | E-Mail / Slack | Strategic Alerts |
| Versionierung | GitHub (.json Export) | Collaboration Gruppe 11 + 12 |

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
│   (implizit im Tool-Aufruf-Mechanismus)     │  ← Middle Level
│   Aufgabenverteilung via $fromAI()          │
└──┬──────────┬──────────┬────────────────────┘
   │          │          │ Tasks & Results
   ▼          ▼          ▼
┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
│Scan  │  │Assess│  │Energy│  │Scen. │  ← Base Level
│Agent │  │Agent │  │Expert│  │Agent │
└──────┘  └──────┘  └──────┘  └──────┘
```

### 2.2 Sense-Think-Act Mapping

| Sense-Think-Act Phase | Zugeordneter Agent | GFP-Phase |
|---|---|---|
| **Sense** | Scanning Agent | Inputs |
| **Think (Filter)** | Assessment Agent | Analysis |
| **Think (Validate)** | Energy Expert Agent | Interpretation |
| **Act** | Scenario Integration Agent | Prospection & Outputs |

### 2.3 Designprinzipien für Prompts (Best Practices)

Alle System Prompts in diesem System folgen diesen Regeln:

- **Rolle zuerst:** Wer bin ich? Was ist mein Zweck?
- **Kontext:** Warum existiere ich in diesem System?
- **Aufgabe:** Was genau soll ich tun?
- **Constraints:** Was darf ich NICHT tun? (Guardrails)
- **Output-Format:** Wie soll die Antwort strukturiert sein?
- **Beispiel:** Ein konkretes Beispiel des erwarteten Outputs

---

## 3. Workflow-Struktur in n8n

### 3.1 Übersicht aller Workflows

```
Foresight Management (Main)          ID: VdD7m3JdvZSp2W37
├── Scanning Agent (Sub-Workflow)    ID: OPs2h4Bn71SsI990
├── Assessment Agent (Sub-Workflow)  ID: 5ChTSJRdKDEsWKys
├── Energy Expert Agent (Sub-W.)     ID: zzjbcS2fWJQ9fikp
└── Scenario Agent (Sub-Workflow)    [noch anzulegen]
```

### 3.2 Trigger-Logik

```
Schedule Trigger (täglich 06:00)
        ↓
Coordinator Agent
  [entscheidet autonom welche Tools er aufruft]
        ↓
Tool: run_scanning_agent      → gibt raw_kandidaten zurück
        ↓
Tool: run_assessment_agent    → gibt weak_signals zurück
        ↓
Tool: run_energy_expert_agent → gibt validierte_signale zurück
        ↓
Tool: run_scenario_agent      → gibt strategic_alert zurück
        ↓
Output: E-Mail / Slack / Airtable
```

### 3.3 Node-Typen Übersicht

| n8n Node | Funktion | Wo eingesetzt |
|---|---|---|
| `scheduleTrigger` | Täglicher Start | Main Workflow |
| `agent` (LangChain) | LLM-Agent mit Tools | Alle Agenten |
| `toolWorkflow` | Sub-Workflow als Tool | Main → Sub-Workflows |
| `lmChatGoogleGemini` | LLM Provider | Alle Agenten |
| `memoryBufferWindow` | Kurzzeitgedächtnis | Coordinator |
| `executeWorkflowTrigger` | Eingang Sub-Workflow | Alle Sub-Workflows |
| `set` | Daten strukturieren | Output-Formatierung |
| `sendEmail` / Slack | Strategic Alert Output | Scenario Agent |

---

## 4. Coordinator Agent

### 4.1 Rolle & Verantwortung

Der Coordinator ist der einzige Agent, der direkten Kontakt zum Trigger hat. Er kennt den Gesamtprozess, verwaltet den Szenario-Trichter-Status im Memory und entscheidet, welche Agenten wann aufgerufen werden. Er entspricht dem **Top Level** im CWD-Modell.

### 4.2 n8n Konfiguration

```json
{
  "type": "@n8n/n8n-nodes-langchain.agent",
  "typeVersion": 3.1,
  "parameters": {
    "options": {
      "systemMessage": "[siehe 4.3]",
      "maxIterations": 10,
      "returnIntermediateSteps": false
    }
  }
}
```

**Verbundene Nodes:**
- `lmChatGoogleGemini` → `ai_languageModel`
- `memoryBufferWindow` → `ai_memory`
- `toolWorkflow` (Scanning) → `ai_tool`
- `toolWorkflow` (Assessment) → `ai_tool`
- `toolWorkflow` (Energy Expert) → `ai_tool`
- `toolWorkflow` (Scenario) → `ai_tool`

### 4.3 System Prompt

```
# Rolle
Du bist der Koordinations-Agent (Coordinator) eines automatisierten 
Foresight-Systems für die Energieökonomik, entwickelt von der DHBW Stuttgart 
Gruppe 11. Du stehst an der Spitze eines hierarchischen Multi-Agenten-Systems 
nach dem CWD-Modell (Coordinator-Worker-Delegator).

# Kontext
Das System dient der automatisierten Detektion von Weak Signals im Energiesektor
und deren Integration in das Szenariomanagement nach Gausemeier. Du operierst 
täglich und hast Zugriff auf spezialisierte Worker-Agenten als Tools.

# Bewertungsrahmen
Alle Aktivitäten orientieren sich am energiepolitischen Zieldreieck (§1 EnWG):
- WIRTSCHAFTLICHKEIT: Wettbewerbsfähigkeit, Merit-Order, LCOE
- VERSORGUNGSSICHERHEIT: Gesicherte Leistung, Netzstabilität, Diversifikation
- UMWELTVERTRÄGLICHKEIT: Dekarbonisierung, Treibhausgasreduktion, Nachhaltigkeit

# Prozess (strikt einzuhalten)
Führe IMMER die folgenden Schritte in dieser Reihenfolge aus:

SCHRITT 1 – SCANNING:
Rufe run_scanning_agent auf. Übergib:
- suchbegriffe: Array mit 8-12 konkreten PESTEL-Suchbegriffen aus dem 
  aktuellen Energiekontext (siehe Fokusthemen unten)
- fokus: Einen präzisen Satz zum strategischen Fokus des heutigen Scans

SCHRITT 2 – ASSESSMENT:
Übergib ALLE Rohdaten aus Schritt 1 an run_assessment_agent.
Überspringe diesen Schritt NICHT, auch wenn die Rohdaten unvollständig wirken.

SCHRITT 3 – VALIDIERUNG:
Übergib NUR die bestätigten Weak Signals (signal: true) aus Schritt 2 
an run_energy_expert_agent. 
Wenn Schritt 2 keine Signale liefert: Stoppe hier und berichte "Keine 
Weak Signals detektiert am [Datum]."

SCHRITT 4 – SZENARIO-INTEGRATION:
Rufe run_scenario_agent NUR auf, wenn Schritt 3 mindestens ein valides 
Signal (valide: true) geliefert hat.

# Fokusthemen (täglich zu scannen)
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

### 4.4 Memory-Konfiguration

```json
{
  "type": "@n8n/n8n-nodes-langchain.memoryBufferWindow",
  "parameters": {
    "sessionKey": "foresight-coordinator-{{ $now.format('yyyy-MM-dd') }}",
    "contextWindowLength": 10
  }
}
```

> **Hinweis:** Das Window Memory ist für den täglichen Scan ausreichend. Für persistente Szenario-Speicherung → Airtable verwenden (siehe Abschnitt 10).

---

## 5. Scanning Agent

### 5.1 Rolle & Verantwortung

Der Scanning Agent ist der erste Worker. Er implementiert das **Environmental Scanning** aus dem GFP (Phase: Inputs). Seine Aufgabe ist maximale Scan-Breite ohne Bewertung – er sammelt Rohdaten entlang der PESTEL-Dimensionen und gibt sie unbewertet weiter.

### 5.2 Tool-Definition im Coordinator

```json
{
  "name": "run_scanning_agent",
  "description": "Searches web and energy data sources for potential weak signals. 
Use this tool FIRST. 
Input: suchbegriffe (string, JSON array of search terms), fokus (string).
Output: Raw signal candidates with source, summary, pestel_kategorie."
}
```

**Übergabedaten ($fromAI):**

| Feld | Typ | Beschreibung |
|---|---|---|
| `suchbegriffe` | string (JSON Array) | PESTEL-Suchbegriffe, z.B. `["EEG-Novelle", "Solid State Battery"]` |
| `fokus` | string | Strategischer Fokus des Scans |

### 5.3 Sub-Workflow Aufbau

```
Execute Workflow Trigger
        ↓
Set Node ("Input parsen")
  → suchbegriffe = {{ JSON.parse($json.suchbegriffe) }}
        ↓
SerpAPI / Tavily Tool (Web Search)
  [mehrfach aufgerufen für jeden Suchbegriff]
        ↓
AI Agent Node ("Scanning Agent LLM")
  [strukturiert die Suchergebnisse]
        ↓
Set Node ("Output formatieren")
  → kandidaten = [{ text, quelle, pestel_kategorie, datum }]
```

### 5.4 System Prompt

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
   - P = Political (Politik, Regulierung, Geopolitik)
   - E = Economic (Märkte, Preise, Kapitalkosten)
   - S = Social (Akzeptanz, Konsumverhalten, Gerechtigkeit)
   - T = Technological (Innovationen, Effizienzsprünge, Patente)
   - En = Environmental (Klimawandel, Ressourcen, physische Risiken)
   - L = Legal (Rechtsprechung, Normen, Genehmigungen)

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

# Beispiel-Output (ein Kandidat)
{
  "id": "c001",
  "text": "Forscher der TU München berichten über einen Durchbruch bei 
           Feststoffbatterien mit einer Energiedichte von 500 Wh/kg bei 
           Produktionskosten unter 80 EUR/kWh – bisher galt 100 EUR/kWh 
           als Schwelle für Netzparität.",
  "quelle": "arXiv:2401.12345 / TU München Pressemitteilung",
  "pestel_kategorie": "T",
  "datum_fund": "2025-06-01",
  "suchbegriff": "Solid State Battery Kosten Durchbruch"
}
```

---

## 6. Assessment Agent

### 6.1 Rolle & Verantwortung

Der Assessment Agent implementiert die **Analysis-Phase** des GFP. Er ist der kritische Filter zwischen Rohdaten und strategischer Relevanz. Er klassifiziert jeden Kandidaten auf der Ansoff Weak-Signal-Skala (Level 1–5) und trennt Weak Signals von Noise und bereits bekannten Trends.

### 6.2 Tool-Definition im Coordinator

```json
{
  "name": "run_assessment_agent",
  "description": "Filters raw candidates and classifies on Ansoff scale (1-5).
Use AFTER run_scanning_agent.
Input: kandidaten (string, JSON array with text, quelle, pestel_kategorie).
Output: Filtered weak signals with ansoff_level, signal boolean, begruendung."
}
```

**Übergabedaten ($fromAI):**

| Feld | Typ | Beschreibung |
|---|---|---|
| `kandidaten` | string (JSON Array) | Rohdaten vom Scanning Agent |

### 6.3 Ansoff Weak-Signal-Skala (Referenz)

| Level | Bezeichnung | Beschreibung | Handlung |
|---|---|---|---|
| 1 | Sense of Threat | Nur vages Gefühl, dass sich etwas verändert | Beobachten |
| 2 | Source Known | Quelle bekannt, Natur der Bedrohung unklar | Scannen |
| 3 | Threat Characterized | Bedrohung konkret, Reaktionsmöglichkeiten unklar | Analysieren |
| 4 | Response Known | Reaktionsmöglichkeiten bekannt, Zeitpunkt unklar | Planen |
| 5 | Full Information | Vollständiges Bild, hohe Informationsdichte | = Trend, kein Weak Signal mehr |

> **Weak Signals = Level 1–3.** Level 4–5 sind bereits Trends oder bekannte Entwicklungen.

### 6.4 System Prompt

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

## 7. Energy Expert Agent

### 7.1 Rolle & Verantwortung

Der Energy Expert Agent ist der **Halluzinations-Guard** des Systems. Er implementiert die Interpretation-Phase des GFP und prüft jedes bestätigte Weak Signal gegen physikalische und ökonomische Realität der Energiewirtschaft. Er ist die domänenspezifische Validierungsinstanz.

### 7.2 Tool-Definition im Coordinator

```json
{
  "name": "run_energy_expert_agent",
  "description": "Validates weak signals against energy economics domain knowledge.
Prevents hallucinations via Merit-Order logic and energy policy triangle.
Use AFTER run_assessment_agent, only with confirmed signals.
Input: signale (string, JSON array with text, ansoff_level, pestel_kategorie).
Output: Validated signals with zieldreieck_impact and valide boolean."
}
```

**Übergabedaten ($fromAI):**

| Feld | Typ | Beschreibung |
|---|---|---|
| `signale` | string (JSON Array) | Bestätigte Weak Signals vom Assessment Agent |

### 7.3 Energieökonomisches Wissens-Framework (Referenz für den Agenten)

**Merit-Order-Prinzip:** Kraftwerke werden nach aufsteigenden Grenzkosten eingesetzt. Der Grenzkraftwerkspreis gilt für alle Anbieter. Erneuerbare mit Grenzkosten ≈ 0 verdrängen fossile Anlagen → sinkende Spotpreise.

**Kannibalisierungseffekt:** Mit zunehmendem EE-Anteil sinkt der technologiespezifische Marktwert von Wind/Solar, weil hohe Einspeisung mit niedrigen Preisen korreliert.

**Missing Money Problem:** Konventionelle Backup-Kraftwerke können in Energy-Only-Märkten ihre Fixkosten nicht mehr decken, da Knappheitspreise durch EE-Ausbau seltener werden → Investitionsdefizit bei gesicherter Leistung.

**3D-Transformation:** Dekarbonisierung + Dezentralisierung + Digitalisierung als gleichzeitig wirkende Megatrends mit gegenseitigen Wechselwirkungen.

### 7.4 System Prompt

```
# Rolle
Du bist der Energy Expert Agent – die domänenspezifische Validierungsinstanz 
eines Foresight-Systems. Du besitzt tiefes Fachwissen in Energieökonomik und 
deine Aufgabe ist die Plausibilitätsprüfung von Weak Signals gegen bekannte 
physikalische und ökonomische Gesetzmäßigkeiten der Energiewirtschaft.

# Kontext
Du bist die letzte Qualitätssicherungsstufe vor der Szenario-Integration.
Du verhindert, dass KI-Halluzinationen oder fachlich inkorrekte Bewertungen 
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

## 8. Scenario Integration Agent

### 8.1 Rolle & Verantwortung

Der Scenario Integration Agent implementiert die **Prospection & Outputs-Phase** des GFP. Er verarbeitet validierte Weak Signals, aktualisiert den Szenario-Trichter nach Gausemeier und generiert den Strategic Alert für Entscheidungsträger.

### 8.2 Tool-Definition im Coordinator

```json
{
  "name": "run_scenario_agent",
  "description": "Integrates validated signals into scenario funnel and generates 
Strategic Alert for decision makers.
Use ONLY when run_energy_expert_agent returned at least one valide: true signal.
Input: validierte_signale (string, JSON array), aktueller_trichter (string).
Output: Updated scenario assessment and Strategic Alert text."
}
```

**Übergabedaten ($fromAI):**

| Feld | Typ | Beschreibung |
|---|---|---|
| `validierte_signale` | string (JSON Array) | Validierte Signale vom Energy Expert |
| `aktueller_trichter` | string | Aktueller Szenario-Trichter-Status |

### 8.3 Szenario-Framework (Referenz)

**Szenario-Trichter nach Gausemeier:**
- Jedes Weak Signal kann den Trichter **weiten** (mehr Unsicherheit) oder **verengen** (ein Szenario wird wahrscheinlicher)
- Extremszenario A: **"Autarke Dezentralität"** – Prosumer, Mikronetze, dezentrale Speicher dominieren
- Extremszenario B: **"Zentraler Netzausbau"** – Großkraftwerke, europäisches Supergrid, Wasserstoff-Import
- Trendszenario: **"Hybride Transformation"** – gradueller Umbau, Mix beider Extreme

### 8.4 System Prompt

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

## 9. Datenfluss & Schnittstellendefinitionen

### 9.1 Vollständiger Datenfluss

```
TRIGGER
  └─► Coordinator erhält: { datum, fokus_override? }

SCHRITT 1: Scanning
  Coordinator → Scanning Agent
  Input:  { suchbegriffe: string[], fokus: string }
  Output: { scan_datum, kandidaten: Kandidat[], anzahl_kandidaten, fehler }

SCHRITT 2: Assessment
  Coordinator → Assessment Agent
  Input:  { kandidaten: Kandidat[] }  ← aus Schritt 1
  Output: { assessment_datum, weak_signals: Signal[], noise: [], anzahl_weak_signals }

SCHRITT 3: Energy Expert
  Coordinator → Energy Expert Agent
  Input:  { signale: Signal[] }  ← nur signal:true aus Schritt 2
  Output: { validierung_datum, validierte_signale: ValidSignal[], abgelehnte_signale: [] }

SCHRITT 4: Scenario Agent
  Coordinator → Scenario Agent
  Input:  { validierte_signale: ValidSignal[], aktueller_trichter: string }
  Output: { scan_datum, szenario_update, signal_mapping, strategic_alert }
```

### 9.2 Datentypen

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

---

## 10. Shared Memory & Persistenz

### 10.1 Memory-Strategie

| Zweck | Lösung | Lebensdauer |
|---|---|---|
| Coordinator-Konversation | n8n Window Buffer Memory | 1 Tag (täglicher Scan) |
| Historische Weak Signals | Airtable / Google Sheets | Dauerhaft |
| Szenario-Trichter-Status | Airtable | Dauerhaft, manuell pflegbar |
| Fehler-Log | n8n Execution History | 30 Tage |

### 10.2 Airtable Schema (Empfehlung)

**Tabelle: `weak_signals`**

| Feld | Typ | Beschreibung |
|---|---|---|
| `signal_id` | Text | Eindeutige ID (c001, ...) |
| `scan_datum` | Date | Datum der Entdeckung |
| `text` | Long Text | Signal-Beschreibung |
| `quelle` | URL | Quellenlink |
| `pestel_kategorie` | Single Select | P/E/S/T/En/L |
| `ansoff_level` | Number | 1-3 |
| `zieldreieck` | Multi Select | Wirtschaftlichkeit/Versorgungssicherheit/Umwelt |
| `systemischer_impakt` | Single Select | HOCH/MITTEL/GERING |
| `szenario_indikator` | Single Select | A/B/C |
| `status` | Single Select | Neu/Bestätigt/Abgeklungen/Mainstream |

**Tabelle: `szenario_trichter`**

| Feld | Typ | Beschreibung |
|---|---|---|
| `datum` | Date | Update-Datum |
| `szenario_a_prob` | Number | Wahrscheinlichkeit % |
| `szenario_b_prob` | Number | Wahrscheinlichkeit % |
| `szenario_c_prob` | Number | Wahrscheinlichkeit % |
| `kommentar` | Long Text | Begründung der Verschiebung |

### 10.3 n8n Static Data (Alternative für schnelle Prototypen)

Im Coordinator Agent kann Static Data per Code Node gespeichert werden:

```javascript
// Lesen
const trichter = $getWorkflowStaticData('global').szenario_trichter 
  || { a: 33, b: 33, c: 34 };

// Schreiben (nach Scenario Agent Output)
$getWorkflowStaticData('global').szenario_trichter = {
  a: trichter.a + 5,
  b: trichter.b - 3,
  c: trichter.c - 2,
  letzte_aktualisierung: new Date().toISOString()
};
```

---

## 11. Guardrails & Fehlerbehandlung

### 11.1 Systemweite Guardrails

| Guardrail | Implementierung | Zweck |
|---|---|---|
| Halluzinations-Schutz | Energy Expert Agent als Pflicht-Validierung | Fachliche Korrektheit |
| Sequenz-Erzwingung | System Prompt Coordinator ("IMMER zuerst...") | Prozesstreue |
| Output-Validation | JSON-Schema in jedem Agent | Strukturkonsistenz |
| Noise-Filter | Assessment Agent (streng: im Zweifel = Noise) | Signal-Qualität |
| Keine Eskalation ohne Signal | Coordinator-Logik ("NUR WENN valide Signal") | Ressourceneffizienz |

### 11.2 Fehlerbehandlung in n8n

In jedem Sub-Workflow sollte ein **Error Trigger** konfiguriert sein:

```
Settings → Error Workflow → [Fehler-Logging-Workflow]
```

Empfohlene Fehler-Behandlung im Coordinator System Prompt:
```
Wenn ein Tool einen Fehler zurückgibt:
1. Dokumentiere den Fehler mit Zeitstempel
2. Versuche das Tool EINMAL erneut
3. Wenn erneut Fehler: Stoppe den Prozess
4. Sende Fehler-Report: { fehler: true, tool: "...", nachricht: "..." }
```

### 11.3 Bekannte Limitierungen

- **LLM-Kontextfenster:** Bei sehr vielen Kandidaten (>15) kann der Kontext überschritten werden → Kandidaten-Limit im Scanning Agent-Prompt gesetzt
- **$fromAI() mit Arrays:** n8n übergibt Arrays als JSON-String → alle Agents müssen `JSON.parse()` auf eingehende Arrays anwenden
- **Gemini JSON-Output:** Gemini gibt manchmal Markdown-Code-Blöcke zurück → Im Set Node: `{{ $json.output.replace(/```json|```/g, '').trim() }}`

---

## 12. n8n Konfigurationsreferenz

### 12.1 Session ID (Memory)

```
// Im memoryBufferWindow Node → Session ID:
{{ $workflow.id }}-{{ $now.format('yyyy-MM-dd') }}
```

### 12.2 $fromAI() Syntax

```javascript
// Grundform
"={{ $fromAI('feldname', 'Beschreibung für das LLM', 'string') }}"

// Mit Default
"={{ $fromAI('ansoff_level', 'Signal maturity level 1-5', 'number') }}"
```

### 12.3 JSON-Parsing im Sub-Workflow (Set Node)

```javascript
// Wenn kandidaten als String ankommt:
{{ JSON.parse($json.kandidaten) }}

// Mit Fehlerbehandlung:
{{ 
  (() => {
    try { return JSON.parse($json.kandidaten) }
    catch(e) { return [] }
  })()
}}
```

### 12.4 Gemini Markdown-Stripping

```javascript
// Im Set Node nach dem Agent:
{{ $json.output.replace(/```json\n?|\n?```/g, '').trim() }}
```

---

## 13. Deployment & Import/Export

### 13.1 Workflow Export

```
Workflow öffnen → ⋮ (Menü oben rechts) → "Download" → .json
```

Alle 5 Workflows separat exportieren und in Git versionieren:

```
/foresight-mas/
├── workflows/
│   ├── 01_foresight_management_main.json
│   ├── 02_scanning_agent.json
│   ├── 03_assessment_agent.json
│   ├── 04_energy_expert_agent.json
│   └── 05_scenario_agent.json
└── docs/
    └── MAS_Foresight_Architektur.md   ← diese Datei
```

### 13.2 Import auf neuer Instanz

```
n8n öffnen → "+ New Workflow" → ⋮ → "Import from file"
```

> **Wichtig:** Nach dem Import müssen Workflow-IDs in den `toolWorkflow`-Nodes 
> aktualisiert werden, da n8n auf der neuen Instanz neue IDs vergibt.

### 13.3 Collaboration mit Gruppe 12

Gruppe 12 (Szenariomanagement & Dashboarding) kann den Output des Scenario Agent direkt übernehmen. Empfohlene Schnittstelle:

```json
// Gruppe 11 → Gruppe 12 (via Airtable oder Webhook)
{
  "scan_datum": "2025-06-04",
  "validierte_signale": [...],
  "szenario_update": {...},
  "strategic_alert": {...}
}
```

Webhook-Trigger in Gruppe 12s Dashboard-Workflow:
```
POST /webhook/[gruppe12-webhook-id]
Content-Type: application/json
Body: [strategic_alert JSON]
```

---

## 14. Human-in-the-Loop & Audit Layer

Die bestehende modulare Agenten-Architektur bleibt unverändert. Ergänzt wird eine
zusätzliche **Review- und Audit-Schicht** zwischen Validierung und Szenario-Integration.

### 14.1 Position im bestehenden Prozess

```
Schedule Trigger
    ↓
Coordinator
    ↓
run_scanning_agent
    ↓
run_assessment_agent
    ↓
run_energy_expert_agent
    ↓
HITL Gate (Regelprüfung)
    ├─ false: direkt weiter zu run_scenario_agent
    └─ true: Übergabe an Review UI (Intake)
              ↓
            Human Entscheidung (approve/correct/reject)
              ↓
            Callback an n8n
              ├─ approve/correct: run_scenario_agent
              └─ reject: Prozess stoppen + Report
```

### 14.2 HITL-Eskalationsregeln (empfohlen)

Ein Fall geht verpflichtend in den Human-Review, wenn mindestens eine Regel erfüllt ist:

- `confidence < 0.70`
- `uncertainty = high`
- Quellenkonflikt erkannt (`source_conflict = true`)
- `systemischer_impakt = HOCH`

### 14.3 Standardisiertes Evidence-Objekt

Jeder entscheidungsrelevante Schritt erzeugt ein prüfbares Objekt:

```json
{
  "caseId": "case_2026_06_10_001",
  "runId": "run_2026_06_10",
  "stepId": "energy_validation",
  "agentName": "Energy Expert Agent",
  "callbackUrl": "http://localhost:5678/webhook/review-decision-callback",
  "payload": {
    "input_hash": "...",
    "output_hash": "..."
  },
  "decision": {
    "signal": true,
    "ansoff_level": 2,
    "valide": true
  },
  "reasoningFields": {
    "claim": "Signal deutet auf strukturellen Kostenshift hin",
    "evidence": ["https://..."],
    "counterpoints": ["Pilotdaten evtl. nicht uebertragbar"],
    "uncertainty": "medium",
    "confidence": 0.74,
    "policy_checks": {
      "source_quality_passed": true,
      "mainstream_check_passed": true
    }
  },
  "sources": [
    {
      "title": "Quelle 1",
      "url": "https://...",
      "trustScore": 0.82
    }
  ]
}
```

### 14.4 Audit Logging

Folgende Felder werden je Schritt persistiert:

- `run_id`, `case_id`, `step_id`, `agent_name`, `timestamp`
- `input_hash`, `output_hash`, `review_status`, `reviewer`
- `review_comment`, `decision_diff`

Damit sind Entscheidungen reproduzierbar, diffbar und für Nachweise auswertbar.

---

## 15. Dedizierte Review UI (Next.js)

Für die Human-in-the-Loop-Freigabe wird eine dedizierte Oberfläche bereitgestellt:

- Pfad im Repository: `ui/review-console`
- Zweck: Review Queue, Detailansicht, Approve/Correct/Reject, Audit Trail
- Integration via API mit n8n

### 15.1 API-Vertrag

**n8n -> UI**

- `POST /api/n8n/intake`
  - Legt einen Review-Fall mit Evidence-Objekt an

**UI -> n8n**

- `POST /api/review/decision`
  - Speichert Human-Entscheidung
  - Sendet optional Callback an n8n (`callbackUrl` oder Default-URL)

### 15.2 n8n-Node-Empfehlung im Coordinator-Flow

Nach `run_energy_expert_agent`:

1. `Set` Node: Evidence-Objekt bauen
2. `IF` Node: HITL-Regelprüfung
3. Bei HITL=true: `HTTP Request` an Review UI Intake
4. `Wait for Webhook`: auf Review Callback warten
5. `IF reviewStatus`: approve/correct/reject verzweigen

### 15.3 KPI für Qualität und Governance

- Correction Rate pro Agent
- False-Positive-Rate im Weak-Signal-Filter
- Time-to-Decision im HITL
- Agreement Rate zwischen Agent und Human

---

## Anhang: Schnell-Referenz PESTEL-Suchbegriffe

Aus Anhang 1 der Seminararbeit – für den Scanning Agent:

| Kategorie | Suchbegriffe | Quellen |
|---|---|---|
| **P** Political | EEG-Novelle, Kapazitätsmarkt Konsultation, H2-Importstrategie, Embargo | BMWK, DG Energy |
| **E** Economic | Merit-Order-Spread, Netzentgelte, CO2-Preis Prognose, LCOE Solar | SMARD.de, EEX |
| **S** Social | Bürgerenergie Akzeptanz, Energiearmut, Wärmepumpen-Check, Prosumer Trend | BDEW, Sonnenseite |
| **T** Technological | Solid State Battery, AEM Electrolyzer, V2G Standardisierung, AI-Grid-Optimization | arXiv, IEA, Energy-Charts |
| **En** Environmental | Dürreperiode Kraftwerkskühlung, Kritische Rohstoffe, Methan-Emissionen | EEA, DWD Open Data |
| **L** Legal | RED III Umsetzung, EnWG-Novelle, Netzausbaubeschleunigungsgesetz | EUR-Lex, Bundesgesetzblatt |

---

*Dokumentation erstellt auf Basis der Seminararbeit „AI-Driven Foresight" (Gruppe 11, DHBW Stuttgart, Februar 2026)*
