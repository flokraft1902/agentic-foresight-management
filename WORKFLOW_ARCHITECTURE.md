# CrewAI Foresight Workflow — Architektur & Datenfluss

Aktualisiert nach Umstellung auf RSS+DuckDuckGo-basiertes Scanning,
LLM-Klassifikation mit PESTEL+Zieldreieck, LLM-Energy-Expert mit
systemischem Impact und Zieldreieck-Detailtexten, Streaming-Summaries,
asynchronem Run mit Polling und HITL-Pause+Resume.

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
   │  Progress-Bars (Assess,  │      │
   │   Expert)                │      │
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
   │  Signal/Noise-Review     │
   │  + Filter-Chips          │
   │  + Search                │
   │  + PESTEL/Zieldreieck    │ ──────────► PUT /api/cases/{case_id}/review
   │  + Energy-Expert-Block   │       JSON: { is_signal, comment, ... }
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
        │  │     → Fallback: SHA-Heuristik bei Timeout/     │   │
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
  1. Fetch alle 4 RSS-Feeds parallel (httpx, 8s Timeout)
     Parse via feedparser, strip HTML aus title/summary.
  2. Für jeden search_term:
     a. RSS-Matches: substring/token-match auf title+summary
     b. DDG-Suche: "{term} (site:bmwk.de OR site:heise.de OR ...)"
        via ddgs.text(..., region="de-de")
     c. Merge RSS + DDG, sort by published desc, cap 4, dedup über (term,url)

  Wenn 0 Hits global: _fallback_sources(terms) — synthetische Items mit
                      "[fallback]"-Snippet.

Output: SourceItem[] mit feed-spezifischem trust_score


ASSESSMENT STEP
───────────────
Input: scanned SourceItems[]

Processing:
  FOR jeden Case:
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

  Alle 3 Cases: upsert_run() mit progress + llm/heuristic-counts


EXPERT VALIDATION STEP
──────────────────────
Input: SignalCase[] (mit PESTEL + Zieldreieck-Dims aus Assessment)

Processing:
  FOR jeden Case:
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

Schreibvorgänge:
  • Alle 3 klassifizierten Cases während Assessment
  • Alle 3 validierten Cases während Expert
  • Alle 0.5s während LLM-Streaming (gedrosselt)
  • Bei jedem Step-Anfang/-Ende
  • Bei jedem Case-Review (PUT /cases/{id}/review)
  • Beim Reset (DELETE /workflow)
  • Beim HITL-Gate (status → awaiting_review) und Resume (status → running)
```

---

## API Endpoints Summary

```
GET /health
GET /llm/health                       Liveness-Probe mit echtem LLM-Mini-Call

GET  /config/search-terms             aktuelle Suchbegriffe
PUT  /config/search-terms             überschreiben

POST   /workflow/start                Run starten, returnt sofort (run_id)
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
• Assessment: jeder Case fällt auf SHA-Heuristik zurück
              llm_classified=0, heuristic_classified=alle
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

## Roadmap / Improvement Backlog

### ✅ Erledigt seit Initialversion

- **Hybrid-Scanning** (RSS + DuckDuckGo Site-restricted Queries für deutsche
  Quellen, synthetischer Fallback)
- **LLM-Klassifikation pro Case** im Assessment (statt SHA-Heuristik), inkl.
  PESTEL-Kategorie und Zieldreieck-Dimensionen
- **LLM-Energy-Expert** mit Energiedomänen-Framework, liefert
  `systemic_impact`, `time_horizon` und Detailtexte pro Zieldreieck-Dimension
- **Streaming der Stage-Summaries** mit Live-Cursor in der UI
- **Asynchroner Workflow** mit Polling (statt Block-bis-fertig)
- **Run History** (`GET /workflow`, klickbare Liste, History-Reset)
- **LLM-Health-Endpoint** mit Live-Pill in der UI
- **HITL-Pause + Resume**: Workflow stoppt automatisch bei mittlerer
  Confidence; `POST /workflow/{run_id}/resume` setzt nach dem Review fort
- **Case-Filterung + Awaiting-Highlight** in der Review-UI
- **Progress-Bars** in Assessment und Expert

### Offen — hohe Priorität

- **Cross-Run-Dedup** — pro Case prüfen ob die URL in vorherigen Runs schon
  klassifiziert wurde; Badge "Neu" / "Wiederkehrend (3× seit …)" anzeigen.
- **Charts** — Confidence-Verteilung, Ansoff-Heatmap, PESTEL-Donut,
  Systemic-Impact-Verteilung, Signale-Trend über Runs.
- **Token-Cost / Latency-Metriken** pro Step via LiteLLM `usage` und Cost.

### Offen — mittlere Priorität

- **Auto-Search-Term-Suggestions** vom LLM basierend auf validierten Signalen.
- **Echter Multi-Agent-Crew** — `Crew(agents=[Scanner, Assessor, Expert,
  Planner])` mit Delegation. Trade-off: würde Streaming und granuläre
  Progress-Updates verlieren; aktuelle Lösung ist konzeptionell schon
  multi-agentig.
- **Export** — Cases/Strategic-Alerts als CSV/JSON/PDF.
- **Bulk-Actions** — "Alle Signals > 0.85 approven", "Alle Domain-rejected
  verwerfen".
- **Deutsche RSS-Quellen** direkt einbinden (BMWK/Heise/pv-magazine sind
  per direktem Fetch bot-blockiert; DDG-Workaround läuft bereits).
- **SQLite statt state.json** — Indizes, Queries, Concurrency.

### Offen — niedrige Priorität

- **Notifications** (E-Mail/Slack) bei completed Runs mit
  `systemic_impact=HOCH`.
- **Tests** (Unit/Integration) für `crew_layer`, `sources`, `workflow`.
- **Auth** auf den FastAPI-Endpunkten.
- **CORS** restriktiver konfigurieren (aktuell `allow_origins=["*"]`).

---

**Stand:** 2026-06-17
**System:** CrewAI (Python/FastAPI) + Workflow Console (Next.js)
**Persistenz:** flat JSON (`data/state.json`)
**LLM-Provider:** beliebiges LiteLLM-kompatibles Modell, default OpenRouter
