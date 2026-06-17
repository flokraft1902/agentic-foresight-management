# Workflow Console (Next.js)

Frontend für das CrewAI Foresight Backend. Schlanke UI, die alle vier Stages des
Multi-Agent-Workflows live darstellt, Scanning, Assessment, Expert Validation,
Scenario Integration, inklusive Streaming der LLM-Antworten und Human-Review der
Cases.

## Features

- **Sticky LLM-Status-Pill** in der Topbar: zeigt live an, ob das Backend
  Gemini/OpenRouter erreichen kann (`LLM live` / `Fallback`), inklusive Modellname.
- **Konfiguration**: Suchbegriffe (kommagetrennt) und strategischer Fokus pro Run.
- **Run-Übersicht** mit vier KPI-Tiles (Cases, Signale, Noise, validiert) plus
  Run-ID, Startzeit und Fokus.
- **Run History** als Karten-Grid: Klick auf einen früheren Run lädt ihn als
  aktuelle Ansicht; `Reset` löscht die History (mit Force-Option für verwaiste Runs).
- **Workflow-Schritte** als Timeline mit farbigem Status-Dot pro Step:
  - Pulsierender Dot während `running`
  - Streaming-Pille + blinkender Cursor, solange das LLM Tokens generiert
  - Progress-Bar in der Assessment-Stage (klassifiziert / total) plus
    LLM- vs Heuristik-Counter
  - Klappbare Rohdetails (JSON) pro Step
- **Signal/Noise-Review**: Cases als Karten mit Quellenliste, Confidence,
  Ansoff-Level, Validation-Status und Korrektur-Formular (Klassifikation,
  Kommentar, Titel/Begründung überschreiben).

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
├── layout.tsx              # Root-Layout
├── page.tsx                # Single-Page-Console (alle Sektionen)
├── globals.css             # Design-Tokens, Pills, Timeline-CSS
└── api/                    # Next.js Route Handlers (Proxy zum Backend)
    ├── config/search-terms # GET/PUT
    ├── workflow            # GET (list) | DELETE (reset)
    ├── workflow/start      # POST
    ├── workflow/[runId]    # GET
    ├── cases/[caseId]      # GET
    ├── cases/[caseId]/review # PUT
    └── llm-health          # GET

lib/
├── backend.ts              # backendFetch() Helper
└── types.ts                # SignalCase, WorkflowRun, RunSummary, ...
```

## Live-Updates

Sobald der User auf **Workflow starten** klickt:

1. UI POST `/api/workflow/start` → Backend legt den Run an, gibt sofort die `run_id`
   zurück und führt die Pipeline in einem Daemon-Thread aus.
2. UI startet einen 1.5-s-Polling-Loop auf `/api/workflow/{run_id}`.
3. Jedes Polling aktualisiert Steps, Cases, KPI-Tiles und die Streaming-Pille.
4. Alle ~6 s (jeder 4. Tick) wird die Run-History-Liste mitaktualisiert.
5. Sobald der Status auf `completed` oder `failed` wechselt, stoppt das Polling
   automatisch und der LLM-Health-Status wird einmal neu geprüft.

## Build

```bash
npm run build
npm start
```
