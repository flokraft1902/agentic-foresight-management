import type { WorkflowRun } from "../lib/types";
import {
  formatTime,
  statusPillClass,
  stepCrewSummary,
  stepIsStreaming,
  stepProgressInfo,
  stepUsedCrewai,
} from "../lib/stepHelpers";
import { renderStageSummary } from "../lib/renderStageSummary";

interface Props {
  run: WorkflowRun | null;
}

export function WorkflowTimeline({ run }: Props) {
  return (
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
            const pct =
              progress && progress.total > 0
                ? Math.round((progress.done / progress.total) * 100)
                : null;
            return (
              <div key={step.name} className={`step ${step.status}`}>
                <div className="step-head">
                  <div className="step-name">{step.name.replace(/_/g, " ")}</div>
                  <div className="step-pills">
                    {isStreaming ? (
                      <span
                        className="pill warn streaming-pill"
                        title="LLM streamt gerade Tokens"
                      >
                        <span className="dot streaming-dot" />
                        streaming
                      </span>
                    ) : null}
                    {usedLlm === null ? null : (
                      <span
                        className={usedLlm ? "pill ok" : "pill warn"}
                        title={
                          usedLlm
                            ? "LLM hat diesen Schritt verarbeitet"
                            : "Heuristik-Fallback verwendet"
                        }
                      >
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
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "0.75rem",
                            color: "var(--ink-soft)",
                          }}
                        >
                          <span>{progress.label}</span>
                          <span>
                            {progress.done} / {progress.total}
                            {pct !== null ? ` · ${pct}%` : ""}
                          </span>
                        </div>
                        <div
                          style={{
                            height: 4,
                            background: "var(--surface-muted)",
                            borderRadius: 999,
                            overflow: "hidden",
                            marginTop: 4,
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${pct ?? 0}%`,
                              background: "var(--accent)",
                              transition: "width 300ms ease",
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {progress.llm !== null ||
                    progress.heuristic !== null ||
                    progress.extras.length > 0 ? (
                      <div
                        style={{
                          marginTop: "0.4rem",
                          display: "flex",
                          gap: "0.4rem",
                          flexWrap: "wrap",
                        }}
                      >
                        {progress.llm !== null ? (
                          <span className="pill ok" title="durch LLM verarbeitet">
                            LLM · {progress.llm}
                          </span>
                        ) : null}
                        {progress.heuristic !== null && progress.heuristic > 0 ? (
                          <span className="pill warn" title="Heuristik-Fallback verwendet">
                            Heuristik · {progress.heuristic}
                          </span>
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

                {summaryText || isStreaming ? (
                  <div className="step-summary-block">
                    <div className="step-summary-eyebrow">
                      <span className="step-summary-dot" />
                      <span>Agent Summary</span>
                      {isStreaming ? (
                        <span className="step-summary-eyebrow-streaming">· streaming</span>
                      ) : null}
                    </div>
                    <div
                      className={`step-summary${isStreaming ? " step-summary-streaming" : ""}`}
                    >
                      {renderStageSummary(summaryText)}
                    </div>
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
  );
}
