"use client";

import { useEffect, useMemo, useState } from "react";
import type { SignalCase, WorkflowResponse, WorkflowRun } from "../lib/types";

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

function statusBadgeClass(status: string): string {
  if (status === "done" || status === "completed" || status === "validated") return "badge ok";
  if (status === "running" || status === "pending") return "badge warn";
  return "badge bad";
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

  useEffect(() => {
    void loadTerms();
    void checkLlmHealth();
  }, []);

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

  function llmBadgeClass(): string {
    if (!llmHealth) return "badge warn";
    return llmHealth.ok ? "badge ok" : "badge bad";
  }

  function llmBadgeLabel(): string {
    if (llmChecking) return "pruefe...";
    if (!llmHealth) return "unbekannt";
    if (llmHealth.ok) return "LLM live";
    return `Fallback (${llmHealth.status})`;
  }

  async function loadTerms(): Promise<void> {
    const response = await fetch("/api/config/search-terms", { cache: "no-store" });
    const data = (await response.json()) as { search_terms: string[] };
    setTermsText((data.search_terms || []).join(", "));
  }

  function parsedTerms(): string[] {
    return termsText
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
  }

  async function saveTerms(): Promise<void> {
    const search_terms = parsedTerms();
    const response = await fetch("/api/config/search-terms", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search_terms }),
    });
    if (!response.ok) {
      setMessage("Fehler beim Speichern der Suchbegriffe.");
      return;
    }
    setMessage("Suchbegriffe gespeichert.");
  }

  async function startWorkflow(): Promise<void> {
    setLoading(true);
    setMessage("Workflow wird gestartet...");
    try {
      const response = await fetch("/api/workflow/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search_terms: parsedTerms(), focus }),
      });
      const data = (await response.json()) as WorkflowResponse;
      if (!response.ok || !data.ok) {
        setMessage("Workflow konnte nicht gestartet werden.");
        return;
      }
      setRun(data.run);
      setCases(data.cases || []);
      setMessage(`Workflow abgeschlossen. Run-ID: ${data.run.run_id}`);
      void checkLlmHealth();
    } finally {
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
      return {
        ...prev,
        [caseId]: {
          ...current,
          ...patch,
        },
      };
    });
  }

  async function submitCaseReview(item: SignalCase): Promise<void> {
    const state = editForCase(item);
    const response = await fetch(`/api/cases/${item.case_id}/review`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...state,
        reviewer: "frontend.reviewer",
      }),
    });

    if (!response.ok) {
      setMessage(`Review fuer ${item.case_id} konnte nicht gespeichert werden.`);
      return;
    }

    setMessage(`Review fuer ${item.case_id} gespeichert.`);
    await refreshRun();
  }

  const summary = useMemo(() => run?.summary || {}, [run]);

  return (
    <main className="grid" style={{ gap: "1rem", paddingTop: "1.2rem", paddingBottom: "3rem" }}>
      <section className="card fade-up">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Foresight Workflow Console</h1>
            <p className="meta" style={{ marginTop: 0 }}>
              End-to-end Steuerung fuer das CrewAI Multi-Agenten-System mit transparenter Prozessansicht,
              aenderbaren Suchbegriffen, Human-Review von Signal/Noise und Quellennachweisen.
            </p>
          </div>
          <div
            className="card"
            style={{ minWidth: "240px", padding: "0.6rem 0.8rem" }}
            title={llmHealth?.detail || ""}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "space-between" }}>
              <strong>LLM Status</strong>
              <span className={llmBadgeClass()}>{llmBadgeLabel()}</span>
            </div>
            <div className="meta" style={{ marginTop: "0.3rem" }}>
              Model: {llmHealth?.model || "-"}
            </div>
            <div className="meta">
              API Key: {llmHealth?.api_key_present ? "gesetzt" : "fehlt"}
            </div>
            {llmHealth?.detail ? (
              <div className="meta" style={{ marginTop: "0.3rem", wordBreak: "break-word" }}>
                {llmHealth.detail.length > 140 ? `${llmHealth.detail.slice(0, 140)}...` : llmHealth.detail}
              </div>
            ) : null}
            <button
              type="button"
              className="secondary"
              style={{ marginTop: "0.5rem", width: "100%" }}
              onClick={() => void checkLlmHealth()}
              disabled={llmChecking}
            >
              {llmChecking ? "pruefe..." : "Erneut pruefen"}
            </button>
          </div>
        </div>
        {message ? <p className="meta" style={{ marginBottom: 0 }}>{message}</p> : null}
      </section>

      <section className="grid two">
        <article className="card fade-up">
          <h2 style={{ marginTop: 0 }}>Workflow Konfiguration</h2>
          <label>
            Suchoberbegriffe (komma-getrennt)
            <textarea
              rows={4}
              value={termsText}
              onChange={(event) => setTermsText(event.target.value)}
              placeholder="hydrogen import germany, energy storage solid state battery"
            />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
            <button className="secondary" onClick={() => void saveTerms()} type="button">
              Suchbegriffe speichern
            </button>
          </div>

          <label style={{ marginTop: "0.8rem", display: "block" }}>
            Strategischer Fokus
            <textarea rows={3} value={focus} onChange={(event) => setFocus(event.target.value)} />
          </label>

          <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.8rem", flexWrap: "wrap" }}>
            <button className="primary" onClick={() => void startWorkflow()} type="button" disabled={loading}>
              {loading ? "Workflow laeuft..." : "Workflow starten"}
            </button>
            <button onClick={() => void refreshRun()} type="button" disabled={!run}>
              Letzten Run aktualisieren
            </button>
          </div>
        </article>

        <article className="card fade-up">
          <h2 style={{ marginTop: 0 }}>Run Uebersicht</h2>
          {!run ? (
            <p className="meta">Noch kein Run gestartet.</p>
          ) : (
            <div className="grid" style={{ gap: "0.5rem" }}>
              <div><strong>Run:</strong> {run.run_id}</div>
              <div><strong>Status:</strong> <span className={statusBadgeClass(run.status)}>{run.status}</span></div>
              <div><strong>Erstellt:</strong> {new Date(run.created_at).toLocaleString("de-DE")}</div>
              <div><strong>Fokus:</strong> {run.focus}</div>
              <div className="grid three" style={{ marginTop: "0.4rem" }}>
                <div className="card">
                  <div className="meta">Cases</div>
                  <strong>{summary.cases_total || 0}</strong>
                </div>
                <div className="card">
                  <div className="meta">Signale</div>
                  <strong>{summary.signals || 0}</strong>
                </div>
                <div className="card">
                  <div className="meta">Noise</div>
                  <strong>{summary.noise || 0}</strong>
                </div>
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="card fade-up">
        <h2 style={{ marginTop: 0 }}>Transparente Workflow Schritte</h2>
        {!run || run.steps.length === 0 ? (
          <p className="meta">Nach dem Start werden hier alle Schritte mit Details angezeigt.</p>
        ) : (
          <div className="timeline">
            {run.steps.map((step) => {
              const crewInfo = (step.detail as { crewai?: { enabled?: boolean } }).crewai;
              const usedCrewai = crewInfo?.enabled === true;
              return (
                <article key={step.name} className={`step ${step.status}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                    <strong>{step.name}</strong>
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                      <span
                        className={crewInfo === undefined ? "badge warn" : usedCrewai ? "badge ok" : "badge bad"}
                        title={usedCrewai ? "LLM wurde fuer diesen Schritt aufgerufen" : "Fallback-Heuristik, kein LLM-Call"}
                      >
                        {crewInfo === undefined ? "LLM: n/a" : usedCrewai ? "LLM live" : "LLM fallback"}
                      </span>
                      <span className={statusBadgeClass(step.status)}>{step.status}</span>
                    </div>
                  </div>
                  <p className="meta" style={{ marginBottom: "0.3rem" }}>
                    Start: {step.started_at ? new Date(step.started_at).toLocaleString("de-DE") : "-"} | Ende: {step.finished_at ? new Date(step.finished_at).toLocaleString("de-DE") : "-"}
                  </p>
                  <pre style={{ margin: 0 }}>{JSON.stringify(step.detail, null, 2)}</pre>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card fade-up">
        <h2 style={{ marginTop: 0 }}>Signal vs Noise Review mit Nachweisen</h2>
        {cases.length === 0 ? (
          <p className="meta">Noch keine Cases vorhanden.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Klassifikation</th>
                  <th>Begruendung und Quellen</th>
                  <th>Korrektur</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => {
                  const edit = editForCase(item);
                  return (
                    <tr key={item.case_id}>
                      <td>
                        <strong>{item.title}</strong>
                        <div className="meta">{item.case_id}</div>
                        <div className="meta">Keyword: {item.keyword}</div>
                        <div className="meta">Confidence: {item.confidence}</div>
                        <div className="meta">Validation: {item.validation_status}</div>
                      </td>
                      <td>
                        <div>
                          System: <span className={statusBadgeClass(item.is_signal ? "validated" : "rejected")}>{item.is_signal ? "Signal" : "Noise"}</span>
                        </div>
                        <p style={{ marginBottom: "0.4rem" }}>{item.rationale}</p>
                        <div className="meta">Expert: {item.expert_comment || "-"}</div>
                      </td>
                      <td>
                        <ul className="source-list">
                          {item.sources.map((source, index) => (
                            <li key={`${item.case_id}_${index}`}>
                              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                              <div className="meta">{source.snippet}</div>
                              <div className="meta">
                                Trust: {source.trust_score} | Published: {source.published_at || "-"}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <label>
                          Zielklassifikation
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
                          Korrigierter Titel (optional)
                          <input
                            value={edit.corrected_title}
                            onChange={(event) =>
                              updateCaseEdit(item.case_id, { corrected_title: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Korrigierte Begruendung (optional)
                          <textarea
                            rows={2}
                            value={edit.corrected_rationale}
                            onChange={(event) =>
                              updateCaseEdit(item.case_id, { corrected_rationale: event.target.value })
                            }
                          />
                        </label>
                        <button type="button" onClick={() => void submitCaseReview(item)}>
                          Korrektur speichern
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
