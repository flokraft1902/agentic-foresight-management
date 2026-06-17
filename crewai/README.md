# CrewAI Foresight Backend

FastAPI-Backend für einen Multi-Agent-Foresight-Workflow. Es scannt Energie-News
über RSS, lässt ein LLM (via LiteLLM/OpenRouter/Gemini) jeden Case in Signal vs
Noise klassifizieren und streamt pro Stage eine zusammenfassende Analyse zurück
in die Workflow-Console-UI.

## Features

- Pipeline mit vier Stages: `scanning → assessment → energy_expert_validation → scenario_integration`
- **RSS-basiertes Scanning** mit kuratierten Feeds (Clean Energy Wire, Energy Monitor,
  Climate Change News, Renewable Energy World); fällt automatisch auf synthetische
  Quellen zurück, wenn alle Feeds offline sind.
- **LLM-gestützte Klassifikation** pro Case: `is_signal`, `confidence`, `ansoff_level`
  und `rationale` werden vom LLM erzeugt; Heuristik dient nur als Fallback.
- **Streaming-Zusammenfassungen** pro Stage via LiteLLM-Streaming; Token werden
  während der Generation in `step.detail` geschrieben, UI poll-aktualisiert live.
- **Asynchrone Run-Ausführung** in einem Hintergrund-Thread; `POST /workflow/start`
  kehrt sofort zurück, der Client pollt `GET /workflow/{run_id}`.
- **Run History** persistent in `data/state.json`; per `DELETE /workflow` resetbar.
- **Editierbare Suchbegriffe** und ein strategischer Fokus pro Run.
- **Human-Review** von Signal/Noise pro Case mit Quellenangaben und Korrekturmöglichkeit.

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
- `DELETE /workflow[?force=true]` — Run-Historie zurücksetzen. 409, wenn ein Run im
  Status `running` existiert; mit `?force=true` werden auch verwaiste Runs gelöscht.

### Cases

- `GET /cases?run_id=…` — Cases auflisten (optional gefiltert)
- `GET /cases/{case_id}` — Einzel-Case
- `PUT /cases/{case_id}/review` — Human-Review speichern (Signal/Noise korrigieren, Kommentar)

### Konfiguration

- `GET /config/search-terms` — Aktuelle Suchbegriffe
- `PUT /config/search-terms` — Suchbegriffe überschreiben

### Health

- `GET /health` — Service-Lifecheck
- `GET /llm/health` — sendet einen Mini-Prompt an's LLM; meldet `live` / `no_api_key` /
  `litellm_missing` / `probe_failed` mit Detail-Text

## Architektur

- **`app/sources.py`** — RSS-Feeds via `feedparser` + `httpx`, mit deterministischem
  synthetischem Fallback.
- **`app/crew_layer.py`** — Wrapper um LiteLLM:
  - `probe_llm()` → schneller Connectivity-Check
  - `classify_case(…)` → strukturierter JSON-Prompt, robust mit `_extract_json`
    und Heuristik-Fallback
  - `summarize_stage(…, on_chunk)` → Streaming-Aufruf, callback erhält akkumulierte Tokens
- **`app/workflow.py`** — `prepare_run()` legt den Run-Eintrag an, `execute_run()`
  durchläuft die vier Stages, schreibt nach jeder Klassifikation und jedem Token-Batch
  via `upsert_run(state.json)`.
- **`app/data_store.py`** — flat-file JSON store (`data/state.json`); `list_runs`,
  `clear_history`, `has_active_run` für die History-Funktionen.
- **`app/main.py`** — FastAPI-Routen; `POST /workflow/start` spawnt einen `daemon` Thread.

## Notes

- Wenn kein API-Key gesetzt ist, läuft die Pipeline durch, aber jede Stage nutzt nur
  die Heuristik-Fallbacks (Klassifikation und Summary sind dann deterministisch).
- LLM-Calls werden via [LiteLLM](https://docs.litellm.ai) abgestrahlt — jeder
  LiteLLM-kompatible Provider funktioniert durch Anpassen von `LLM_MODEL` und passendem
  Key. Beispiele:
  - `openrouter/google/gemini-2.5-flash-lite` (OpenRouter, gut für Streaming)
  - `gemini/gemini-2.5-flash-lite` (Google AI Studio direkt, eigener Key nötig)
  - `openrouter/meta-llama/llama-3.3-70b-instruct:free` (alternatives Free-Tier-Modell)
- Bei OpenRouter haben Free-Tier-Modelle ein Tageslimit von ~50 Requests, Account-weit.
  Bei Überschreitung fällt die Pipeline graceful auf Heuristiken zurück.
- Daten liegen in `data/state.json`. Diese Datei wird bei jedem Step-Update neu
  geschrieben — für Dev/Single-User OK; für Produktion wäre SQLite sinnvoller.
