# CrewAI Foresight Backend

This backend implements a multi-agent foresight workflow in Python with CrewAI.

## Features

- Coordinator-like workflow with explicit steps
- Agents for scanning, assessment, expert validation, and scenario synthesis
- Transparent run timeline with step-by-step details
- Editable search terms configuration
- Signal vs noise cases that can be reviewed and corrected
- Evidence and source references persisted per case

## Start

```powershell
cd "c:\Foresight Management\crewai"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API docs: http://127.0.0.1:8000/docs

## Main Endpoints

- `GET /health`
- `GET /config/search-terms`
- `PUT /config/search-terms`
- `POST /workflow/start`
- `GET /workflow/{run_id}`
- `GET /cases?run_id=...`
- `GET /cases/{case_id}`
- `PUT /cases/{case_id}/review`

## Notes

- If no API key is configured, the app still runs with deterministic fallback heuristics.
- CrewAI summaries are injected into each workflow step when `GEMINI_API_KEY` and `GEMINI_MODEL` are configured.
