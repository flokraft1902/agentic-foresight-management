# Workflow Console (Next.js)

Separate frontend for the CrewAI foresight backend.

## Features

- Edit and save search terms
- Start full foresight workflow from UI
- Transparent step timeline (scanning, assessment, validation, scenario)
- Review and correct signal vs noise decisions
- Inspect evidence and source references per case

## Start

```powershell
cd "c:\Foresight Management\agentic-foresight-management\ui\workflow-console"
npm install
npm run dev
```

UI: http://localhost:3001 (or next free port)

## Environment

Create `.env.local`:

```bash
CREWAI_BACKEND_URL=http://127.0.0.1:8000
```

The frontend uses server-side API routes as proxy to the Python backend.
