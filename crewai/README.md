# CrewAI Foresight Backend

FastAPI-Backend für einen Multi-Agent-Foresight-Workflow. Es scannt Energie-News
über RSS und DuckDuckGo (mit Site-restricted Queries für deutsche Quellen), lässt
ein LLM (via LiteLLM/OpenRouter/Gemini) jeden Case in Signal vs Noise
klassifizieren, validiert die Cases per LLM-Energy-Expert gegen die Energiedomäne
(Merit-Order, Missing-Money, Zieldreieck §1 EnWG) und streamt pro Stage eine
zusammenfassende Analyse zurück in die Workflow-Console-UI.

## Features

- **Pipeline mit vier Stages**: `scanning → assessment → energy_expert_validation
  → scenario_integration`
- **Hybrid-Scanning**: 4 kuratierte RSS-Feeds (Clean Energy Wire, Energy Monitor,
  Climate Change News, Renewable Energy World) + **DuckDuckGo Site-restricted
  Suche** für deutsche Quellen (BMWK, BNetzA, Bundestag, Agora, Fraunhofer ISE,
  DENA, IEA, Tagesschau, Handelsblatt, Heise, PV Magazine, Energie&Management);
  synthetischer Fallback wenn alle Feeds offline sind.
- **LLM-gestützte Klassifikation pro Case**: liefert `is_signal`, `confidence`,
  `ansoff_level (1-4)`, `pestel_category (P|E|S|T|En|L)`,
  `zieldreieck_dimensions` und `rationale`. Heuristik dient nur als Fallback.
- **LLM-Energy-Expert**: zweite domänenspezifische LLM-Bewertung pro Case
  (Merit-Order, Missing-Money, Kannibalisierung, Netzphysik) — liefert
  `is_valid`, `systemic_impact (HOCH|MITTEL|GERING)`, `time_horizon` und einen
  Detail-Text pro Zieldreieck-Dimension. Domain-rejected Cases überschreiben den
  Validation-Status auf `rejected`.
- **HITL-Pause**: Workflow stoppt nach dem Expert-Step automatisch, sobald
  Cases mit mittlerer Confidence im Status `awaiting_review` existieren. Per
  `POST /workflow/{run_id}/resume` läuft der Scenario-Step weiter, sobald alle
  Cases manuell entschieden sind.
- **Streaming-Zusammenfassungen** pro Stage via LiteLLM-Streaming. Token werden
  während der Generation in `step.detail` geschrieben, die UI sieht das beim
  Polling live.
- **Asynchrone Run-Ausführung** in einem Hintergrund-Thread; `POST
  /workflow/start` kehrt sofort zurück, der Client pollt `GET
  /workflow/{run_id}` alle 1.5 s.
- **Live-Progress** in Assessment und Expert-Stage: Fortschrittsbalken
  (`progress.classified/total` bzw. `progress.validated/total`) plus LLM-vs-
  Heuristik-Counter werden alle 3 Cases auf Disk geschrieben.
- **Run History** persistent in `data/state.json`; per `DELETE
  /workflow[?force=true]` reset­bar.
- **Editierbare Suchbegriffe** und ein strategischer Fokus pro Run.
- **Human-Review** von Signal/Noise pro Case mit Quellenangaben und
  Korrekturmöglichkeit.

## Start

### Einmaliges Setup (nur beim ersten Mal)

```bash
cd /path/to/crewai
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Achtung: ueberschreibt vorhandene .env! Nur einmal beim Setup ausfuehren.
# Danach den API-Key in .env eintragen, ggf. LLM_MODEL anpassen
```

### Backend starten (taeglich)

```bash
cd /path/to/crewai
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API-Docs: http://127.0.0.1:8000/docs

## Endpoints

### Workflow

- `POST /workflow/start` — Run starten (returnt sofort, läuft async im Hintergrund)
- `GET /workflow` — Run-Historie (sortiert nach `created_at` desc, ohne `steps`-Details)
- `GET /workflow/{run_id}` — vollständiger Run inkl. aller Stages und Cases
- `POST /workflow/{run_id}/resume` — HITL-pausierten Run nach dem Review fortsetzen.
  409 wenn nicht im Status `awaiting_review`; 400 wenn noch Cases pending sind.
- `DELETE /workflow[?force=true]` — Run-Historie zurücksetzen. 409, wenn ein Run im
  Status `running` existiert; mit `?force=true` werden auch verwaiste Runs gelöscht.

### Cases

- `GET /cases?run_id=…` — Cases auflisten (optional gefiltert)
- `GET /cases/{case_id}` — Einzel-Case
- `PUT /cases/{case_id}/review` — Human-Review speichern. Setzt
  `validation_status` entschieden: `is_signal=true → validated`,
  `is_signal=false → rejected`.

### Konfiguration

- `GET /config/search-terms` — Aktuelle Suchbegriffe
- `PUT /config/search-terms` — Suchbegriffe überschreiben

### Health

- `GET /health` — Service-Lifecheck
- `GET /llm/health` — sendet einen Mini-Prompt an's LLM; meldet `live` / `no_api_key` /
  `litellm_missing` / `probe_failed` mit Detail-Text

## Architektur

- **`app/sources.py`** — RSS-Feeds via `feedparser` + `httpx`, DuckDuckGo
  Site-restricted Suche via `ddgs`, mit deterministischem synthetischem
  Fallback wenn beide Pfade leer ausgehen.
- **`app/crew_layer.py`** — Wrapper um LiteLLM:
  - `probe_llm()` → schneller Connectivity-Check
  - `classify_case(…)` → strukturierter JSON-Prompt mit PESTEL + Zieldreieck,
    robustes Parsing über `_extract_json` und Heuristik-Fallback
  - `validate_case_expert(…)` → LLM-Energy-Expert mit Energiedomänen-Framework
    im Prompt (Merit-Order, Missing-Money, Zieldreieck), JSON-Output mit
    `is_valid`/`systemic_impact`/`time_horizon`/`zieldreieck_impact`
  - `summarize_stage(…, on_chunk)` → Streaming-Aufruf, Callback erhält
    akkumulierte Tokens
- **`app/workflow.py`** — `prepare_run()` legt den Run-Eintrag an,
  `execute_run()` durchläuft Scanning + Assessment + Expert; bei Cases im
  Status `awaiting_review` setzt es `run.status = "awaiting_review"` und
  **stoppt** vor dem Scenario-Step. `resume_run(run_id)` setzt nach dem
  Human-Review im Scenario-Step fort. `_run_scenario_step(run, cases)` wird
  von beiden Pfaden geteilt.
- **`app/data_store.py`** — flat-file JSON store (`data/state.json`); `list_runs`,
  `clear_history`, `has_active_run` für die History-Funktionen.
- **`app/main.py`** — FastAPI-Routen; `POST /workflow/start` und `POST
  /workflow/{run_id}/resume` spawnen jeweils einen `daemon` Thread.

## Notes

- Wenn kein API-Key gesetzt ist oder das Quota voll ist, läuft die Pipeline
  durch, aber Klassifikation und Expert-Validation fallen jeweils auf
  Heuristiken zurück (Schwellwerte und deterministische Texte). Das System ist
  damit nie vollständig blockiert.
- LLM-Calls werden via [LiteLLM](https://docs.litellm.ai) abgestrahlt — jeder
  LiteLLM-kompatible Provider funktioniert durch Anpassen von `LLM_MODEL` und
  passendem Key. Beispiele:
  - `openrouter/google/gemini-2.5-flash-lite` (OpenRouter, gut für Streaming)
  - `gemini/gemini-2.5-flash-lite` (Google AI Studio direkt, eigener Key nötig)
  - `openrouter/meta-llama/llama-3.3-70b-instruct:free` (alternatives Free-Tier-Modell)
- OpenRouter-Free-Tier hat ein Tageslimit von ~50 Requests Account-weit. Bei
  einem typischen Workflow-Run schlucken Klassifikation + Expert + 4 Summaries
  schnell 20-30 Calls — Quota im Auge behalten.
- Daten liegen in `data/state.json`. Diese Datei wird bei jedem Step-Update neu
  geschrieben — für Dev/Single-User OK; für Produktion wäre SQLite sinnvoller.
