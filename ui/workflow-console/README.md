# Workflow Console (Next.js)

Frontend für das CrewAI Foresight Backend. Schlanke UI, die alle vier Stages des
Multi-Agent-Workflows live darstellt, Scanning, Assessment, Expert Validation,
Scenario Integration, inklusive Streaming der LLM-Antworten, HITL-Review und
strukturierter Case-Filterung.

## Features

- **Sticky LLM-Status-Pill** in der Topbar: zeigt live an, ob das Backend
  Gemini/OpenRouter erreichen kann (`LLM live` / `Fallback`), inklusive Modellname.
- **Konfiguration**: Suchbegriffe (kommagetrennt) und strategischer Fokus pro Run.
- **Run-Übersicht** mit vier KPI-Tiles (Cases, Signale, Noise, validiert) plus
  Run-ID, Startzeit und Fokus.
- **HITL-Banner**: erscheint warnfarben sobald der Workflow für menschlichen
  Review pausiert; zeigt die Anzahl pendender Cases und einen
  „Workflow fortsetzen“-Button, der erst klickbar wird, wenn alle Cases
  entschieden sind.
- **Run History** als Karten-Grid: Klick auf einen früheren Run lädt ihn als
  aktuelle Ansicht; `Reset` löscht die History (mit Force-Option für verwaiste Runs).
- **Workflow-Schritte** als Timeline mit farbigem Status-Dot pro Step:
  - Pulsierender Dot während `running`
  - Streaming-Pille + blinkender Cursor, solange das LLM Tokens generiert
  - Progress-Bar plus LLM- vs Heuristik-Counter in der Assessment- **und**
    Energy-Expert-Stage (Klassifizierung bzw. Validierung); Expert zeigt
    zusätzlich „Validiert · N · Review nötig · Rejected · Domain-rejected“
  - Klappbare Rohdetails (JSON) pro Step
- **Signal/Noise-Review** mit Filter-Leiste:
  - Filter-Chips mit Counts: `Alle · Review nötig · Validiert · Rejected`
  - Der „Review nötig“-Chip pulsiert warnfarben, sobald Count > 0 ist
  - Free-Text-Search über Title, Begründung, Keyword und Expert-Comment
  - Sortierung: `awaiting_review` zuerst, dann nach Confidence desc
- **Case-Karten** mit prominenter Hervorhebung der pending Cases:
  - Warn-farbiger Rahmen + „Review nötig“-Badge an Cases mit
    `validation_status === "awaiting_review"`
  - **PESTEL-Pille** (P/E/S/T/En/L) und **Zieldreieck-Tag-Reihe**
    (Wirtschaftlichkeit / Versorgungssicherheit / Umweltverträglichkeit)
  - **Energy-Expert-Block** mit `plausibel`/`unplausibel` Pille, `Impact: HOCH/
    MITTEL/GERING`, Time-Horizon und klappbarem Zieldreieck-Impact-Detail (eine
    Zeile pro Dimension mit dem konkreten Folgentext vom LLM)
  - Quellenliste mit Trust-Score
  - Korrektur-Formular (Klassifikation, Kommentar, Titel/Begründung überschreiben)

## Setup

Einmaliges Setup:

```bash
cd ui/workflow-console
npm install
```

## Start

```bash
cd ui/workflow-console
npm run dev
```

UI: http://localhost:3000 (Next.js Default-Port; bei belegtem Port wählt Next
automatisch den nächsten freien).

Voraussetzung: das CrewAI-Backend läuft parallel unter `http://127.0.0.1:8000`
(siehe `crewai/README.md`).

## Konfiguration

Standardmäßig wird der Backend-Port aus dem Code gelesen. Für einen abweichenden
Backend-Host kann eine `.env.local` angelegt werden:

```bash
CREWAI_BACKEND_URL=http://127.0.0.1:8000
```

Die UI ruft das Backend **nicht direkt** auf, sondern über Next.js-Server-Routes
unter `app/api/...` als Proxy. Vorteile: CORS bleibt unkritisch, der Backend-Host
kann pro Deployment via Env-Var umgestellt werden, und Secrets bleiben auf dem
Server.

## Architektur

```
app/
├── layout.tsx                          # Root-Layout
├── page.tsx                            # Single-Page-Console (alle Sektionen)
├── globals.css                         # Design-Tokens, Pills, Timeline, Filter, Banner
└── api/                                # Next.js Route Handlers (Proxy zum Backend)
    ├── config/search-terms             # GET/PUT
    ├── workflow                        # GET (list) | DELETE (reset, ?force=true)
    ├── workflow/start                  # POST
    ├── workflow/[runId]                # GET
    ├── workflow/[runId]/resume         # POST (HITL Resume)
    ├── cases/[caseId]                  # GET
    ├── cases/[caseId]/review           # PUT
    └── llm-health                      # GET

lib/
├── backend.ts                          # backendFetch() Helper
└── types.ts                            # SignalCase, WorkflowRun, RunSummary, PestelCategory, ...
```

## Live-Updates

Sobald der User auf **Workflow starten** klickt:

1. UI POST `/api/workflow/start` → Backend legt den Run an, gibt sofort die `run_id`
   zurück und führt die Pipeline in einem Daemon-Thread aus.
2. UI startet einen 1.5-s-Polling-Loop auf `/api/workflow/{run_id}`.
3. Jedes Polling aktualisiert Steps, Cases, KPI-Tiles, Progress-Bars und die
   Streaming-Pille.
4. Alle ~6 s (jeder 4. Tick) wird die Run-History-Liste mitaktualisiert.
5. Wenn der Status auf `awaiting_review` wechselt: Polling stoppt, das
   HITL-Banner erscheint, der `Review nötig`-Filter-Chip pulsiert. Der User
   klickt sich durch die Cases (über Signal/Noise + Speichern) — sobald alle
   pending Cases entschieden sind, ist „Workflow fortsetzen“ klickbar.
6. POST `/api/workflow/{runId}/resume` startet den Scenario-Step im Hintergrund.
7. Polling läuft wieder bis `completed` oder `failed`. LLM-Health wird einmal
   neu geprüft.

## Build

```bash
npm run build
npm start
```
