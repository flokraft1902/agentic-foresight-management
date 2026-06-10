# Foresight Review Console (Next.js)

Dedizierte Human-in-the-Loop UI fuer das Agentic-Foresight-System.

## Ziel

- Review-Faelle aus n8n entgegennehmen
- Entscheidungen transparent machen (Reasoning Fields)
- HITL-Entscheidungen erfassen: approve, correct, reject
- Audit-Events persistent loggen
- Entscheidung per Callback an n8n zurueckgeben

## Start

```bash
cd ui/review-console
npm install
npm run dev
```

UI: http://localhost:3000

## Umgebungsvariablen

Lege optional eine `.env.local` an:

```bash
REVIEW_CONSOLE_BASE_URL=http://localhost:3000
N8N_REVIEW_CALLBACK_URL=http://localhost:5678/webhook/review-decision-callback
```

## API Endpunkte

- `POST /api/n8n/intake`
  - legt einen neuen Review-Fall an
- `GET /api/cases`
  - listet alle Faelle
- `GET /api/cases/:id`
  - liefert einen Fall
- `POST /api/review/decision`
  - speichert Human-Entscheidung und sendet optional Callback

## Beispiel Intake Payload (von n8n)

```json
{
  "caseId": "case_run2026_06_10_001",
  "runId": "run_2026_06_10",
  "stepId": "energy_validation",
  "agentName": "Energy Expert Agent",
  "callbackUrl": "http://localhost:5678/webhook/review-decision-callback",
  "payload": {
    "raw_input_hash": "abc123",
    "output_hash": "def456"
  },
  "decision": {
    "signal": true,
    "ansoff_level": 2,
    "valide": true
  },
  "reasoningFields": {
    "claim": "Signal deutet auf strukturellen Kostenshift hin",
    "evidence": [
      "https://example.org/source1"
    ],
    "counterpoints": [
      "Pilotdaten eventuell nicht uebertragbar"
    ],
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
      "url": "https://example.org/source1",
      "trustScore": 0.8
    }
  ]
}
```

## Datenhaltung

Dateibasiert fuer den Prototypen:

- `data/review-cases.json`
- `data/audit-log.json`

Fuer Produktion: Postgres/Airtable anbinden (gleiche Strukturen).
