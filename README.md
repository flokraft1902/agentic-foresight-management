# agentic-foresight-management

Integrationsseminar DHBW Stuttgart, Gruppe 11.

Multi-Agenten-Foresight-System für das automatisierte Erkennen von Weak Signals
in der Energieökonomik mit Human-in-the-Loop-Review.

## Repository-Struktur

Das Projekt hat **zwei parallele Implementationen** derselben Architektur — den
gleichen Workflow (Scanning → Assessment → Energy Expert → Scenario Integration),
einmal als n8n-Orchestrierung, einmal als Python/CrewAI-Backend:

```
.
├── n8n/                          n8n-Workflow-Exporte (JSON)
│   ├── coordinator-agent         Main-Workflow mit Schedule-Trigger
│   ├── scanning-agent            Sub-Workflows pro Stage
│   ├── assessment-agent
│   ├── energy-expert-agent
│   ├── scenario-agent
│   └── hitl-review-callback      Human-in-the-Loop-Callback
│
├── crewai/                       Python/FastAPI-Backend (aktive Entwicklung)
│   ├── app/                      FastAPI + Workflow-Implementierung
│   ├── data/                     state.json (JSON-Store)
│   └── README.md
│
├── ui/
│   ├── workflow-console/         Next.js-UI zum CrewAI-Backend
│   │                             (Live-Timeline, KPIs, Run-History, Review)
│   └── review-console/           Standalone-Review-UI (n8n-Anbindung)
│
├── docs/
│   └── HITL_UI_Integration.md    Spezifikation HITL & Audit
│
├── MAS_Foresight_Architektur.md  Designdoc (Seminararbeit, n8n-Architektur)
├── WORKFLOW_ARCHITECTURE.md      Aktive Doku für CrewAI-Implementation
└── README.md                     (diese Datei)
```

## Schnellstart

### Variante A: CrewAI-Backend + Workflow Console (lokal, kein n8n)

Empfohlen für Entwicklung und schnelles Iterieren.

**1) Backend starten:**

```bash
cd crewai
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Key in .env eintragen (LLM_API_KEY), ggf. LLM_MODEL anpassen
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**2) UI starten:**

```bash
cd ui/workflow-console
npm install
npm run dev
```

UI: http://localhost:3000 — Backend-Docs: http://127.0.0.1:8000/docs

Details: `crewai/README.md` und `ui/workflow-console/README.md`.

### Variante B: n8n-Workflows (self-hosted)

Originaler Entwurf aus der Seminararbeit. Verwendet Gemini Pro / GPT-4o via
n8n-Nodes, SerpAPI/Tavily für Web Search, optional Airtable als Persistenz.

**n8n lokal mit Docker** (Rancher Desktop unter Windows):

```powershell
docker run -it --rm `
  --name n8n `
  -p 5678:5678 `
  -e GENERIC_TIMEZONE="Europe/Berlin" `
  -e TZ="Europe/Berlin" `
  -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true `
  -e N8N_RUNNERS_ENABLED=true `
  -v n8n_data:/home/node/.n8n `
  docker.n8n.io/n8nio/n8n
```

n8n: http://localhost:5678

Die sechs Workflow-Dateien aus `n8n/` per "Import from file" in die UI laden
(Reihenfolge egal). Workflow-IDs in den `toolWorkflow`-Nodes müssen nach dem
Import auf die neu vergebenen IDs aktualisiert werden — Detail im
`MAS_Foresight_Architektur.md`, Abschnitt 13.

## Dedizierte Review-UIs

Zwei Frontends im Repo, beide Next.js:

- **`ui/workflow-console`** — primäres UI zum CrewAI-Backend. Live-Timeline,
  KPI-Tiles, Run-History, Streaming der LLM-Antworten, Signal/Noise-Review.
- **`ui/review-console`** — Standalone-Oberfläche für die n8n-Variante
  (HITL-Queue, Audit-Trail). Beschreibung in `docs/HITL_UI_Integration.md`.

## Architektur in Kürze

Beide Implementationen folgen demselben Coordinator-Worker-Delegator-Modell aus
der Seminararbeit:

```
Coordinator
   ├── Scanning Agent        (Environmental Scanning, PESTEL)
   ├── Assessment Agent      (Ansoff Weak-Signal-Klassifikation)
   ├── Energy Expert Agent   (Domänen-Validierung, Hallucination-Guard)
   └── Scenario Agent        (Strategic Alert, Szenario-Trichter)
```

Vollständige Spezifikation mit System-Prompts, Datenstrukturen und
Schnittstellen: `MAS_Foresight_Architektur.md`.

Implementations-Architektur des CrewAI-Backends (Endpoints, Datenfluss,
Streaming, Polling): `WORKFLOW_ARCHITECTURE.md`.

## Hosting-Optionen

| Track | Selbst gehostet | Kosten |
|---|---|---|
| CrewAI-Backend | uvicorn (lokal oder Container) | Compute + LLM-API |
| n8n | Docker (lokal) oder n8n.cloud | ca. 5 €/Monat self-hosted |
| LLM | OpenRouter / Google AI Studio / Anthropic | Pay-per-token |

LLM-Keys aus Gemini-Pro- oder Claude-Abos können wiederverwendet werden.
Agenten/Workflows sollen als Code in diesem Repository persistiert bleiben.

## Autoren

Gruppe 11, DHBW Stuttgart: Florian Kraft, Nandor Varga, Thorben Ries, Felix Bayer.
