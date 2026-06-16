# CrewAI Foresight Workflow - Architektur & Datenfluss

## System-Übersicht

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FORESIGHT WORKFLOW SYSTEM                            │
│                      (CrewAI Backend + Next.js Frontend)                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Frontend → Backend Interaktionen

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                      WORKFLOW CONSOLE FRONTEND                            ║
║                    (Next.js, Port 3001, Browser)                          ║
╚═══════════════════════════════════════════════════════════════════════════╝

   ┌──────────────────────────┐
   │  Suchoberbegriffe Editor │ ─────┬──────► PUT /api/config/search-terms
   │  (Editierbar + Speicher) │      │
   └──────────────────────────┘      │
                                      │  JSON: { search_terms: [] }
   ┌──────────────────────────┐      │
   │  Fokus & Workflow Start  │ ─────┤──────► POST /api/workflow/start
   │  (Button + Formular)     │      │
   └──────────────────────────┘      │  JSON: { search_terms, focus }
                 ▲                   │
                 │                   ▼
   ┌────────────────────────────────────────────────────────┐
   │         NEXT.JS API PROXY LAYER                        │
   │  (Forwarding an CrewAI Backend auf Port 8000)         │
   └────────────────────────────────────────────────────────┘
                 ▲                   │
                 │                   ▼
   ┌──────────────────────────┐      │
   │  Run-Status & Timeline   │ ◄────┤──────── GET /api/workflow/{run_id}
   │  (Live-Update je Schritt)│      │
   └──────────────────────────┘      │  Response: { run, cases, steps }
                                      │
   ┌──────────────────────────┐      │
   │  Signal/Noise Cases Table│      │
   │  + Quellen sichtbar      │ ─────┤──────► PUT /api/cases/{case_id}/review
   │  + Korrektur-Editor      │      │
   └──────────────────────────┘      │  JSON: { is_signal, comment, ... }
                                      │
   ┌──────────────────────────┐      │
   │  Evidence & Sources      │ ◄────┘
   │  (Links, Trust Score)    │
   └──────────────────────────┘
```

---

## CrewAI Backend - Workflow Pipeline

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                      CREWAI BACKEND ORCHESTRATION                         ║
║                   (Python/FastAPI, Port 8000, Uvicorn)                    ║
╚═══════════════════════════════════════════════════════════════════════════╝

                            ┌─────────────────┐
                            │  Workflow Start │
                            │  (run_workflow) │
                            └────────┬────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
        Resolve Search Terms              Resolve Focus Strategy
           (Defaults/User)               (Strategic Direction)
                    │                                 │
                    └────────────────┬────────────────┘
                                     ▼
        ┌────────────────────────────────────────────────────────┐
        │          STEP 1: SCANNING AGENT                        │
        │  ┌────────────────────────────────────────────────┐   │
        │  │ • Iterate über Search Terms                    │   │
        │  │ • Generate Mock Quellen (IEA, EC, AGORA, etc) │   │
        │  │ • Extend mit Title, URL, Trust Score          │   │
        │  │ • CrewAI Summary (falls LLM verfügbar)        │   │
        │  │                                                │   │
        │  │ Output: List[SourceItem] (2 pro Term)        │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: "scanning" → "done"                          │
        │  Timeline Step gespeichert in data/state.json         │
        └────────────────┬─────────────────────────────────────┘
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │          STEP 2: ASSESSMENT AGENT                      │
        │  ┌────────────────────────────────────────────────┐   │
        │  │ • Iterate über alle Scanning-Output Quellen    │   │
        │  │ • Klassifikation: is_signal (confidence ≥ 0.62)│   │
        │  │ • Generate SignalCase pro Quelle               │   │
        │  │ • Rationale & Ansoff-Level setzen             │   │
        │  │ • CrewAI: Filter Signal vs Noise               │   │
        │  │                                                │   │
        │  │ Output: List[SignalCase]                      │   │
        │  │   - is_signal: bool                           │   │
        │  │   - confidence: 0.0-1.0                       │   │
        │  │   - sources: [SourceItem]                     │   │
        │  │   - validation_status: "pending"              │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: "assessment" → "done"                        │
        │  Cases jetzt persistiert: data/state.json             │
        └────────────────┬─────────────────────────────────────┘
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │       STEP 3: ENERGY EXPERT VALIDATION                 │
        │  ┌────────────────────────────────────────────────┐   │
        │  │ • Filter: is_signal ∧ confidence ≥ 0.72       │   │
        │  │ • Set validation_status: "validated"          │   │
        │  │ • Add expert_comment (Strategic Relevance)    │   │
        │  │ • Ansoff-Level Context (Produkt/Markt/Tech)  │   │
        │  │ • CrewAI: Energiewirtschaftliche Bewertung    │   │
        │  │                                                │   │
        │  │ Output: Updated SignalCases                   │   │
        │  │   - validation_status: "validated"|"pending"  │   │
        │  │   - expert_comment: str                       │   │
        │  │   - ansoff_level: 1-5                         │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: "energy_expert_validation" → "done"          │
        │  Counts stored in summary                             │
        └────────────────┬─────────────────────────────────────┘
                         ▼
        ┌────────────────────────────────────────────────────────┐
        │      STEP 4: SCENARIO INTEGRATION AGENT                │
        │  ┌────────────────────────────────────────────────┐   │
        │  │ • Filter: validation_status == "validated"     │   │
        │  │ • Generate Strategic Alerts (Top 10)           │   │
        │  │ • Alert = {case_id, title, keyword, level}    │   │
        │  │ • CrewAI: Scenario Szenario-Implikationen      │   │
        │  │ • Synthesis zu Policy/Security/Sustainability │   │
        │  │                                                │   │
        │  │ Output: Strategic Alert Summary                │   │
        │  │   - alert_count: int                          │   │
        │  │   - alerts: List[dict]                        │   │
        │  └────────────────────────────────────────────────┘   │
        │  Status: "scenario_integration" → "done"              │
        │  Final summary stored in run.summary                  │
        └────────────────┬─────────────────────────────────────┘
                         ▼
                    ┌──────────────┐
                    │   Workflow   │
                    │  Completed   │
                    │   & Stored   │
                    │ (state.json) │
                    └──────────────┘
```

---

## Datenfluss pro Schritt

```
╔════════════════════════════════════════════════════════════════════════╗
║                     DATENFLUSS IM DETAIL                               ║
╚════════════════════════════════════════════════════════════════════════╝

SCANNING STEP
─────────────
Input:  [ search_terms: ['hydrogen import', 'storage battery', ...],
          focus: 'Energy transition weak signals' ]

Processing:
  FOR each term in search_terms:
    → Generate 2 Mock Sources
       • IEA, EC, AGORA, CLEANENERGYWIRE, BMWK, or AGORA URL
       • Published date (rolling window last 21 days)
       • Trust Score: 0.45-0.95
       • Snippet: Generic energy transition text

Output: SourceItem[]
  [
    {
      "keyword": "hydrogen import",
      "title": "Hydrogen Import Update 1",
      "url": "https://www.iea.org/news/hydrogen-import-1",
      "snippet": "New development for hydrogen import...",
      "published_at": "2026-06-10",
      "trust_score": 0.72
    },
    ...
  ]

Storage: 
  ✓ Persist in data/state.json (cases array)
  ✓ Update run.steps[0] with detail


ASSESSMENT STEP
───────────────
Input:  Scanned SourceItems[]

Processing:
  FOR each source:
    confidence = base(0.42) 
               + term_keyword_matches(0-0.49) 
               + source_trust_score(0-0.20)
    is_signal = (confidence >= 0.62)
    
    Create SignalCase:
      - case_id: uuid
      - is_signal: bool
      - confidence: 0.0-1.0
      - ansoff_level: 1-5 (based on keyword)
      - rationale: "Structural impact detected..."
      - sources: [original SourceItem]
      - validation_status: "pending"

Output: SignalCase[]
  [
    {
      "case_id": "case_abc123",
      "keyword": "hydrogen import",
      "is_signal": true,
      "confidence": 0.73,
      "ansoff_level": 4,
      "validation_status": "pending",
      "sources": [...]
    },
    ...
  ]

Storage:
  ✓ Persist in data/state.json (cases)
  ✓ Update run.steps[1] with counts


EXPERT VALIDATION STEP
──────────────────────
Input:  SignalCase[] from Assessment

Processing:
  FOR each case WHERE is_signal:
    IF confidence >= 0.72:
      validation_status = "validated"
      expert_comment = "Consistent with strategic relevance..."
    ELSE:
      validation_status = "pending"
      expert_comment = "Potential signal, requires human review..."
    
    IF NOT is_signal:
      validation_status = "rejected"
      expert_comment = "Classified as noise..."

Output: Updated SignalCase[] with validation_status & expert_comment

Storage:
  ✓ Update cases in data/state.json
  ✓ Update run.steps[2] with counts (validated/pending/rejected)


SCENARIO INTEGRATION STEP
─────────────────────────
Input:  SignalCase[] where validation_status == "validated"

Processing:
  Filter: Only validated signals
  Generate Strategic Alerts:
    - Take top 10 validated cases
    - Extract: case_id, title, keyword, ansoff_level, confidence
    - Headline impact on Policy/Security/Sustainability
  
  Synthesis:
    - Create summary statement
    - Alert count

Output: Strategic Alert Summary
  {
    "alert_count": 5,
    "alerts": [
      {
        "case_id": "case_xyz",
        "title": "Hydrogen Import Update",
        "keyword": "hydrogen import",
        "ansoff_level": 4,
        "confidence": 0.75,
        "main_source": "https://..."
      },
      ...
    ]
  }

Storage:
  ✓ Update run.summary with alert_count
  ✓ Update run.steps[3] with alerts[]
  ✓ Final run.status = "completed"
```

---

## Frontend Human-in-the-Loop Review

```
╔════════════════════════════════════════════════════════════════════════╗
║                    FRONTEND REVIEW & CORRECTION                        ║
╚════════════════════════════════════════════════════════════════════════╝

USER DASHBOARD VIEW
───────────────────
┌─────────────────────────────────────────────────────────────┐
│  Suchbegriffe: [hydrogen import, storage battery, ...]     │
│  [Speichern Button] ──► PUT /api/config/search-terms       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Fokus: "Energy transition weak signals..."                │
│  [Workflow Starten] ──► POST /api/workflow/start           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  RUN TIMELINE (Live Updated)                                │
│  ┌─ Scanning        ✓ Done (2026-06-16 10:15:32Z)          │
│  │   Detail: focus=..., hits=24, sample_sources=5          │
│  │   CrewAI: {enabled: true, summary: "..."}               │
│  │                                                          │
│  ├─ Assessment      ✓ Done (2026-06-16 10:15:45Z)          │
│  │   Detail: candidate_count=24, signals=8, noise=16       │
│  │   CrewAI: {enabled: true, summary: "..."}               │
│  │                                                          │
│  ├─ Energy Expert   ✓ Done (2026-06-16 10:16:02Z)          │
│  │   Detail: validated=5, pending=3, rejected=16           │
│  │   CrewAI: {enabled: true, summary: "..."}               │
│  │                                                          │
│  └─ Scenario        ✓ Done (2026-06-16 10:16:15Z)          │
│     Detail: alert_count=5, alerts=[...]                    │
│     CrewAI: {enabled: true, summary: "..."}                │
└─────────────────────────────────────────────────────────────┘


SIGNAL vs NOISE REVIEW TABLE
────────────────────────────
┌───────┬──────────────┬─────────────┬──────────────────┬────────────┐
│ Title │ Classification
│ Quellen              │ Korrektur  │
├───────┼──────────────┼─────────────┼──────────────────┼────────────┤
│Hydro- │ System: Signal
         │ Link 1 (Trust:0.72)
     │ [Signal▼]  │
│ gen   │ Confidence:0.73
         │ Link 2 (Trust:0.68)
     │ Kommentar: │
│ Import│ Validation: pending
         │ Published: 2026-06-10
     │ [Speichern]│
│...    │ Expert: "Potential..."
     │            │ [Korrektur]│
│       │           │            │            │
├───────┼──────────────┼─────────────┼──────────────────┼────────────┤
│Storage│ System: Noise │ Link 1
     │ [Noise▼]   │
│Battery│ Confidence:0.58│ Rationale: │ Kommentar: │
│       │ Validation: rejected
     │ "Weak evidence"
  │ [Speichern]│
│       │ Expert: "Rejected"
     │ [Korrektur]│
└───────┴──────────────┴─────────────┴──────────────────┴────────────┘

USER ACTIONS (PUT /api/cases/{case_id}/review):
───────────────────────────────────────────────
1. Change is_signal: false → true
   → validation_status auto-updates to "pending" (falls war "rejected")

2. Add reviewer_comment: "Actually relevant after re-reading..."
   → Comment stored & used for audit trail

3. Correct title: "Old Title" → "New Title"
   → Updated in case, persisted

4. Correct rationale: "..." → "Better explanation"
   → Updated in case, persisted

5. Submit: [Speichern]
   → PUT request sent
   → Backend updates case
   → Audit log entry created
   → Frontend refreshes case
```

---

## Persistenz Layer

```
╔════════════════════════════════════════════════════════════════════════╗
║                      DATA STORAGE (JSON Files)                         ║
╚════════════════════════════════════════════════════════════════════════╝

data/state.json
───────────────
{
  "search_terms": ["hydrogen import", "storage battery", ...],
  "runs": [
    {
      "run_id": "run_20260616_101532_a1b2c3",
      "created_at": "2026-06-16T10:15:32Z",
      "updated_at": "2026-06-16T10:16:15Z",
      "focus": "Energy transition weak signals",
      "search_terms": [...],
      "status": "completed",
      "steps": [
        {
          "name": "scanning",
          "status": "done",
          "started_at": "2026-06-16T10:15:32Z",
          "finished_at": "2026-06-16T10:15:45Z",
          "detail": {
            "focus": "...",
            "hits": 24,
            "sample_sources": [...],
            "crewai": { "enabled": true, "summary": "..." }
          }
        },
        { ... assessment step ... },
        { ... expert step ... },
        { ... scenario step ... }
      ],
      "summary": {
        "cases_total": 24,
        "signals": 8,
        "noise": 16,
        "validated_signals": 5,
        "strategic_alerts": 5
      }
    }
  ],
  "cases": [
    {
      "case_id": "case_abc123",
      "run_id": "run_20260616_101532_a1b2c3",
      "keyword": "hydrogen import",
      "title": "Hydrogen Import Update 1",
      "rationale": "Structural impact on supply...",
      "confidence": 0.73,
      "is_signal": true,
      "ansoff_level": 4,
      "validation_status": "validated",
      "expert_comment": "Consistent with strategic relevance",
      "reviewer_comment": "Approved after review",
      "reviewed_by": "human.reviewer",
      "reviewed_at": "2026-06-16T10:18:00Z",
      "sources": [
        {
          "title": "IEA Hydrogen Report",
          "url": "https://www.iea.org/news/hydrogen-1",
          "snippet": "New developments for hydrogen import...",
          "published_at": "2026-06-10",
          "trust_score": 0.72
        }
      ]
    },
    { ... more cases ... }
  ]
}

Updates:
  • Search terms: PUT /api/config/search-terms
  • New run: POST /api/workflow/start
  • Case review: PUT /api/cases/{case_id}/review
  • All changes immediately persisted to disk
```

---

## API Endpoints Summary

```
╔════════════════════════════════════════════════════════════════════════╗
║                      FASTAPI BACKEND ROUTES                            ║
║                    (CrewAI, Port 8000, Uvicorn)                       ║
╚════════════════════════════════════════════════════════════════════════╝

GET /health
────────────
Response: { "ok": true, "service": "crewai-foresight-backend", ... }
Purpose:  Health check


GET /config/search-terms
─────────────────────────
Response: { "ok": true, "search_terms": [...] }
Purpose:  Retrieve current search term configuration


PUT /config/search-terms
────────────────────────
Request:  { "search_terms": ["term1", "term2", ...] }
Response: { "ok": true, "search_terms": [...] }
Purpose:  Update & persist search terms


POST /workflow/start
────────────────────
Request:  {
            "search_terms": ["..."], (optional, uses defaults if omitted)
            "focus": "..."            (optional, uses default if omitted)
          }
Response: {
            "ok": true,
            "run": { run_id, status, steps, summary, ... },
            "cases": [ SignalCase[], ... ]
          }
Purpose:  Trigger full workflow pipeline (Scanning → Assessment → Expert → Scenario)
Time:     ~3-5 seconds (depends on LLM availability)


GET /workflow/{run_id}
──────────────────────
Response: {
            "ok": true,
            "run": { run_id, status, steps, summary, ... },
            "cases": [ SignalCase[], ... ]
          }
Purpose:  Fetch run result & cases (used for live updates)


GET /cases
──────────
Query:    ?run_id=run_20260616_101532_a1b2c3 (optional)
Response: { "ok": true, "cases": [ SignalCase[], ... ] }
Purpose:  List all cases (optionally filtered by run_id)


GET /cases/{case_id}
────────────────────
Response: { "ok": true, "case": SignalCase }
Purpose:  Fetch single case details


PUT /cases/{case_id}/review
───────────────────────────
Request:  {
            "is_signal": true|false,
            "comment": "...",
            "corrected_title": "...",     (optional)
            "corrected_rationale": "...", (optional)
            "reviewer": "human.reviewer"
          }
Response: { "ok": true, "case": SignalCase (updated) }
Purpose:  Apply human review decision & corrections
```

---

## Workflow Zustandsdiagram

```
                         START
                           │
                           ▼
                    ┌──────────────┐
                    │   Frontend   │
                    │  User Input  │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Edit     │    │ Set      │    │ Press    │
    │ Search   │    │ Focus    │    │ Start    │
    │ Terms    │    │ Strategy │    │ Workflow │
    └────┬─────┘    └────┬─────┘    └────┬─────┘
         │               │               │
         │               └───────┬───────┘
         │                       │
         ▼                       ▼
    ┌─────────────────────────────────┐
    │  PUT /api/config/search-terms   │
    │  (optional, save for next time) │
    └──────────────────┬──────────────┘
                       │
                       ▼
             ┌──────────────────────┐
             │ POST /api/workflow   │
             │ /start (non-blocking)│
             └─────────┬────────────┘
                       │
         ┌─────────────┴──────────────┐
         │                            │
         ▼                            ▼
    [Return           [Start Async Process]
     run_id]                   │
         │                     ├─► Step 1: Scanning
         │                     │   └─ sources[]
         │                     │
         │                     ├─► Step 2: Assessment
         │                     │   └─ cases[] (is_signal/confidence)
         │                     │
         │                     ├─► Step 3: Expert Validation
         │                     │   └─ cases[] (validation_status)
         │                     │
         │                     └─► Step 4: Scenario Integration
         │                         └─ strategic_alerts[]
         │                         └─ run.status = "completed"
         │
         ▼
    ┌─────────────────────────────┐
    │ GET /api/workflow/{run_id}  │ ◄─ Poll every 1-2 sec
    │ (Frontend polls for updates)│
    └──────────────┬──────────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │ Display Timeline &   │
         │ Cases Table (Live)   │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────────┐
         │ User Reviews Cases       │
         │ (Signal/Noise + Sources) │
         └──────────┬───────────────┘
                    │
         ┌──────────┴──────────────┐
         │                         │
         ▼                         ▼
    [Change is_signal]      [Add Comment]
    [Correct Title]         [Send Review]
    [Correct Rationale]            │
         │                         │
         └──────────┬──────────────┘
                    │
                    ▼
         ┌──────────────────────────────┐
         │ PUT /api/cases/{case_id}/    │
         │ review                       │
         └──────────┬───────────────────┘
                    │
                    ▼
         ┌──────────────────────────────┐
         │ Backend Updates Case         │
         │ • Validate input             │
         │ • Update case status         │
         │ • Log audit event            │
         │ • Persist to state.json      │
         └──────────┬───────────────────┘
                    │
                    ▼
         ┌──────────────────────────────┐
         │ Frontend Refreshes Case      │
         │ (Show updated state)         │
         └──────────┬───────────────────┘
                    │
        ┌───────────┴─────────────┐
        │                         │
        ▼                         ▼
    [More Cases?]           [Export / Done]
    [Review Next]
        │                         │
        └──────────┬──────────────┘
                   │
                  END
```

---

## Fehlerbehandlung & Fallbacks

```
╔════════════════════════════════════════════════════════════════════════╗
║                     ROBUSTNESS & FALLBACK MODES                        ║
╚════════════════════════════════════════════════════════════════════════╝

CREWAI LLM MISSING (no OPENAI_API_KEY set)
──────────────────────────────────────────
• Scanning: Uses deterministic mock sources → ✓ Works
• Assessment: Heuristic confidence calculation → ✓ Works
• Expert: Static validation logic → ✓ Works
• Scenario: Alerts via filtering → ✓ Works
• CrewAI summary: Skipped, logged as "Fallback mode"
→ System fully functional without LLM


INVALID SEARCH TERMS
───────────────────
• Non-empty validation on save
• Empty terms rejected: HTTP 400
• Frontend prevents submission


CASE NOT FOUND
──────────────
• GET /cases/{invalid_id} → HTTP 404
• PUT /cases/{invalid_id}/review → HTTP 404


MALFORMED JSON
──────────────
• POST /api/workflow/start with bad JSON → HTTP 400
• Pydantic validation error → descriptive message


CONCURRENT REQUESTS
────────────────────
• State file is overwritten (last-write-wins)
• Acceptable for prototype
• Production: Add database + transactional locking


FRONTEND NETWORK ERROR
──────────────────────
• Backend unreachable → Show error message
• User can retry manually
• No automatic recovery yet
```

---

## Erweiterungen (Future Roadmap)

```
╔════════════════════════════════════════════════════════════════════════╗
║                           ROADMAP                                      ║
╚════════════════════════════════════════════════════════════════════════╝

KURZ (Next Sprint)
──────────────────
□ Real Web Search Integration (Tavily / SerpAPI)
  └─ Replace deterministic mock sources

□ WebSocket Live Updates
  └─ Replace polling in frontend

□ Database Migration (PostgreSQL / SQLite)
  └─ Replace JSON file persistence

□ Bulk Case Operations
  └─ Mark multiple as reviewed

□ Export to CSV / PDF
  └─ Strategic alert report


MITTEL (Q3 2026)
────────────────
□ n8n Workflow Integration
  └─ Trigger via HTTP node, receive webhook callback

□ Email / Slack Notifications
  └─ Alert stakeholders on new strategic signals

□ Historical Run Comparison
  └─ Track signal evolution over time

□ Advanced Filtering
  └─ By ansoff_level, confidence, keyword

□ Custom Agents
  └─ User-defined domain-specific prompt injection


LANG (Q4 2026+)
───────────────
□ Multi-Language Support
  └─ Scanning in EN/DE/FR

□ Real-time Collaboration
  └─ Multiple reviewers per run

□ ML Model Training
  └─ Learn from human corrections

□ Visualization Dashboard
  └─ Charts: Signal trends, confidence distribution

□ API Rate Limiting & Auth
  └─ JWT tokens, quota management
```

---

**Erzeugt:** 2026-06-16  
**Workflow System:** CrewAI (Python/FastAPI) + Next.js Frontend  
**Status:** Prototype, Fully Functional  
