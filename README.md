# agentic-foresight-management
Integrationsseminar DHBW

## Architekturstatus

- Modulare n8n Multi-Agent-Architektur bleibt erhalten (Coordinator + 4 Sub-Workflows).
- Ergänzt um Human-in-the-Loop, Audit-Layer und dedizierte Review UI.

## Neu: Dedizierte Review UI (Next.js)

Pfad: `ui/review-console`

Zweck:

- Review-Fälle aus n8n entgegennehmen
- Entscheidungen transparent machen (Reasoning Fields)
- Menschliche Entscheidung erfassen: approve/correct/reject
- Audit-Events speichern und an n8n zurückmelden

Start lokal:

```bash
cd ui/review-console
npm install
npm run dev
```

Weitere Details: `docs/HITL_UI_Integration.md`

Aktueller Plan: 

n8n self hosted, Kosten ca. 5€ pro Monat
-> Präg fragen ob Deployment teil der Anforderungen

zuerst lokal testen, API Tokens aus Gemini Pro oder Claude Abo

Agenten/Workflows als Code speichern und hier in Github persistieren

n8n lokales Setup:

Auf windows braucht ihr zunächst Rancher Desktop, wenn das gestartet ist: 
https://docs.n8n.io/hosting/installation/docker/#starting-n8n

docker run -it --rm `
>>   --name n8n `
>>   -p 5678:5678 `
>>   -e GENERIC_TIMEZONE="Europe/Berlin" `
>>   -e TZ="Europe/Berlin" `
>>   -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true `
>>   -e N8N_RUNNERS_ENABLED=true `
>>   -v n8n_data:/home/node/.n8n `
>>   docker.n8n.io/n8nio/n8n
