"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  RunListResponse,
  RunSummary,
  SignalCase,
  WorkflowResponse,
  WorkflowRun,
  WorkflowStep,
} from "../lib/types";

interface CaseEditState {
  is_signal: boolean;
  comment: string;
  corrected_title: string;
  corrected_rationale: string;
}

interface LlmHealth {
  ok: boolean;
  status: string;
  model?: string;
  api_key_present?: boolean;
  detail?: string;
  at?: string;
}

function statusPillClass(status: string): string {
  if (status === "done" || status === "completed" || status === "validated") return "pill ok";
  if (status === "running" || status === "pending") return "pill warn";
  if (status === "failed" || status === "rejected") return "pill bad";
  return "pill neutral";
}

function formatTime(iso?: string): string {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "–";
  }
}

function stepCrewSummary(step: WorkflowStep): string | null {
  const crewai = (step.detail as { crewai?: { summary?: string } }).crewai;
  return crewai?.summary || null;
}

function stepUsedCrewai(step: WorkflowStep): boolean | null {
  const crewai = (step.detail as { crewai?: { enabled?: boolean } }).crewai;
  if (crewai === undefined) return null;
  return crewai.enabled === true;
}

function stepIsStreaming(step: WorkflowStep): boolean {
  const crewai = (step.detail as { crewai?: { streaming?: boolean } }).crewai;
  return crewai?.streaming === true && step.status !== "done";
}

interface AssessmentProgress {
  progress?: { classified: number; total: number };
  llm_classified?: number;
  heuristic_classified?: number;
  signal_count?: number;
  noise_count?: number;
}

function stepProgressInfo(step: WorkflowStep): AssessmentProgress | null {
  const d = step.detail as AssessmentProgress;
  if (!d || (!d.progress && d.llm_classified === undefined)) return null;
  return d;
}

export default function HomePage() {
  const [termsText, setTermsText] = useState("");
  const [focus, setFocus] = useState(
    "Weak signals in the energy economy with impact on policy, security, and sustainability.",
  );
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [cases, setCases] = useState<SignalCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [caseEdits, setCaseEdits] = useState<Record<string, CaseEditState>>({});
  const [llmHealth, setLlmHealth] = useState<LlmHealth | null>(null);
  const [llmChecking, setLlmChecking] = useState(false);
  const [runList, setRunList] = useState<RunSummary[]>([]);

  useEffect(() => {
    void loadTerms();
    void checkLlmHealth();
    void loadRunList();
  }, []);

  async function loadRunList(): Promise<void> {
    try {
      const response = await fetch("/api/workflow?limit=15", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as RunListResponse;
      if (data.ok) setRunList(data.runs);
    } catch {
      // ignore transient errors
    }
  }

  async function resetHistory(): Promise<void> {
    if (!window.confirm("Wirklich die gesamte Run History loeschen? Diese Aktion kann nicht rueckgaengig gemacht werden.")) {
      return;
    }
    await performReset(false);
  }

  async function performReset(force: boolean): Promise<void> {
    try {
      const url = force ? "/api/workflow?force=true" : "/api/workflow";
      const response = await fetch(url, { method: "DELETE" });
      const data = (await response.json()) as { ok?: boolean; detail?: string; deleted_runs?: number };

      if (response.status === 409 && !force) {
        const proceed = window.confirm(
          (data.detail || "Es laufen Runs.") +
            "\n\nWahrscheinlich verwaiste Runs aus alten Sessions. Trotzdem alles loeschen?",
        );
        if (proceed) {
          await performReset(true);
        }
        return;
      }

      if (!response.ok || !data.ok) {
        setMessage(data.detail || "Reset fehlgeschlagen.");
        return;
      }
      setRun(null);
      setCases([]);
      setRunList([]);
      setMessage(`History geloescht (${data.deleted_runs} Runs).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset fehlgeschlagen.");
    }
  }

  async function loadRun(runId: string): Promise<void> {
    setMessage(`Lade Run ${runId} …`);
    const response = await fetch(`/api/workflow/${runId}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage(`Run ${runId} konnte nicht geladen werden.`);
      return;
    }
    const data = (await response.json()) as WorkflowResponse;
    if (data.ok) {
      setRun(data.run);
      setCases(data.cases || []);
      setMessage(`Run ${runId} geladen.`);
    }
  }

  async function loadTerms(): Promise<void> {
    const response = await fetch("/api/config/search-terms", { cache: "no-store" });
    const data = (await response.json()) as { search_terms: string[] };
    setTermsText((data.search_terms || []).join(", "));
  }

  async function checkLlmHealth(): Promise<void> {
    setLlmChecking(true);
    try {
      const response = await fetch("/api/llm-health", { cache: "no-store" });
      const data = (await response.json()) as LlmHealth;
      setLlmHealth(data);
    } catch (error) {
      setLlmHealth({
        ok: false,
        status: "request_failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLlmChecking(false);
    }
  }

  function parsedTerms(): string[] {
    return termsText.split(",").map((term) => term.trim()).filter(Boolean);
  }

  async function saveTerms(): Promise<void> {
    const search_terms = parsedTerms();
    const response = await fetch("/api/config/search-terms", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search_terms }),
    });
    setMessage(response.ok ? "Suchbegriffe gespeichert." : "Fehler beim Speichern.");
  }

  async function startWorkflow(): Promise<void> {
    setLoading(true);
    setMessage("Workflow gestartet — Live-Updates folgen …");
    try {
      const response = await fetch("/api/workflow/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search_terms: parsedTerms(), focus }),
      });
      const data = (await response.json()) as WorkflowResponse;
      if (!response.ok || !data.ok) {
        setMessage("Workflow konnte nicht gestartet werden.");
        setLoading(false);
        return;
      }
      setRun(data.run);
      setCases(data.cases || []);
      void loadRunList();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Start fehlgeschlagen.");
      setLoading(false);
    }
  }

  async function refreshRun(): Promise<void> {
    if (!run) return;
    const response = await fetch(`/api/workflow/${run.run_id}`, { cache: "no-store" });
    const data = (await response.json()) as WorkflowResponse;
    if (response.ok && data.ok) {
      setRun(data.run);
      setCases(data.cases || []);
      setMessage("Daten aktualisiert.");
    }
  }

  // Live polling while the run is still in progress
  useEffect(() => {
    if (!run || run.status !== "running") {
      if (loading && run && run.status !== "running") {
        setLoading(false);
        setMessage(
          run.status === "completed"
            ? `Run ${run.run_id} abgeschlossen.`
            : `Run ${run.run_id} ${run.status}.`,
        );
        void checkLlmHealth();
        void loadRunList();
      }
      return;
    }

    let cancelled = false;
    let tick = 0;
    const intervalId = window.setInterval(async () => {
      tick += 1;
      try {
        const response = await fetch(`/api/workflow/${run.run_id}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as WorkflowResponse;
        if (cancelled) return;
        if (data.ok) {
          setRun(data.run);
          setCases(data.cases || []);
        }
        if (tick % 4 === 0) void loadRunList();
      } catch {
        // swallow transient polling errors
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.run_id, run?.status]);

  function editForCase(item: SignalCase): CaseEditState {
    return (
      caseEdits[item.case_id] || {
        is_signal: item.is_signal,
        comment: item.reviewer_comment || "",
        corrected_title: "",
        corrected_rationale: "",
      }
    );
  }

  function updateCaseEdit(caseId: string, patch: Partial<CaseEditState>): void {
    setCaseEdits((prev) => {
      const current = prev[caseId] || {
        is_signal: true,
        comment: "",
        corrected_title: "",
        corrected_rationale: "",
      };
      return { ...prev, [caseId]: { ...current, ...patch } };
    });
  }

  async function submitCaseReview(item: SignalCase): Promise<void> {
    const state = editForCase(item);
    const response = await fetch(`/api/cases/${item.case_id}/review`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...state, reviewer: "frontend.reviewer" }),
    });
    if (!response.ok) {
      setMessage(`Review für ${item.case_id} fehlgeschlagen.`);
      return;
    }
    setMessage(`Review für ${item.case_id} gespeichert.`);
    await refreshRun();
  }

  const summary = useMemo(() => run?.summary || {}, [run]);
  const llmPillClass = !llmHealth ? "pill neutral" : llmHealth.ok ? "pill ok" : "pill bad";
  const llmPillLabel = llmChecking
    ? "prüft …"
    : !llmHealth
    ? "unbekannt"
    : llmHealth.ok
    ? "LLM live"
    : `Fallback`;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-dot" />
            <div>
              <div className="brand-title">Foresight Workflow Console</div>
              <div className="brand-sub">CrewAI Multi-Agent · Energie-Weak-Signals</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              className={llmPillClass}
              title={llmHealth?.detail || ""}
              style={{ cursor: "help" }}
            >
              <span className="dot" />
              {llmPillLabel}
            </span>
            <span className="kbd" title={llmHealth?.model}>{llmHealth?.model?.split("/").pop() || "—"}</span>
            <button className="ghost" onClick={() => void checkLlmHealth()} disabled={llmChecking} type="button">
              ↻
            </button>
          </div>
        </div>
      </header>

      <main className="fade-up">
        {/* Konfiguration + Run Übersicht */}
        <section className="grid two">
          <article className="surface">
            <div className="surface-header">
              <h2>Konfiguration</h2>
              <span className="meta">{parsedTerms().length} Begriffe</span>
            </div>

            <label>
              Suchbegriffe (komma-getrennt)
              <textarea
                rows={3}
                value={termsText}
                onChange={(event) => setTermsText(event.target.value)}
                placeholder="hydrogen import germany, energy storage solid state battery"
              />
            </label>

            <label>
              Strategischer Fokus
              <textarea rows={2} value={focus} onChange={(event) => setFocus(event.target.value)} />
            </label>

            <div className="btn-row">
              <button onClick={() => void saveTerms()} type="button">
                Begriffe speichern
              </button>
              <button className="primary" onClick={() => void startWorkflow()} type="button" disabled={loading}>
                {loading ? "Läuft …" : "Workflow starten"}
              </button>
              <button onClick={() => void refreshRun()} type="button" disabled={!run}>
                Aktualisieren
              </button>
            </div>

            {message ? <div className="toast">{message}</div> : null}
          </article>

          <article className="surface">
            <div className="surface-header">
              <h2>Run Übersicht</h2>
              {run ? <span className={statusPillClass(run.status)}>{run.status}</span> : null}
            </div>

            {!run ? (
              <div className="empty">Noch kein Run gestartet.</div>
            ) : (
              <>
                <div className="grid four">
                  <div className="kpi">
                    <div className="kpi-label">Cases</div>
                    <div className="kpi-value">{summary.cases_total || 0}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Signale</div>
                    <div className="kpi-value" style={{ color: "var(--ok)" }}>{summary.signals || 0}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Noise</div>
                    <div className="kpi-value" style={{ color: "var(--ink-faint)" }}>{summary.noise || 0}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Validiert</div>
                    <div className="kpi-value" style={{ color: "var(--accent)" }}>{summary.validated_signals || 0}</div>
                  </div>
                </div>

                <div className="divider" />

                <div style={{ display: "grid", gap: "0.35rem", fontSize: "0.8rem", color: "var(--ink-soft)", marginTop: "auto" }}>
                  <div><span className="kbd">{run.run_id}</span></div>
                  <div>Gestartet {formatTime(run.created_at)} · {new Date(run.created_at).toLocaleDateString("de-DE")}</div>
                  <div
                    title={run.focus}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                      maxWidth: "100%",
                    }}
                  >
                    Fokus: {run.focus}
                  </div>
                </div>
              </>
            )}
          </article>
        </section>

        {/* Run History */}
        <section className="surface">
          <div className="surface-header">
            <h2>Run History</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="meta">{runList.length} Runs</span>
              <button className="ghost" type="button" onClick={() => void loadRunList()} title="Liste neu laden">
                ↻
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => void resetHistory()}
                disabled={runList.length === 0}
                title="Alle Runs und Cases loeschen"
                style={{ color: "var(--bad)" }}
              >
                Reset
              </button>
            </div>
          </div>

          {runList.length === 0 ? (
            <div className="empty">Noch keine Runs gespeichert.</div>
          ) : (
            <div className="run-list">
              {runList.map((item) => {
                const isActive = run?.run_id === item.run_id;
                const signals = Number(item.summary?.signals || 0);
                const total = Number(item.summary?.cases_total || 0);
                const validated = Number(item.summary?.validated_signals || 0);
                return (
                  <button
                    key={item.run_id}
                    type="button"
                    className={`run-item${isActive ? " active" : ""}`}
                    onClick={() => void loadRun(item.run_id)}
                  >
                    <div className="run-item-head">
                      <span className="kbd">{item.run_id.replace("run_", "").slice(0, 17)}</span>
                      <span className={statusPillClass(item.status)}>{item.status}</span>
                    </div>
                    <div className="run-item-meta">
                      {formatTime(item.created_at)} · {new Date(item.created_at).toLocaleDateString("de-DE")}
                    </div>
                    <div className="run-item-stats">
                      <span>
                        <strong style={{ color: "var(--ok)" }}>{signals}</strong>
                        <span className="meta"> Signale</span>
                      </span>
                      <span>
                        <strong>{total}</strong>
                        <span className="meta"> Cases</span>
                      </span>
                      <span>
                        <strong style={{ color: "var(--accent)" }}>{validated}</strong>
                        <span className="meta"> validiert</span>
                      </span>
                    </div>
                    <div className="run-item-terms" title={item.search_terms.join(", ")}>
                      {item.search_terms.slice(0, 3).join(", ")}
                      {item.search_terms.length > 3 ? ` +${item.search_terms.length - 3}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Workflow Schritte */}
        <section className="surface">
          <div className="surface-header">
            <h2>Workflow Schritte</h2>
            <span className="meta">{run?.steps?.length || 0} Schritte</span>
          </div>

          {!run || run.steps.length === 0 ? (
            <div className="empty">Nach dem Start erscheinen hier alle Stages mit Live-Status.</div>
          ) : (
            <div className="timeline">
              {run.steps.map((step) => {
                const usedLlm = stepUsedCrewai(step);
                const summaryText = stepCrewSummary(step);
                const progress = stepProgressInfo(step);
                const isStreaming = stepIsStreaming(step);
                const pct = progress?.progress && progress.progress.total > 0
                  ? Math.round((progress.progress.classified / progress.progress.total) * 100)
                  : null;
                return (
                  <div key={step.name} className={`step ${step.status}`}>
                    <div className="step-head">
                      <div className="step-name">{step.name.replace(/_/g, " ")}</div>
                      <div className="step-pills">
                        {isStreaming ? (
                          <span className="pill warn streaming-pill" title="LLM streamt gerade Tokens">
                            <span className="dot streaming-dot" />
                            streaming
                          </span>
                        ) : null}
                        {usedLlm === null ? null : (
                          <span className={usedLlm ? "pill ok" : "pill warn"} title={usedLlm ? "LLM hat diesen Schritt verarbeitet" : "Heuristik-Fallback verwendet"}>
                            {usedLlm ? "LLM" : "Fallback"}
                          </span>
                        )}
                        <span className={statusPillClass(step.status)}>{step.status}</span>
                      </div>
                    </div>
                    <div className="step-meta">
                      {formatTime(step.started_at)} → {formatTime(step.finished_at)}
                    </div>

                    {progress ? (
                      <div style={{ marginTop: "0.55rem" }}>
                        {progress.progress ? (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                              <span>Klassifiziert</span>
                              <span>{progress.progress.classified} / {progress.progress.total}{pct !== null ? ` · ${pct}%` : ""}</span>
                            </div>
                            <div style={{ height: 4, background: "var(--surface-muted)", borderRadius: 999, overflow: "hidden", marginTop: 4 }}>
                              <div style={{ height: "100%", width: `${pct ?? 0}%`, background: "var(--accent)", transition: "width 300ms ease" }} />
                            </div>
                          </div>
                        ) : null}
                        {(progress.llm_classified !== undefined || progress.heuristic_classified !== undefined) ? (
                          <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                            {progress.llm_classified !== undefined ? (
                              <span className="pill ok" title="durch LLM klassifiziert">LLM · {progress.llm_classified}</span>
                            ) : null}
                            {progress.heuristic_classified !== undefined && progress.heuristic_classified > 0 ? (
                              <span className="pill warn" title="Heuristik-Fallback verwendet">Heuristik · {progress.heuristic_classified}</span>
                            ) : null}
                            {progress.signal_count !== undefined ? (
                              <span className="pill neutral">Signale · {progress.signal_count}</span>
                            ) : null}
                            {progress.noise_count !== undefined ? (
                              <span className="pill neutral">Noise · {progress.noise_count}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {summaryText ? (
                      <div className={`step-summary${isStreaming ? " step-summary-streaming" : ""}`}>
                        {summaryText}
                      </div>
                    ) : null}
                    <details className="step-detail">
                      <summary>Rohdetails</summary>
                      <pre>{JSON.stringify(step.detail, null, 2)}</pre>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Cases */}
        <section className="surface">
          <div className="surface-header">
            <h2>Signal / Noise Review</h2>
            <span className="meta">{cases.length} Cases</span>
          </div>

          {cases.length === 0 ? (
            <div className="empty">Noch keine Cases vorhanden.</div>
          ) : (
            <div className="case-grid">
              {cases.map((item) => {
                const edit = editForCase(item);
                return (
                  <article key={item.case_id} className="case">
                    <div className="case-head">
                      <div>
                        <div className="case-title">{item.title}</div>
                        <div className="case-meta">
                          <span>Keyword: {item.keyword}</span>
                          <span>Confidence: {Math.round(item.confidence * 100)}%</span>
                          <span>Ansoff L{item.ansoff_level}</span>
                          <span className="kbd">{item.case_id}</span>
                        </div>
                      </div>
                      <div className="case-pills">
                        <span className={item.is_signal ? "pill ok" : "pill neutral"}>
                          {item.is_signal ? "Signal" : "Noise"}
                        </span>
                        <span className={statusPillClass(item.validation_status)}>{item.validation_status}</span>
                      </div>
                    </div>

                    <p className="case-rationale">{item.rationale}</p>
                    {item.expert_comment ? (
                      <p className="meta" style={{ marginTop: "0.4rem" }}>Expert: {item.expert_comment}</p>
                    ) : null}

                    <div className="case-body">
                      <div>
                        <div className="meta" style={{ marginBottom: "0.4rem", fontWeight: 600 }}>Quellen</div>
                        <ul className="source-list">
                          {item.sources.map((source, index) => (
                            <li key={`${item.case_id}_${index}`}>
                              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                              <div className="source-meta">{source.snippet}</div>
                              <div className="source-meta">
                                Trust {source.trust_score} · {source.published_at || "—"}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="review-form">
                        <div className="meta" style={{ marginBottom: "0.4rem", fontWeight: 600 }}>Korrektur</div>
                        <label>
                          Klassifikation
                          <select
                            value={edit.is_signal ? "signal" : "noise"}
                            onChange={(event) =>
                              updateCaseEdit(item.case_id, { is_signal: event.target.value === "signal" })
                            }
                          >
                            <option value="signal">Signal</option>
                            <option value="noise">Noise</option>
                          </select>
                        </label>
                        <label>
                          Kommentar
                          <textarea
                            rows={2}
                            value={edit.comment}
                            onChange={(event) => updateCaseEdit(item.case_id, { comment: event.target.value })}
                          />
                        </label>
                        <label>
                          Titel überschreiben (optional)
                          <input
                            value={edit.corrected_title}
                            onChange={(event) =>
                              updateCaseEdit(item.case_id, { corrected_title: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Begründung überschreiben (optional)
                          <textarea
                            rows={2}
                            value={edit.corrected_rationale}
                            onChange={(event) =>
                              updateCaseEdit(item.case_id, { corrected_rationale: event.target.value })
                            }
                          />
                        </label>
                        <div className="btn-row">
                          <button className="primary" type="button" onClick={() => void submitCaseReview(item)}>
                            Speichern
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
