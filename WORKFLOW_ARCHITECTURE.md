# Foresight Workflow — Architektur & Datenfluss

Implementations-Architektur des Backends (`crewai/`) und Frontends
(`ui/workflow-console/`). Aktualisiert nach Umstellung auf RSS+DuckDuckGo-
basiertes Scanning, LLM-Klassifikation mit PESTEL+Zieldreieck, LLM-Energy-
Expert mit systemischem Impact, Streaming-Summaries (mit Markdown-Rendering
und blinkendem Caret), asynchronem Run mit 750-ms-Polling, HITL-Pause+Resume,
Auto-Search-Suggestions, Cross-Run-URL-Dedup, vier Analyse-Charts plus
Trend-Chart, sowie Export als CSV / JSON / PDF-Report.

> Konzeptionelle Spezifikation der Agenten und Methodologie:
> [`MAS_Foresight_Architektur.md`](MAS_Foresight_Architektur.md).

## System-Übersicht

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FORESIGHT WORKFLOW SYSTEM                            │
│                  (Python/FastAPI Backend + Next.js Frontend)                │
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
   │  Timeline (live)         │      │      (Poll alle 750ms)
   │  Streaming-Cursor        │      │
   │  Progress-Bars (Assess,  │      │
   │   Expert)                │      │
   │  Foresight-Report-Export │      │
   └──────────────────────────┘      │
                                      │
   ┌──────────────────────────┐      │
   │  HITL-Banner             │ ─────┤──────► POST /api/workflow/{runId}/resume
   │  (bei awaiting_review)   │      │
   └──────────────────────────┘      │
                                      │
   ┌──────────────────────────┐      │
   │  Run History             │ ◄────┤──────── GET /api/workflow?limit=15
   │  (klickbare Karten)      │      │
   │                          │ ─────┘──────► DELETE /api/workflow[?force=true]
   └──────────────────────────┘

   ┌──────────────────────────┐
   │  Analyse-Dashboard       │
   │  - PESTEL-Verteilung     │ ◄─── (clientseitig aus cases berechnet)
   │  - Ansoff Level Chart    │
   │  - Systemic Impact Donut │
   │  - Zieldreieck-Coverage  │
   │  - Trend über Runs       │
   └──────────────────────────┘

   ┌──────────────────────────┐
   │  Signal/Noise-Review     │
   │  + Filter-Chips          │
   │  + Search                │
   │  + PESTEL/Zieldreieck    │ ──────────► PUT /api/cases/{case_id}/review
   │  + Energy-Expert-Block   │       JSON: { is_signal, comment, ... }
   │  + Detail-Modal          │
   │  + Export CSV/JSON/PDF   │ ──────────► (client-side, kein Backend)
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
        │  │   - DuckDuckGo Site-restricted Suche pro Term  │   │
        │  │     über _DDG_SITES (BMWK, BNetzA, Bundestag,  │   │
        │  │     Agora, Fraunhofer ISE, DENA, IEA, Tages-   │   │
        │  │     schau, Handelsblatt, Heise, PV Magazine,   │   │
        │  │     Energie&Management)                        │   │
        │  │   - Merge: RSS + DDG, sort by date desc, dedup │   │
        │  │     über (term,url), cap 4/Term                │   │
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
        │  │        {is_signal, confidence (0-1),           │   │
        │  │         ansoff_level (1-4),                    │   │
        │  │         pestel_category (P|E|S|T|En|L),        │   │
        │  │         zieldreieck_dimensions: [...],         │   │
        │  │         rationale}                             │   │
        │  │     → Fallback: Heuristik bei Timeout/         │   │
        │  │        Parse-Error/Quota                       │   │
        │  │                                                │   │
        │  │ Live-Progress: alle 3 Cases upsert_run() mit   │   │
        │  │   progress.classified, llm_classified,         │   │
        │  │   heuristic_classified, signal/noise_count     │   │
        │  │                                                │   │
        │  │ Output: List[SignalCase] mit validation_status │   │
        │  │   = "pending"                                  │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: assessment → done                            │
        └────────────────┬─────────────────────────────────────┘
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │       STEP 3: ENERGY EXPERT VALIDATION                 │
        │  ┌────────────────────────────────────────────────┐   │
        │  │ FOR jeden Case:                                │   │
        │  │   validate_case_expert(title, snippet, focus,  │   │
        │  │     pestel_category, zieldreieck_dimensions,   │   │
        │  │     ansoff_level, confidence, is_signal)       │   │
        │  │     → LLM mit Energiedomänen-Framework         │   │
        │  │       (Merit-Order, Missing-Money, Kannibali-  │   │
        │  │        sierung, Netzphysik, Zieldreieck §1     │   │
        │  │        EnWG)                                   │   │
        │  │     → JSON-Output:                             │   │
        │  │        {is_valid, systemic_impact,             │   │
        │  │         time_horizon, zieldreieck_impact: {    │   │
        │  │           wirtschaftlichkeit: "...",           │   │
        │  │           versorgungssicherheit: "...",        │   │
        │  │           umweltvertraeglichkeit: "..."        │   │
        │  │         }, rationale}                          │   │
        │  │                                                │   │
        │  │ Status-Logik (kombiniert Domain-Verdict +      │   │
        │  │   Confidence-Schwelle):                        │   │
        │  │   IF NOT is_valid           → rejected         │   │
        │  │   ELIF is_signal AND >=0.72 → validated        │   │
        │  │   ELIF is_signal            → awaiting_review  │   │
        │  │   ELSE                      → rejected         │   │
        │  │                                                │   │
        │  │ Live-Progress: alle 3 Cases upsert_run() mit   │   │
        │  │   progress.validated, llm_validated,           │   │
        │  │   heuristic_validated, domain_rejected,        │   │
        │  │   validated_count, awaiting_review_count,      │   │
        │  │   rejected_count                               │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: energy_expert_validation → done              │
        └────────────────┬─────────────────────────────────────┘
                         ▼
                    ┌──────────────────────────────┐
                    │ HITL GATE                    │
                    │ Gibt es Cases im Status      │
                    │ "awaiting_review"?           │
                    └────┬────────────────────┬────┘
                         │ ja                 │ nein
                         ▼                    │
              ┌──────────────────────┐        │
              │ run.status =         │        │
              │ "awaiting_review"    │        │
              │ summary.awaiting_    │        │
              │   review = N         │        │
              │ → halt, return       │        │
              └──────────┬───────────┘        │
                         │                    │
                         │ Human-Review       │
                         │ via UI:            │
                         │   PUT /cases/{id}/ │
                         │     review         │
                         │   (setzt           │
                         │   validated /      │
                         │   rejected         │
                         │   entschieden)     │
                         │                    │
                         │ → User klickt      │
                         │   "Workflow        │
                         │    fortsetzen"     │
                         ▼                    │
              POST /workflow/{run_id}/resume  │
                         │                    │
                         ▼                    ▼
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
   UI Polling sieht im nächsten Tick (750ms):
   • Streaming-Pille + pulsierender Dot
   • Eyebrow "AGENT SUMMARY · streaming" in Akzent-Grün
   • Step-Summary mit grünem Linker-Balken + Gradient
   • Markdown-gerenderte Headings + Bullets (kein "##"-Roh-Text)
   • Blinkender ▌-Caret am Ende
   • Text wächst sichtbar mit, Auto-Scroll im Container

Pre-emit: Der Emitter setzt `streaming: true` bereits beim Setup (vor dem
ersten LLM-Chunk), damit auch kurze Stage-Summaries (Scanning, Assessment,
Expert: ~2-3s) zuverlässig im UI-Polling-Fenster erscheinen.
```

---

## Datenfluss pro Schritt

```
SCANNING STEP
─────────────
Input:  search_terms[], focus

Processing:
  Netzwerk-I/O läuft parallel (Thread-Pool), Merge + Dedup bleiben sequenziell
  und deterministisch.
  1. Fetch alle 4 RSS-Feeds parallel (httpx, 8s Timeout)
     Parse via feedparser, strip HTML aus title/summary.
  2. DDG-Suche pro search_term parallel:
     "{term} (site:bmwk.de OR site:heise.de OR ...)" via ddgs.text(..., region="de-de")
  3. Danach sequenziell pro search_term:
     a. RSS-Matches: substring/token-match auf title+summary
     b. Merge RSS + DDG, sort by published desc, cap 4, dedup über (term,url)

  Wenn 0 Hits global: _fallback_sources(terms) — synthetische Items mit
                      "[fallback]"-Snippet.

Output: SourceItem[] mit feed-spezifischem trust_score


ASSESSMENT STEP
───────────────
Input: scanned SourceItems[]

Processing:
  url_history = build_url_history()   # einmaliger State-Scan für Cross-Run-Dedup
  FOR jeden Case (parallel über Thread-Pool, LLM_MAX_WORKERS):
    heuristic_fallback = Classification(
      is_signal=(_confidence>=0.62), confidence=..., ansoff_level=...,
      pestel_category=None, zieldreieck_dimensions=[], source="heuristic"
    )

    classification = classify_case(term, title, snippet, focus, ...)
      → LLM Prompt mit Output-Schema:
        '{"is_signal": bool, "confidence": 0-1,
          "ansoff_level": 1-4,
          "pestel_category": "P|E|S|T|En|L",
          "zieldreieck_dimensions": ["wirtschaftlichkeit"|...],
          "rationale": str}'
      → Robustes Parsing: ungültige Werte → defaults / Fallback

    case = SignalCase(
      ..., pestel_category, zieldreieck_dimensions,
      validation_status = "pending"
    )

  Alle 3 abgeschlossenen Cases: upsert_run() mit progress + llm/heuristic-counts
  (Zähler + State-Write Lock-geschützt, da die Worker parallel laufen)


EXPERT VALIDATION STEP
──────────────────────
Input: SignalCase[] (mit PESTEL + Zieldreieck-Dims aus Assessment)

Processing:
  FOR jeden Case (parallel über Thread-Pool, LLM_MAX_WORKERS):
    expert = validate_case_expert(
      title, snippet, term, focus,
      is_signal, confidence, ansoff_level,
      pestel_category, zieldreieck_dimensions
    )
      → LLM Prompt enthält Energiedomänen-Framework:
        - Merit-Order: Grenzkosten, EE verdrängen Fossile
        - Missing Money: Backup-Kapazität, Energy-Only-Markt
        - Kannibalisierung: sinkender Marktwert bei hoher EE
        - 3D-Transformation: Decarb + Decentr + Digital
        - Zieldreieck (§1 EnWG): drei Dimensionen
      → JSON-Output:
        '{"is_valid": bool,
          "systemic_impact": "HOCH|MITTEL|GERING",
          "time_horizon": str,
          "zieldreieck_impact": {
            "wirtschaftlichkeit": str,    // konkrete Folge oder weggelassen
            "versorgungssicherheit": str,
            "umweltvertraeglichkeit": str
          },
          "rationale": str}'

    case.expert_comment = expert.rationale
    case.expert_valid   = expert.is_valid
    case.systemic_impact = expert.systemic_impact
    case.time_horizon   = expert.time_horizon
    case.zieldreieck_impact = expert.zieldreieck_impact

    # Domain-Reject übersteuert immer
    IF NOT expert.is_valid           → validation_status = "rejected"
    ELIF is_signal AND >=0.72        → "validated"
    ELIF is_signal                   → "awaiting_review"
    ELSE                             → "rejected"

  Alle 3 Cases: upsert_run() mit progress, llm_validated, heuristic_validated,
                domain_rejected, validated/awaiting_review/rejected counts


HITL GATE
─────────
IF [c for c in cases if c.validation_status == "awaiting_review"]:
  run.status = "awaiting_review"
  run.summary = {cases_total, signals, noise, validated_signals, awaiting_review}
  upsert_run(run)
  return  # halt; resume_run setzt später fort

ELSE: continue to scenario step


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
      "updated_at": "2026-06-17T10:16:15Z",
      "focus": "...",
      "search_terms": [...],
      "status": "completed",   // running | awaiting_review | completed | failed
      "steps": [
        {
          "name": "scanning",
          "status": "done",
          "detail": { focus, hits, sample_sources, crewai: {summary,streaming} }
        },
        {
          "name": "assessment",
          "status": "done",
          "detail": {
            "candidate_count": 12,
            "signal_count": 7,
            "noise_count": 5,
            "llm_classified": 11,
            "heuristic_classified": 1,
            "progress": { "classified": 12, "total": 12 },
            "crewai": { ... }
          }
        },
        {
          "name": "energy_expert_validation",
          "status": "done",
          "detail": {
            "validated_count": 5,
            "awaiting_review_count": 2,
            "rejected_count": 5,
            "domain_rejected": 1,
            "llm_validated": 12,
            "heuristic_validated": 0,
            "progress": { "validated": 12, "total": 12 },
            "crewai": { ... }
          }
        },
        { ... scenario step (optional, only after resume if HITL gate fired) ... }
      ],
      "summary": {
        "cases_total": 12,
        "signals": 7,
        "noise": 5,
        "validated_signals": 4,
        "strategic_alerts": 4,
        "awaiting_review": 2            // nur wenn HITL gate gefeuert hat
      }
    }
  ],

  "cases": [
    {
      "case_id": "case_abc123",
      "run_id": "run_20260617_...",
      "keyword": "EEG Novelle",
      "title": "...",
      "rationale": "...",            // vom LLM oder Heuristik-Fallback
      "confidence": 0.78,
      "is_signal": true,
      "ansoff_level": 3,
      "pestel_category": "P",        // Political|Economic|Social|...
      "zieldreieck_dimensions": [    // betroffene Dimensionen aus Assessment
        "versorgungssicherheit",
        "umweltvertraeglichkeit"
      ],
      "validation_status": "validated",
      "expert_comment": "...",       // LLM-Energy-Expert-Rationale
      "expert_valid": true,          // Domain-Verdict
      "systemic_impact": "MITTEL",   // HOCH | MITTEL | GERING
      "time_horizon": "6-18 Monate",
      "zieldreieck_impact": {        // Detailtexte pro Dimension
        "wirtschaftlichkeit": "...konkret...",
        "versorgungssicherheit": "...konkret..."
      },
      "reviewer_comment": "...",
      "reviewed_by": "frontend.reviewer",
      "reviewed_at": "...",
      "sources": [{ title, url, snippet, published_at, trust_score }]
    }
  ]
}

Schreibvorgänge (alle atomar: Temp-Datei + os.replace, Lock-geschützt):
  • Alle 3 klassifizierten Cases während Assessment
  • Alle 3 validierten Cases während Expert
  • Alle 0.5s während LLM-Streaming (gedrosselt)
  • Bei jedem Step-Anfang/-Ende
  • Bei jedem Case-Review (PUT /cases/{id}/review)
  • Beim Reset (DELETE /workflow)
  • Beim HITL-Gate (status → awaiting_review) und Resume (status → running)

Nebenläufigkeit:
  • Ein modul-globales reentrantes Lock serialisiert jeden Read-Modify-Write,
    sodass die parallelen Worker-Threads (Assessment/Expert) und ein paralleler
    Human-Review den State nicht gegenseitig überschreiben.
  • Es läuft immer nur ein Workflow gleichzeitig (Guard in POST /workflow/start).
  • reap_stale_runs() markiert verwaiste "running"-Runs (updated_at > 180s) vor
    jedem Start als "failed", damit ein Crash/Reload keine Starts blockiert.
```

---

## API Endpoints Summary

```
GET /health
GET /llm/health                       Liveness-Probe mit echtem LLM-Mini-Call

GET  /config/search-terms             aktuelle Suchbegriffe
PUT  /config/search-terms             überschreiben

POST   /workflow/start                Run starten, returnt sofort (run_id).
                                       409 wenn bereits ein Run aktiv ist
                                       (verwaiste Runs werden zuvor abgeräumt)
GET    /workflow                      Run-Liste (limit Query, ohne steps-Detail)
GET    /workflow/{run_id}             vollständiger Run inkl. steps + cases
POST   /workflow/{run_id}/resume      HITL-pausierten Run fortsetzen
                                       (409 wenn nicht awaiting_review,
                                        400 wenn noch Cases pending)
DELETE /workflow[?force=true]         Reset; 409 wenn aktive Runs, force=true
                                       überschreibt das

GET /cases?run_id=...                 Cases auflisten
GET /cases/{case_id}                  einzelner Case
PUT /cases/{case_id}/review           Human-Review: setzt validated/rejected
                                       je nach is_signal
```

---

## Fehlerbehandlung & Fallbacks

```
LLM_API_KEY fehlt / LLM nicht erreichbar / Quota überschritten
─────────────────────────────────────────────────────────────
• Scanning: läuft (RSS+DDG unabhängig vom LLM)
• Assessment: jeder Case fällt auf die Token/Trust-Heuristik (_confidence)
              zurück; llm_classified=0, heuristic_classified=alle
              PESTEL und Zieldreieck-Dims bleiben leer
• Expert: jeder Case fällt auf _default_expert_heuristic zurück
          (systemic_impact aus confidence, leere zieldreieck_impact)
• Scenario: läuft
• summarize_stage: returnt CrewSummary(used_crewai=False)
→ Pipeline läuft komplett durch, UI zeigt "LLM Fallback"-Pille pro Step

Alle RSS-Feeds und DDG offline
──────────────────────────────
• search_sources liefert 0 Live-Hits
• _fallback_sources erzeugt deterministische Items aus _FALLBACK_BASE_URLS
• Backend loggt "[sources] no live hits — using synthetic fallback"
• UI sieht reguläre Cases, Snippets beginnen mit "[fallback]"

LLM-Streaming bricht mit Exception ab
─────────────────────────────────────
• Bisher akkumulierte Tokens werden als finaler Text zurückgegeben
• summarize_stage gibt CrewSummary(used_crewai=True, text=teil) zurück
• Wenn 0 Tokens: used_crewai=False, Fallback-Text

Expert-LLM rejected Case (is_valid=false)
─────────────────────────────────────────
• validation_status wird hart auf "rejected" gesetzt, unabhängig von confidence
• expert_comment enthält die LLM-Begründung
• In step.detail wird domain_rejected hochgezählt

Run abgestürzt / uvicorn restart während Run
────────────────────────────────────────────
• Run bleibt zunächst mit status="running" in state.json (verwaist)
• reap_stale_runs() markiert ihn beim nächsten POST /workflow/start
  automatisch als "failed" (updated_at älter als 180s), sodass der neue Start
  nicht durch den Concurrency-Guard (409) blockiert wird
• Alternativ räumt DELETE /workflow?force=true verwaiste Runs manuell ab
  (UI bietet force automatisch nach einem 409 an)
```

---

## Live-Updates: Polling-Sequenz

```
T=0.0s   POST /workflow/start
         → Backend: prepare_run() schreibt Run mit status=running
         → Backend: Thread startet execute_run()
         → Response: { run, cases: [] }  (sofort, ~50ms)

T=0.0s   UI startet setInterval(poll, 750)
T=0.75s  GET /workflow/{run_id}  → scanning läuft, 1. Step pulsiert gelb
T=1.5s   GET ...                 → scanning done, assessment läuft
T=2.25s  GET ...                 → assessment.detail.progress: 3/12
                                   step-summary growing, streaming-pill aktiv
T=3.0s   GET ...                 → assessment.detail.progress: 6/12
                                   (alle 8. Tick auch: GET /workflow → Liste)
T=Nx     GET ...                 → expert.detail.progress: 5/12 validated
T=Mx     GET ...                 → status=awaiting_review (HITL fired)
         → UI stoppt Polling, zeigt Banner + Review-Chip pulsiert

T=user   Reviewer markiert jeden pending Case als Signal/Noise:
         PUT /cases/{id}/review → validated|rejected entschieden
T=user   Click "Workflow fortsetzen":
         POST /workflow/{run_id}/resume → Backend: thread startet
         _background_resume → resume_run(run_id) → _run_scenario_step

T=Mx+1   UI re-startet Polling (Status zurück auf running)
T=Ox     GET ...                 → scenario läuft, summary streamt
T=Px     GET ...                 → status=completed
         → UI stoppt Polling, ruft GET /llm-health + GET /workflow erneut
```

---

## Frontend-Struktur (nach Komponenten-Refactor)

Das Frontend ist in fokussierte Section-Komponenten aufgeteilt, `page.tsx`
ist reine Orchestrierung (State, Effects, Fetch-Handler, Komposition):

```
ui/workflow-console/
├── app/
│   ├── page.tsx              ← Orchestrator (~630 Zeilen)
│   ├── layout.tsx
│   └── api/                  ← Next-Server-Routes als Proxy zu FastAPI
│
├── components/
│   ├── Topbar.tsx            Brand + LLM-Health-Pill
│   ├── ConfigCard.tsx        Suchbegriffe, Fokus, Auto-Search-Suggestions
│   ├── RunOverviewCard.tsx   KPIs + Report-Export-Button
│   ├── HitlBanner.tsx        Pause-Banner mit Resume-Button
│   ├── RunHistoryCard.tsx    Liste vergangener Runs
│   ├── WorkflowTimeline.tsx  Steps + Streaming-Visual + Agent-Summary
│   ├── AnalyseCharts.tsx     PESTEL / Ansoff / Donut / Zieldreieck
│   ├── TrendChart.tsx        SVG-Linienchart über Runs
│   ├── CaseCard.tsx          Eine Case-Karte mit Badges + Korrektur-Form
│   ├── CaseModal.tsx         Detail-Vollansicht
│   ├── CasesSection.tsx      Filter + Search + Export + Case-Grid
│   └── CustomTooltip.tsx     Floating Tooltip-Layer (instant)
│
└── lib/
    ├── types.ts              Shared TS-Interfaces (mirror Pydantic)
    ├── labels.ts             PESTEL / Ansoff / Impact / Zieldreieck-Strings
    ├── stepHelpers.ts        statusPillClass, stepProgressInfo, ...
    ├── renderStageSummary.tsx Mini-Markdown-Renderer für Stage-Summaries
    ├── useTooltip.tsx        Hook: { tooltip, onMouseMove, onMouseLeave }
    ├── exportReport.ts       jsPDF-basierter Foresight-Report-Export
    └── backend.ts            Backend-URL-Helper
```

---

## Roadmap / Improvement Backlog

### ✅ Erledigt

- **Hybrid-Scanning** (RSS + DuckDuckGo Site-restricted Queries für deutsche
  Quellen, synthetischer Fallback)
- **LLM-Klassifikation pro Case** im Assessment (statt reiner Heuristik), inkl.
  PESTEL-Kategorie und Zieldreieck-Dimensionen
- **LLM-Energy-Expert** mit Energiedomänen-Framework, liefert
  `systemic_impact`, `time_horizon` und Detailtexte pro Zieldreieck-Dimension
- **Streaming der Stage-Summaries** mit Live-Cursor, Eyebrow-Label und
  Markdown-Rendering (Headings + Bullets statt "##"-Rohtext)
- **Asynchroner Workflow** mit 750-ms-Polling (statt Block-bis-fertig)
- **Run History** (`GET /workflow`, klickbare Liste, History-Reset)
- **LLM-Health-Endpoint** mit Live-Pill in der UI
- **HITL-Pause + Resume**: Workflow stoppt automatisch bei mittlerer
  Confidence; `POST /workflow/{run_id}/resume` setzt nach dem Review fort.
  Button deaktiviert sofort beim Klick, um Doppel-Trigger zu verhindern.
- **Case-Filterung + Awaiting-Highlight** + Volltext-Suche im Review-UI
- **Progress-Bars** in Assessment und Expert
- **Cross-Run-URL-Dedup** — pro Case-URL `seen_count` + `first_seen_at`,
  Badge "↻ N× seit DATUM" auf wiederkehrenden Quellen
- **Vier Analyse-Charts** — PESTEL-Verteilung, Ansoff-Level, Systemischer
  Impact (Donut), Zieldreieck-Coverage, mit instant Tooltips auf jeder
  Komponente. Plus separater Trend-Chart über abgeschlossene Runs.
- **Auto-Search-Term-Suggestions** vom LLM basierend auf validierten Signalen
  (Chips in der Konfiguration zum Annehmen)
- **Export** — Cases als CSV (Excel/Reports), JSON (Gruppe-12-Dashboard) und
  PDF-Foresight-Report (Präsentation/Verteidigung, jsPDF, client-side)
- **Detail-Modal** für Cases mit ESC-Close, Pfeiltasten-Navigation würde
  hinzukommen (offen)
- **Frontend-Refactor** in `components/` + `lib/` (page.tsx von 1969 auf
  ~630 Zeilen, 13 Komponenten)
- **Parallelisierte LLM-Stages** — Per-Case-Calls in Assessment und Expert über
  Thread-Pool (`LLM_MAX_WORKERS`); Scanning holt RSS + DDG ebenfalls parallel,
  Merge/Dedup bleiben sequenziell-deterministisch
- **Cross-Run-URL-History** in einem Scan vorberechnet (`build_url_history`)
  statt pro Case — entfernt den quadratischen State-Scan
- **Robuster State-Store** — atomare Writes (Temp + `os.replace`) und ein
  reentrantes Lock gegen Clobbering durch parallele Threads
- **Concurrency-Guard + Stale-Run-Reaper** — nur ein Run gleichzeitig (409),
  verwaiste Runs nach Crash/Reload werden automatisch abgeräumt
- **CORS konfigurierbar** — `CORS_ALLOW_ORIGINS` (Default `localhost:3000`)
  statt Wildcard `["*"]`

### Offen — hohe Priorität

- **Token-Cost / Latency-Metriken** pro Stage via LiteLLM `usage` und
  Cost — würde "ein Standard-Run kostet X Cents und dauert Y Sek"
  auditierbar machen
- **Confidence-Histogramm** — fünfter Chart, zeigt Verteilung der
  Diagnose-Sicherheit über Buckets
- **Hallucination-Check pro Case** — Zusatz-LLM-Call prüft, ob die
  Rationale aus dem Source-Snippet ableitbar ist; markiert verdächtige
  Cases mit `hallucination_risk`-Flag

### Offen — mittlere Priorität

- **Run-Diff** — zwei Runs nebeneinander vergleichen (welche Cases neu,
  welche verschwunden, welche Themen wachsen)
- **Bulk-Actions** — "Alle Signals > 0.85 approven", "Alle Domain-rejected
  verwerfen"
- **Saved Configurations** — Such-Begriffs-Presets ("Energiespeicher-
  Monitoring") speicher- und wiederabrufbar
- **Inline Approve/Reject** + Pfeiltasten-Navigation im Modal — UX-Komfort
  beim HITL-Review bei vielen Cases
- **Sticky Filter-Bar** im Cases-Section
- **Backup/Restore der state.json** — Ein-Klick-Export/Import für Demos
- **Per-Term-Yield-Statistik** — welche Suchbegriffe produzieren mehr
  validierte Signale
- **SQLite statt state.json** — Indizes, Queries, Concurrency

### Offen — niedrige Priorität

- **Type-Sharing Backend↔Frontend** via OpenAPI-Schema → TypeScript
  (Pydantic ist Source-of-Truth, TS-Types werden generiert statt manuell
  gepflegt)
- **Tests** (pytest/vitest) für `crew_layer`, `sources`, `workflow` und
  Frontend-Filter-/Sort-Logik
- **Notifications** (E-Mail/Slack) bei completed Runs mit
  `systemic_impact=HOCH`
- **Cron / Scheduled Runs** — automatischer wöchentlicher Run
- **Auth** auf den FastAPI-Endpunkten
- **In-Memory-State-Cache / SQLite** — Lese- und Schreibpfad des Stores
  entlasten (Polling parst aktuell die ganze state.json pro Tick)

---

**Stand:** 2026-06-19
**System:** Python/FastAPI Backend + Next.js Workflow Console
**Persistenz:** flat JSON (`crewai/data/state.json`)
**LLM-Provider:** beliebiges LiteLLM-kompatibles Modell, default OpenRouter
