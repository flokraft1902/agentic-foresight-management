# HITL + Audit Integration fuer bestehende n8n Architektur

Diese Integration behaelt die bestehende modulare Architektur bei:

- Coordinator Agent
- Scanning Agent
- Assessment Agent
- Energy Expert Agent
- Scenario Agent

## 1. Zielbild

- Jeder Agent-Schritt erzeugt ein pruefbares Evidence-Objekt
- Kritische Entscheidungen laufen durch Human-in-the-Loop (HITL)
- Review-UI (Next.js) dient als dedizierte Freigabeoberflaeche
- Entscheidungen werden als Audit-Trail versioniert gespeichert

## 2. Einfuegepunkt im bestehenden Prozess

Empfohlener HITL-Gate vor Scenario Agent:

1. `run_scanning_agent`
2. `run_assessment_agent`
3. `run_energy_expert_agent`
4. `IF` (HITL-Regel)
5. `HTTP Request` -> `POST /api/n8n/intake` (Review Console)
6. `Wait for Webhook` (Review Callback)
7. `IF reviewStatus` -> approve/correct/reject
8. Bei approve/correct -> `run_scenario_agent`
9. Bei reject -> Abbruch + Report

## 3. HITL-Regeln (Beispiel)

HITL ist verpflichtend wenn mindestens eine Bedingung zutrifft:

- `reasoningFields.confidence < 0.70`
- `reasoningFields.uncertainty == "high"`
- Quellenkonflikt erkannt
- `systemischer_impakt == "HOCH"`

## 4. Evidence-Objekt (n8n -> UI)

```json
{
  "caseId": "case_...",
  "runId": "run_...",
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
    "claim": "...",
    "evidence": ["..."],
    "counterpoints": ["..."],
    "uncertainty": "medium",
    "confidence": 0.74,
    "policy_checks": {
      "source_quality_passed": true,
      "mainstream_check_passed": true
    }
  },
  "sources": [
    {
      "title": "...",
      "url": "https://...",
      "trustScore": 0.82
    }
  ]
}
```

## 5. Review Callback (UI -> n8n)

Die Review Console sendet nach menschlicher Entscheidung:

```json
{
  "caseId": "case_...",
  "runId": "run_...",
  "stepId": "energy_validation",
  "reviewStatus": "approved",
  "reviewer": "human.reviewer",
  "reviewComment": "...",
  "decision": {
    "signal": true,
    "ansoff_level": 2,
    "valide": true
  },
  "updatedAt": "2026-06-10T09:15:00.000Z"
}
```

## 6. KPI fuer Qualitaetssteuerung

- Correction Rate pro Agent
- False-Positive-Rate im Weak-Signal-Filter
- Time-to-Decision im HITL
- Agreement Rate Agent vs Human

## 7. Betriebshinweis

Die aktuelle UI speichert Daten dateibasiert als Prototyp.
Fuer Team-Betrieb und Parallelitaet auf Postgres/Airtable migrieren.
