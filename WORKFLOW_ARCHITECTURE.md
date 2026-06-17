# CrewAI Foresight Workflow — Architektur & Datenfluss

Aktualisiert nach Umstellung auf RSS-basiertes Scanning, LLM-Klassifikation,
Streaming-Summaries und asynchronem Run mit Polling.

## System-Übersicht

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FORESIGHT WORKFLOW SYSTEM                            │
│                      (CrewAI Backend + Next.js Frontend)                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Frontend ↔ Backend Interaktionen

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                      WORKFLOW CONSOLE FRONTEND                            ║
║                    (Next.js, Port 3000, Browser)                          ║
╚═══════════════════════════════════════════════════════════════════════════╝

   ┌──────────────────────────┐
   │  LLM-Status-Pill         │ ◄─────────── GET /api/llm-health
   │  (Live "LLM live" /      │
   │   "Fallback")            │
   └──────────────────────────┘

   ┌──────────────────────────┐
   │  Konfiguration           │ ─────┬──────► PUT /api/config/search-terms
   │  Begriffe + Fokus        │      │
   └──────────────────────────┘      │  JSON: { search_terms: [] }
                                      │
   ┌──────────────────────────┐      │
   │  Workflow starten        │ ─────┤──────► POST /api/workflow/start
   │  (returnt sofort)        │      │  JSON: { search_terms, focus }
   └──────────────────────────┘      │
                                      │
   ┌──────────────────────────┐      │
   │  Run-Übersicht (KPIs)    │ ◄────┤──────── GET /api/workflow/{run_id}
   │  Timeline (live)         │      │      (Poll alle 1.5s)
   │  Streaming-Cursor        │      │
   └──────────────────────────┘      │
                                      │
   ┌──────────────────────────┐      │
   │  Run History             │ ◄────┤──────── GET /api/workflow?limit=15
   │  (klickbare Karten)      │      │
   │                          │ ─────┘──────► DELETE /api/workflow[?force=true]
   └──────────────────────────┘
                                      
   ┌──────────────────────────┐
   │  Signal/Noise Cases      │ ──────────► PUT /api/cases/{case_id}/review
   │  (mit Quellen + Review)  │       JSON: { is_signal, comment, ... }
   └──────────────────────────┘
```

Alle UI-Calls gehen über Next.js Server-Routes als Proxy zu FastAPI (Port 8000).

---

## CrewAI Backend — Workflow Pipeline

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                      CREWAI BACKEND ORCHESTRATION                         ║
║                   (Python/FastAPI, Port 8000, Uvicorn)                    ║
╚═══════════════════════════════════════════════════════════════════════════╝

         POST /workflow/start  ───►  prepare_run()  ──►  threading.Thread
                                          │                    │
                                          │ returns run_id     │ runs async
                                          ▼                    ▼
                                   ┌─────────────┐      execute_run(run)
                                   │ Client polls│             │
                                   │ /workflow/  │             │
                                   │  {run_id}   │             │
                                   └─────────────┘             │
                                                               ▼
        ┌────────────────────────────────────────────────────────┐
        │          STEP 1: SCANNING                              │
        │  ┌────────────────────────────────────────────────┐   │
        │  │ • search_sources(terms)                        │   │
        │  │   - Live-Fetch von 4 RSS-Feeds (httpx +        │   │
        │  │     feedparser): Clean Energy Wire, Energy     │   │
        │  │     Monitor, Climate Change News, REW          │   │
        │  │   - Filter: Suchbegriff im Title/Summary       │   │
        │  │   - Sort: published_at desc, cap 4/Term        │   │
        │  │   - Fallback: synthetische Items wenn 0 hits   │   │
        │  │ • summarize_stage() streamt Markdown-Summary   │   │
        │  │                                                │   │
        │  │ Output: List[{keyword, source: SourceItem}]    │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: scanning → done                              │
        └────────────────┬─────────────────────────────────────┘
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │          STEP 2: ASSESSMENT                            │
        │  ┌────────────────────────────────────────────────┐   │
        │  │ FOR jeden Case:                                │   │
        │  │   classify_case(term, title, snippet, focus)   │   │
        │  │     → LLM JSON-Prompt:                         │   │
        │  │        {is_signal, confidence, ansoff_level,   │   │
        │  │         rationale}                             │   │
        │  │     → Fallback: SHA-Heuristik bei Timeout/     │   │
        │  │        Parse-Error/Quota                       │   │
        │  │                                                │   │
        │  │ Live-Progress: alle 3 Cases upsert_run() mit   │   │
        │  │   progress.classified, llm_classified,         │   │
        │  │   heuristic_classified                         │   │
        │  │                                                │   │
        │  │ Output: List[SignalCase]                       │   │
        │  │   - is_signal, confidence, ansoff_level        │   │
        │  │   - rationale (vom LLM oder Heuristik)         │   │
        │  │   - validation_status: pending                 │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: assessment → done                            │
        └────────────────┬─────────────────────────────────────┘
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │       STEP 3: ENERGY EXPERT VALIDATION                 │
        │  ┌────────────────────────────────────────────────┐   │
        │  │ Schwellwert-basiert (noch heuristisch):        │   │
        │  │   IF is_signal AND confidence >= 0.72          │   │
        │  │     → validated                                │   │
        │  │   ELIF is_signal                               │   │
        │  │     → pending  (für HITL-Review vorgesehen)    │   │
        │  │   ELSE                                         │   │
        │  │     → rejected                                 │   │
        │  │                                                │   │
        │  │ summarize_stage() streamt Expert-Kommentar     │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: energy_expert_validation → done              │
        └────────────────┬─────────────────────────────────────┘
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │      STEP 4: SCENARIO INTEGRATION                      │
        │  ┌────────────────────────────────────────────────┐   │
        │  │ • Filter: validation_status == validated       │   │
        │  │ • Top 10 als strategic_alerts                  │   │
        │  │ • summarize_stage() streamt Szenario-Synthese  │   │
        │  │                                                │   │
        │  │ Output: { alert_count, alerts[] }              │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: scenario_integration → done                  │
        └────────────────┬─────────────────────────────────────┘
                         ▼
                    ┌──────────────┐
                    │ run.status = │
                    │ "completed"  │
                    │ → state.json │
                    └──────────────┘
```

---

## Streaming der LLM-Summaries

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                     LLM TOKEN STREAMING                                   ║
╚═══════════════════════════════════════════════════════════════════════════╝

summarize_stage(stage_name, objective, payload, on_chunk=emitter)
              │
              ▼
   litellm.completion(model, stream=True, ...)
              │
              ▼
   ┌──────────────────────────────┐
   │ chunk-by-chunk:              │
   │  delta = chunk.choices[0]    │
   │          .delta.content      │
   │  accumulated += delta        │
   │                              │
   │  if (now - last_emit) > 0.5s │
   │    emitter(accumulated)      │
   └──────────────┬───────────────┘
                  │
                  ▼  (callback in workflow.py)
   ┌──────────────────────────────┐
   │ step.detail.crewai = {       │
   │   enabled: true,             │
   │   summary: <partial>,        │
   │   streaming: true            │
   │ }                            │
   │ upsert_run(run)              │
   └──────────────┬───────────────┘
                  │ writes to state.json
                  ▼
   UI Polling sieht im nächsten Tick:
   • Streaming-Pille + pulsierender Dot
   • Step-Summary mit blinkendem ▍ am Ende
   • Text wächst sichtbar mit
```

---

## Datenfluss pro Schritt

```
SCANNING STEP
─────────────
Input:  search_terms[], focus

Processing:
  Fetch alle 4 RSS-Feeds parallel (httpx, 8s Timeout, User-Agent gesetzt)
  Parse via feedparser, strip HTML aus title/summary
  FOR jeden search_term:
    matches = [entry for entry in feeds if term im title+summary]
    sort by published desc, take top 4
    dedup über (term, url)
  
  Wenn 0 Hits: _fallback_sources(terms) — synthetische Items mit
               "[fallback]"-Snippet, deterministischer Trust Score

Output: SourceItem[]
  {
    "keyword": "hydrogen import germany",
    "title": "EU backs Egypt's grid expansion ...",
    "url": "https://www.energymonitor.ai/news/...",
    "snippet": "The European Union is providing financing ...",
    "published_at": "2026-06-16",
    "trust_score": 0.78
  }


ASSESSMENT STEP
───────────────
Input: scanned SourceItems[]

Processing:
  FOR jeden Case:
    heuristic_fallback = Classification(
      is_signal = (_confidence(term, src) >= 0.62),
      confidence = _confidence(term, src),
      ansoff_level = _ansoff_level(term),
      rationale = "Heuristic baseline: ...",
      source = "heuristic"
    )

    classification = classify_case(term, title, snippet, focus, ...)
      → LLM Prompt mit Output-Schema:
        '{"is_signal": bool, "confidence": 0-1,
          "ansoff_level": 1-4, "rationale": str}'
      → Robust: extract JSON via regex, fallback bei Parse/Auth/Timeout

    case = SignalCase(
      case_id, run_id, keyword, title,
      rationale = classification.rationale,
      confidence = classification.confidence,
      is_signal = classification.is_signal,
      ansoff_level = classification.ansoff_level,
      validation_status = "pending",
      sources = [source]
    )

  Alle 3 Cases: upsert_run(run) mit progress, llm_classified, heuristic_classified


EXPERT VALIDATION STEP
──────────────────────
Input: SignalCase[]

Processing:
  FOR each case:
    IF is_signal AND confidence >= 0.72:
      validation_status = "validated"
      expert_comment = "Consistent with strategic relevance ..."
    ELIF is_signal:
      validation_status = "pending"
      expert_comment = "Potential signal, requires human review ..."
    ELSE:
      validation_status = "rejected"
      expert_comment = "Classified as noise ..."

  summarize_stage streamt Markdown-Kommentar zum Step

  TODO (#3 HITL): wenn pending-Cases existieren, Workflow hier pausieren
                  bis Human-Review erfolgt ist.


SCENARIO INTEGRATION STEP
─────────────────────────
Input: SignalCase[] with validation_status == "validated"

Processing:
  strategic_alerts = top 10 validated cases
    [{case_id, title, keyword, ansoff_level, confidence, main_source}, ...]

  summarize_stage streamt Strategic Alert (Markdown)

Output: run.summary = {
  cases_total, signals, noise, validated_signals, strategic_alerts
}
```

---

## Persistenz Layer

```
data/state.json
───────────────
{
  "search_terms": ["hydrogen import germany", ...],

  "runs": [
    {
      "run_id": "run_20260617_101532_a1b2c3",
      "created_at": "2026-06-17T10:15:32Z",
      "updated_at": "2026-06-17T10:16:15Z",   // bei jedem upsert aktualisiert
      "focus": "...",
      "search_terms": [...],
      "status": "completed",                   // running | completed | failed
      "steps": [
        {
          "name": "scanning",
          "status": "done",
          "started_at": "...",
          "finished_at": "...",
          "detail": {
            "focus": "...",
            "hits": 12,
            "sample_sources": [...],
            "crewai": {
              "enabled": true,
              "summary": "## Findings\n* ...",   // finaler Text
              "streaming": false                 // true während Generation
            }
          }
        },
        {
          "name": "assessment",
          "status": "done",
          "detail": {
            "candidate_count": 12,
            "signal_count": 7,
            "noise_count": 5,
            "llm_classified": 11,                // wie viele via LLM klassifiziert
            "heuristic_classified": 1,           // wie viele auf Fallback
            "progress": { "classified": 12, "total": 12 },
            "crewai": { ... }
          }
        },
        { ... expert step ... },
        { ... scenario step ... }
      ],
      "summary": {
        "cases_total": 12,
        "signals": 7,
        "noise": 5,
        "validated_signals": 4,
        "strategic_alerts": 4
      }
    },
    { ... weitere Runs ... }
  ],

  "cases": [
    {
      "case_id": "case_abc123",
      "run_id": "run_20260617_...",
      "keyword": "hydrogen import germany",
      "title": "...",
      "rationale": "...",       // vom LLM oder vom Heuristik-Fallback
      "confidence": 0.78,
      "is_signal": true,
      "ansoff_level": 3,
      "validation_status": "validated",
      "expert_comment": "...",
      "reviewer_comment": "...",
      "reviewed_by": "frontend.reviewer",
      "reviewed_at": "...",
      "sources": [{ title, url, snippet, published_at, trust_score }]
    }
  ]
}

Schreibvorgänge:
  • Alle 3 klassifizierten Cases während Assessment
  • Alle 0.5s während LLM-Streaming (gedrosselt)
  • Bei jedem Step-Anfang/-Ende
  • Bei jedem Case-Review (PUT /cases/{id}/review)
  • Beim Reset (DELETE /workflow)
```

---

## API Endpoints Summary

```
GET /health
GET /llm/health                  Liveness-Probe mit echtem LLM-Mini-Call

GET  /config/search-terms        aktuelle Suchbegriffe
PUT  /config/search-terms        überschreiben

POST   /workflow/start           Run starten, returnt sofort (run_id)
GET    /workflow                 Run-Liste (limit Query, ohne steps-Detail)
GET    /workflow/{run_id}        vollständiger Run inkl. steps + cases
DELETE /workflow[?force=true]    Reset; 409 wenn aktive Runs, force=true
                                  überschreibt das

GET /cases?run_id=...            Cases auflisten
GET /cases/{case_id}             einzelner Case
PUT /cases/{case_id}/review      Human-Review speichern
```

---

## Fehlerbehandlung & Fallbacks

```
LLM_API_KEY fehlt / LLM nicht erreichbar / Quota überschritten
─────────────────────────────────────────────────────────────
• Scanning: läuft (RSS unabhängig vom LLM)
• Assessment: jeder Case fällt auf SHA-Heuristik zurück
              llm_classified=0, heuristic_classified=alle
• Expert: läuft (Schwellwert ist heuristisch)
• Scenario: läuft
• summarize_stage: returnt CrewSummary(used_crewai=False)
→ Pipeline läuft komplett durch, UI zeigt "LLM Fallback"-Pille pro Step

Alle RSS-Feeds offline
──────────────────────
• search_sources liefert 0 Live-Hits
• _fallback_sources erzeugt deterministische Items aus _FALLBACK_BASE_URLS
• Backend loggt "[sources] no live RSS hits — using synthetic fallback"
• UI sieht reguläre Cases, Snippets beginnen mit "[fallback]"

LLM-Streaming bricht mit Exception ab
─────────────────────────────────────
• Bisher akkumulierte Tokens werden als finaler Text zurückgegeben
• summarize_stage gibt CrewSummary(used_crewai=True, text=teil) zurück
• Wenn 0 Tokens: used_crewai=False, Fallback-Text

Run abgestürzt / uvicorn restart während Run
────────────────────────────────────────────
• Run bleibt mit status="running" in state.json
• Beim nächsten DELETE /workflow blockiert 409
• User kann ?force=true setzen (UI bietet das automatisch nach 409 an)
```

---

## Live-Updates: Polling-Sequenz

```
T=0.0s   POST /workflow/start
         → Backend: prepare_run() schreibt Run mit status=running
         → Backend: Thread startet execute_run()
         → Response: { run, cases: [] }  (sofort, ~50ms)

T=0.0s   UI startet setInterval(poll, 1500)
T=1.5s   GET /workflow/{run_id}  → scanning läuft, 1. Step pulsiert gelb
T=3.0s   GET ...                 → scanning done, assessment läuft
T=4.5s   GET ...                 → assessment.detail.progress: 3/12
                                   step-summary growing, streaming-pill aktiv
T=6.0s   GET ...                 → assessment.detail.progress: 6/12
                                   (alle 4. Tick auch: GET /workflow → Liste)
T=...    ... weitere Polls ...
T=Nx     GET ...                 → status=completed
         → UI stoppt Polling, ruft GET /llm-health + GET /workflow erneut
```

---

## Roadmap / Improvement Backlog

### ✅ Erledigt seit Initialversion

- **RSS-basiertes Scanning** mit synthetischem Fallback (statt Mock-Items)
- **LLM-Klassifikation pro Case** im Assessment (statt SHA-Heuristik)
- **Streaming der Stage-Summaries** mit Live-Cursor in der UI
- **Asynchroner Workflow** mit Polling (statt Block-bis-fertig)
- **Run History** (`GET /workflow`, klickbare Liste, History-Reset)
- **LLM-Health-Endpoint** mit Live-Pill in der UI

### Offen — hohe Priorität

- **HITL-Pause** zwischen Expert und Scenario; Workflow hält an, bis pending
  Cases entweder approved oder rejected sind. Position im Datenfluss steht
  schon (status="pending"), nur der Pause-Mechanismus fehlt.
- **Cross-Run-Dedup** — pro Case prüfen ob die URL in vorherigen Runs schon
  klassifiziert wurde; Badge "Neu" / "Wiederkehrend (3× seit …)" anzeigen.
- **LLM-gestützter Expert-Step** — aktuell Schwellwert, könnte per LLM-Call
  einen echten Expert-Kommentar pro Case generieren.

### Offen — mittlere Priorität

- **Echter Multi-Agent-Crew** — statt `summarize_stage` mit Single-Agent ein
  echter `Crew(agents=[Scanner, Assessor, Expert, Planner], process=...)`.
- **Token-Cost / Latency-Metriken** pro Step via LiteLLM `usage` und Cost.
- **Charts in der UI** — Confidence-Verteilung, Ansoff-Heatmap, Signale-Trend
  über Runs hinweg.
- **Deutsche RSS-Quellen** ergänzen (BMWK/Heise/pv-magazine waren beim Probe
  bot-blockiert; DuckDuckGo-Site-Search oder archive.org-RSS als Workaround).
- **SQLite statt state.json** — Indizes, Queries, Concurrency. Aktuell wird
  bei jedem Step-Update die ganze JSON-Datei neu geschrieben.

### Offen — niedrige Priorität

- **Tests** (Unit/Integration) für `crew_layer`, `sources`, `workflow`.
- **Auth** auf den FastAPI-Endpunkten.
- **CORS** restriktiver konfigurieren (aktuell `allow_origins=["*"]`).
- **`.gitignore` + Repo-History-Cleanup** für `__pycache__`, `state.json`,
  `.env` und früher committete Keys.

---

**Stand:** 2026-06-17
**System:** CrewAI (Python/FastAPI) + Workflow Console (Next.js)
**Persistenz:** flat JSON (`data/state.json`)
**LLM-Provider:** beliebiges LiteLLM-kompatibles Modell, default OpenRouter
