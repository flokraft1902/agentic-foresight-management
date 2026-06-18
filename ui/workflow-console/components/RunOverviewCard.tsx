import type { WorkflowRun } from "../lib/types";
import { formatTime, statusPillClass } from "../lib/stepHelpers";

interface Props {
  run: WorkflowRun | null;
  onExportReport: () => void;
}

export function RunOverviewCard({ run, onExportReport }: Props) {
  const summary = run?.summary || {};

  return (
    <article className="surface">
      <div className="surface-header">
        <h2>Run Übersicht</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {run ? <span className={statusPillClass(run.status)}>{run.status}</span> : null}
          <button
            type="button"
            className="primary"
            onClick={onExportReport}
            disabled={!run || run.status === "running"}
            title={
              !run
                ? "Kein Run geladen"
                : run.status === "running"
                ? "Run läuft noch — Report nach Abschluss exportierbar"
                : "Foresight Report als PDF herunterladen"
            }
            style={{ fontSize: "0.78rem", padding: "0.32rem 0.7rem" }}
          >
            Foresight Report
          </button>
        </div>
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
              <div className="kpi-value" style={{ color: "var(--ok)" }}>
                {summary.signals || 0}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Noise</div>
              <div className="kpi-value" style={{ color: "var(--ink-faint)" }}>
                {summary.noise || 0}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Validiert</div>
              <div className="kpi-value" style={{ color: "var(--accent)" }}>
                {summary.validated_signals || 0}
              </div>
            </div>
          </div>

          <div className="divider" />

          <div
            style={{
              display: "grid",
              gap: "0.35rem",
              fontSize: "0.8rem",
              color: "var(--ink-soft)",
              marginTop: "auto",
            }}
          >
            <div>
              <span className="kbd">{run.run_id}</span>
            </div>
            <div>
              Gestartet {formatTime(run.created_at)} ·{" "}
              {new Date(run.created_at).toLocaleDateString("de-DE")}
            </div>
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
  );
}
