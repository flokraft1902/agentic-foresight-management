import type { RunSummary, WorkflowRun } from "../lib/types";
import { formatTime, statusPillClass } from "../lib/stepHelpers";

interface Props {
  runList: RunSummary[];
  activeRun: WorkflowRun | null;
  onSelectRun: (runId: string) => void;
  onReload: () => void;
  onReset: () => void;
}

export function RunHistoryCard({
  runList,
  activeRun,
  onSelectRun,
  onReload,
  onReset,
}: Props) {
  return (
    <section className="surface">
      <div className="surface-header">
        <h2>Run History</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span className="meta">{runList.length} Runs</span>
          <button className="ghost" type="button" onClick={onReload} title="Liste neu laden">
            ↻
          </button>
          <button
            className="ghost"
            type="button"
            onClick={onReset}
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
            const isActive = activeRun?.run_id === item.run_id;
            const signals = Number(item.summary?.signals || 0);
            const total = Number(item.summary?.cases_total || 0);
            const validated = Number(item.summary?.validated_signals || 0);
            return (
              <button
                key={item.run_id}
                type="button"
                className={`run-item${isActive ? " active" : ""}`}
                onClick={() => onSelectRun(item.run_id)}
              >
                <div className="run-item-head">
                  <span className="kbd">{item.run_id.replace("run_", "").slice(0, 17)}</span>
                  <span className={statusPillClass(item.status)}>{item.status}</span>
                </div>
                <div className="run-item-meta">
                  {formatTime(item.created_at)} ·{" "}
                  {new Date(item.created_at).toLocaleDateString("de-DE")}
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
  );
}
