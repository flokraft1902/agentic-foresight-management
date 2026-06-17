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
  if (status === "running" || status === "pending" || status === "awaiting_review") return "pill warn";
  if (status === "failed" || status === "rejected") return "pill bad";
  return "pill neutral";
}

const PESTEL_LABEL: Record<string, string> = {
  P: "Political",
  E: "Economic",
  S: "Social",
  T: "Technological",
  En: "Environmental",
  L: "Legal",
};

const ZIELDREIECK_LABEL: Record<string, string> = {
  wirtschaftlichkeit: "Wirtschaftlichkeit",
  versorgungssicherheit: "Versorgungssicherheit",
  umweltvertraeglichkeit: "Umweltverträglichkeit",
};

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

interface StepProgress {
  label: string;            // e.g. "Klassifiziert" or "Validiert"
  done: number;
  total: number;
  llm: number | null;
  heuristic: number | null;
  extras: { label: string; count: number; tone: "ok" | "warn" | "neutral" | "bad" }[];
}

function stepProgressInfo(step: WorkflowStep): StepProgress | null {
  const d = step.detail as Record<string, unknown>;
  if (!d) return null;
  const prog = d.progress as { classified?: number; validated?: number; total?: number } | undefined;

  // Assessment step
  if (prog?.classified !== undefined || d.llm_classified !== undefined) {
    const extras: StepProgress["extras"] = [];
    if (typeof d.signal_count === "number") extras.push({ label: "Signale", count: d.signal_count, tone: "neutral" });
    if (typeof d.noise_count === "number") extras.push({ label: "Noise", count: d.noise_count, tone: "neutral" });
    return {
      label: "Klassifiziert",
      done: prog?.classified ?? 0,
      total: prog?.total ?? 0,
      llm: typeof d.llm_classified === "number" ? d.llm_classified : null,
      heuristic: typeof d.heuristic_classified === "number" ? d.heuristic_classified : null,
      extras,
    };
  }

  // Expert validation step
  if (prog?.validated !== undefined || d.llm_validated !== undefined) {
    const extras: StepProgress["extras"] = [];
    if (typeof d.validated_count === "number") extras.push({ label: "Validiert", count: d.validated_count, tone: "ok" });
    if (typeof d.awaiting_review_count === "number" && d.awaiting_review_count > 0)
      extras.push({ label: "Review nötig", count: d.awaiting_review_count, tone: "warn" });
    if (typeof d.rejected_count === "number" && d.rejected_count > 0)
      extras.push({ label: "Rejected", count: d.rejected_count, tone: "neutral" });
    if (typeof d.domain_rejected === "number" && d.domain_rejected > 0)
      extras.push({ label: "Domain-rejected", count: d.domain_rejected, tone: "bad" });
    return {
      label: "Validiert",
      done: prog?.validated ?? 0,
      total: prog?.total ?? 0,
      llm: typeof d.llm_validated === "number" ? d.llm_validated : null,
      heuristic: typeof d.heuristic_validated === "number" ? d.heuristic_validated : null,
      extras,
    };
  }

  return null;
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
  const [caseFilter, setCaseFilter] = useState<"all" | "awaiting_review" | "validated" | "rejected">("all");
  const [caseSearch, setCaseSearch] = useState("");

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

  async function resumeWorkflow(): Promise<void> {
    if (!run) return;
    setMessage("Workflow wird fortgesetzt …");
    try {
      const response = await fetch(`/api/workflow/${run.run_id}/resume`, { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !data.ok) {
        setMessage(data.detail || "Resume fehlgeschlagen.");
        return;
      }
      setLoading(true);
      await refreshRun();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Resume fehlgeschlagen.");
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
        if (run.status === "awaiting_review") {
          const awaiting = Number(run.summary?.awaiting_review || 0);
          setMessage(
            awaiting > 0
              ? `Workflow pausiert: ${awaiting} Cases warten auf Review.`
              : "Workflow pausiert, wartet auf Review.",
          );
        } else {
          setMessage(
            run.status === "completed"
              ? `Run ${run.run_id} abgeschlossen.`
              : `Run ${run.run_id} ${run.status}.`,
          );
        }
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

  const caseCounts = useMemo(() => {
    const c = { all: cases.length, awaiting_review: 0, validated: 0, rejected: 0 };
    for (const item of cases) {
      if (item.validation_status === "awaiting_review") c.awaiting_review += 1;
      else if (item.validation_status === "validated") c.validated += 1;
      else if (item.validation_status === "rejected") c.rejected += 1;
    }
    return c;
  }, [cases]);

  const filteredCases = useMemo(() => {
    const search = caseSearch.trim().toLowerCase();
    const matchesStatus = (item: SignalCase) =>
      caseFilter === "all" || item.validation_status === caseFilter;
    const matchesSearch = (item: SignalCase) => {
      if (!search) return true;
      const haystack = `${item.title} ${item.rationale} ${item.keyword} ${item.expert_comment || ""}`.toLowerCase();
      return haystack.includes(search);
    };

    const priority = (status: string) => {
      if (status === "awaiting_review") return 0;
      if (status === "pending") return 1;
      if (status === "validated") return 2;
      return 3; // rejected
    };

    return cases
      .filter((item) => matchesStatus(item) && matchesSearch(item))
      .sort((a, b) => {
        const p = priority(a.validation_status) - priority(b.validation_status);
        if (p !== 0) return p;
        return b.confidence - a.confidence;
      });
  }, [cases, caseFilter, caseSearch]);
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

        {/* HITL Banner */}
        {run && run.status === "awaiting_review" ? (() => {
          const stillAwaiting = cases.filter((c) => c.validation_status === "awaiting_review").length;
          return (
            <section className="surface hitl-banner">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <strong style={{ fontSize: "1rem" }}>Workflow pausiert für Human Review</strong>
                  <div className="meta" style={{ marginTop: "0.3rem" }}>
                    {stillAwaiting > 0
                      ? `${stillAwaiting} Cases warten auf deine Entscheidung. Approve oder reject jeden Case unten, dann fortfahren.`
                      : "Alle Cases entschieden — du kannst den Scenario-Step jetzt starten."}
                  </div>
                </div>
                <button
                  className="primary"
                  type="button"
                  onClick={() => void resumeWorkflow()}
                  disabled={stillAwaiting > 0}
                  title={stillAwaiting > 0 ? "Erst alle pending Cases reviewen" : "Scenario-Step starten"}
                >
                  Workflow fortsetzen
                </button>
              </div>
            </section>
          );
        })() : null}

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
                const pct = progress && progress.total > 0
                  ? Math.round((progress.done / progress.total) * 100)
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
                        {progress.total > 0 ? (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                              <span>{progress.label}</span>
                              <span>{progress.done} / {progress.total}{pct !== null ? ` · ${pct}%` : ""}</span>
                            </div>
                            <div style={{ height: 4, background: "var(--surface-muted)", borderRadius: 999, overflow: "hidden", marginTop: 4 }}>
                              <div style={{ height: "100%", width: `${pct ?? 0}%`, background: "var(--accent)", transition: "width 300ms ease" }} />
                            </div>
                          </div>
                        ) : null}
                        {(progress.llm !== null || progress.heuristic !== null || progress.extras.length > 0) ? (
                          <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                            {progress.llm !== null ? (
                              <span className="pill ok" title="durch LLM verarbeitet">LLM · {progress.llm}</span>
                            ) : null}
                            {progress.heuristic !== null && progress.heuristic > 0 ? (
                              <span className="pill warn" title="Heuristik-Fallback verwendet">Heuristik · {progress.heuristic}</span>
                            ) : null}
                            {progress.extras.map((extra) => (
                              <span key={extra.label} className={`pill ${extra.tone}`}>
                                {extra.label} · {extra.count}
                              </span>
                            ))}
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
            <span className="meta">
              {filteredCases.length === cases.length
                ? `${cases.length} Cases`
                : `${filteredCases.length} von ${cases.length} Cases`}
            </span>
          </div>

          {cases.length === 0 ? (
            <div className="empty">Noch keine Cases vorhanden.</div>
          ) : (
            <>
              <div className="case-filter-bar">
                <div className="case-filter-chips">
                  {([
                    { id: "all", label: "Alle", count: caseCounts.all, accent: "neutral" as const },
                    { id: "awaiting_review", label: "Review nötig", count: caseCounts.awaiting_review, accent: "warn" as const },
                    { id: "validated", label: "Validiert", count: caseCounts.validated, accent: "ok" as const },
                    { id: "rejected", label: "Rejected", count: caseCounts.rejected, accent: "bad" as const },
                  ] as const).map((chip) => {
                    const active = caseFilter === chip.id;
                    const hot = chip.id === "awaiting_review" && chip.count > 0;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        className={`filter-chip ${chip.accent}${active ? " active" : ""}${hot ? " hot" : ""}`}
                        onClick={() => setCaseFilter(chip.id)}
                      >
                        {chip.label}
                        <span className="filter-chip-count">{chip.count}</span>
                      </button>
                    );
                  })}
                </div>
                <input
                  type="search"
                  placeholder="Suche in Titel, Begründung, Keyword …"
                  value={caseSearch}
                  onChange={(event) => setCaseSearch(event.target.value)}
                  className="case-search"
                />
              </div>

              {filteredCases.length === 0 ? (
                <div className="empty">Keine Cases passen zum Filter.</div>
              ) : (
                <div className="case-grid">
                  {filteredCases.map((item) => {
                    const edit = editForCase(item);
                    const needsReview = item.validation_status === "awaiting_review";
                    return (
                      <article key={item.case_id} className={`case${needsReview ? " awaiting" : ""}`}>
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
                        {item.pestel_category ? (
                          <span className="pill neutral" title={PESTEL_LABEL[item.pestel_category]}>
                            {item.pestel_category}
                          </span>
                        ) : null}
                        <span className={item.is_signal ? "pill ok" : "pill neutral"}>
                          {item.is_signal ? "Signal" : "Noise"}
                        </span>
                        <span className={statusPillClass(item.validation_status)}>{item.validation_status}</span>
                      </div>
                    </div>

                    {item.zieldreieck_dimensions && item.zieldreieck_dimensions.length > 0 ? (
                      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                        {item.zieldreieck_dimensions.map((d) => (
                          <span key={d} className="pill neutral" style={{ fontSize: "0.7rem" }}>
                            {ZIELDREIECK_LABEL[d] || d}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <p className="case-rationale">{item.rationale}</p>

                    {item.expert_comment || item.systemic_impact || item.time_horizon || (item.zieldreieck_impact && Object.keys(item.zieldreieck_impact).length > 0) ? (
                      <div className="expert-block">
                        <div className="expert-pills">
                          <span className="expert-label">Energy Expert</span>
                          {item.expert_valid === false ? (
                            <span className="pill bad" title="Domain-Validität verworfen">unplausibel</span>
                          ) : item.expert_valid === true ? (
                            <span className="pill ok" title="Domain-Validität bestätigt">plausibel</span>
                          ) : null}
                          {item.systemic_impact ? (
                            <span
                              className={
                                item.systemic_impact === "HOCH"
                                  ? "pill warn"
                                  : item.systemic_impact === "GERING"
                                  ? "pill neutral"
                                  : "pill neutral"
                              }
                              title="Systemischer Impact auf das Energiesystem"
                            >
                              Impact: {item.systemic_impact}
                            </span>
                          ) : null}
                          {item.time_horizon ? (
                            <span className="pill neutral" title="Geschätzter Zeithorizont">
                              {item.time_horizon}
                            </span>
                          ) : null}
                        </div>

                        {item.expert_comment ? (
                          <p className="meta" style={{ marginTop: "0.35rem" }}>{item.expert_comment}</p>
                        ) : null}

                        {item.zieldreieck_impact && Object.keys(item.zieldreieck_impact).length > 0 ? (
                          <details className="zd-impact">
                            <summary>Zieldreieck-Impact ({Object.keys(item.zieldreieck_impact).length})</summary>
                            <dl>
                              {Object.entries(item.zieldreieck_impact).map(([dim, text]) => (
                                <div key={dim} className="zd-row">
                                  <dt>{ZIELDREIECK_LABEL[dim] || dim}</dt>
                                  <dd>{text}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        ) : null}
                      </div>
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
            </>
          )}
        </section>
      </main>
    </>
  );
}
