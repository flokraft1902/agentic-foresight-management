# agentic-foresight-management

Integrationsseminar DHBW Stuttgart, Gruppe 11.

Multi-Agenten-Foresight-System für das automatisierte Erkennen energiewirtschaftlicher
Weak Signals mit Human-in-the-Loop-Review.

## Repository-Struktur

```
.
├── crewai/                      Python/FastAPI-Backend
│   ├── app/                       LiteLLM-basierte Multi-Agent-Pipeline
│   │                              Scanning → Assessment → Energy Expert
│   │                              → (HITL) → Scenario Integration
│   ├── data/                      JSON-Flat-File-Store (state.json)
│   └── README.md                  Setup + Start
│
├── ui/
│   └── workflow-console/        Next.js-15-Frontend (TypeScript, App-Router)
│       ├── app/                   Page + API-Proxy-Routes
│       ├── components/            Section-Komponenten (Topbar, Charts, …)
│       ├── lib/                   Helpers (Labels, useTooltip, exportReport, …)
│       └── README.md              Setup + Start
│
├── MAS_Foresight_Architektur.md Methodisch-konzeptionelle Spezifikation
│                                  (System Prompts, Ansoff, Zieldreieck,
│                                  energiewirtschaftliches Wissens-Framework)
├── WORKFLOW_ARCHITECTURE.md     Implementations-Architektur des Backends
│                                  (Endpoints, Datenfluss, Streaming, Polling)
└── README.md                    Diese Datei
```

## Schnellstart

**1) Backend starten:**

```bash
cd crewai
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# In .env eintragen: LLM_API_KEY (OpenRouter / Google AI Studio / Anthropic)
# und ggf. LLM_MODEL anpassen (Default: openrouter/nex-agi/nex-n2-pro:free)
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**2) UI starten (zweites Terminal):**

```bash
cd ui/workflow-console
npm install
npm run dev
```

- UI: <http://localhost:3000>
- Backend-OpenAPI-Docs: <http://127.0.0.1:8000/docs>

Setup-Details: [`crewai/README.md`](crewai/README.md) und
[`ui/workflow-console/README.md`](ui/workflow-console/README.md).

## Architektur in Kürze

Coordinator-Worker-Delegator-Modell mit vier sequentiellen Stages und einem
optionalen Human-in-the-Loop-Gate:

```
┌─ Scanning Agent          Environmental Scanning · RSS + DuckDuckGo
│                          → SourceItems (Title, Snippet, URL, Trust-Score)
│
├─ Assessment Agent        Signal/Noise + PESTEL + Ansoff Weak-Signal-Skala
│                          + Zieldreieck-Tags · LLM mit Heuristik-Fallback
│
├─ Energy Expert Agent     Domain-Check: Merit-Order, Missing-Money,
│                          Kannibalisierung, Netzphysik. Outputs systemic
│                          impact, time horizon, Zieldreieck-Wirkung.
│
│  ─── HITL Gate ─────────  Cases mit Confidence < 0.72 landen in
│                          `awaiting_review`. Workflow pausiert bis
│                          alle Cases approved/rejected sind.
│
└─ Scenario Integration    Strategic Alerts aus den validierten Cases,
                           plus Auto-Suggestion für nächste Suchbegriffe.
```

Vollständige Methodologie (System Prompts, Ansoff-Skala, energiewirtschaftliches
Wissens-Framework, Szenario-Trichter): [`MAS_Foresight_Architektur.md`](MAS_Foresight_Architektur.md).

Implementations-Architektur (FastAPI-Endpoints, LiteLLM-Streaming, 750-ms-Polling,
Persistenz, Frontend-Komponenten): [`WORKFLOW_ARCHITECTURE.md`](WORKFLOW_ARCHITECTURE.md).

## Highlight-Features der Workflow Console

- **Live-Timeline** mit Streaming der LLM-Stage-Summaries (Markdown-gerendert
  mit blinkendem Caret) und Echtzeit-Fortschrittsanzeigen für Assessment und
  Expert
- **Analyse-Dashboard** mit vier Charts: PESTEL-Verteilung, Ansoff Weak-Signal-Level,
  systemischer Impact (Donut), Zieldreieck-Coverage
- **Trend-Chart** über alle abgeschlossenen Runs (Cases / Signale / Validiert)
- **Run-History** mit Reset + Cross-Run-URL-Dedup (Quellen aus früheren Runs
  werden als wiederkehrend markiert)
- **HITL-Banner** mit Resume-Button, sobald der Energy Expert unsichere Cases
  ans Human-Review delegiert
- **Signal/Noise-Review** mit Filter-Chips, Volltext-Suche, Detail-Modal,
  Korrektur-Form und instant Tooltips auf jedem Badge
- **Auto-Suggestion** der nächsten Suchbegriffe (LLM analysiert validierte
  Cases und schlägt verwandte Themen vor — als Chips zum Annehmen)
- **Drei Export-Formate**: CSV (Reports), JSON (Übergabe an Gruppe 12),
  PDF Foresight Report (Präsentation, Verteidigung)

## Tech-Stack

| Bereich  | Technologie |
|---|---|
| Backend  | Python 3.11, FastAPI, Pydantic v2 |
| LLM      | LiteLLM (Provider-agnostisch — Default `openrouter/nex-agi/nex-n2-pro:free`, jedes LiteLLM-Modell konfigurierbar) |
| Quellen  | feedparser (RSS), `ddgs` (DuckDuckGo Site-Search) |
| Persistenz | JSON-Flat-File (`crewai/data/state.json`) |
| Frontend | Next.js 15 (App-Router), TypeScript, React 19 |
| Charts   | Native SVG, kein Chart-Framework |
| PDF      | jsPDF (client-side) |

## Hosting

Komplett selbst gehostet. Backend (`uvicorn`) und UI (`next dev`) laufen lokal.
LLM-Calls gehen direkt vom Backend an den konfigurierten Provider — keine
zusätzliche Cloud-Komponente nötig. Variable Kosten ausschließlich für
LLM-Tokens (typisch wenige Cents pro Run).

## Autoren

Gruppe 11, DHBW Stuttgart: Florian Kraft, Nandor Varga, Thorben Ries, Felix Bayer.
