import type { SignalCase } from "../lib/types";
import { statusPillClass } from "../lib/stepHelpers";
import {
  EXPERT_VALID_DESC,
  IMPACT_DESC,
  PESTEL_DESC,
  PESTEL_LABEL,
  SIGNAL_DESC,
  TIME_HORIZON_DESC,
  VALIDATION_STATUS_DESC,
  ZIELDREIECK_DESC,
  ZIELDREIECK_LABEL,
} from "../lib/labels";
import type { TooltipApi } from "../lib/useTooltip";

interface Props {
  item: SignalCase;
  tooltip: TooltipApi;
  onClose: () => void;
}

export function CaseModal({ item, tooltip, onClose }: Props) {
  const dims = item.zieldreieck_dimensions || [];

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      onMouseMove={tooltip.onMouseMove}
      onMouseLeave={tooltip.onMouseLeave}
    >
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-eyebrow">Case · {item.keyword}</div>
            <h2 className="modal-title">{item.title}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} title="Schließen (Esc)">
            ✕
          </button>
        </div>

        <div className="modal-meta">
          <span className="kbd">{item.case_id}</span>
          <span>Confidence: {Math.round(item.confidence * 100)}%</span>
          <span>Ansoff L{item.ansoff_level}</span>
          {item.seen_count && item.seen_count > 1 ? (
            <span>
              Wiederkehrend · {item.seen_count}× seit{" "}
              {item.first_seen_at
                ? new Date(item.first_seen_at).toLocaleDateString("de-DE")
                : "?"}
            </span>
          ) : null}
        </div>

        <div className="modal-pills">
          {item.pestel_category ? (
            <span
              className="pill neutral"
              data-tip={`PESTEL: ${PESTEL_DESC[item.pestel_category] || item.pestel_category}`}
            >
              {item.pestel_category} · {PESTEL_LABEL[item.pestel_category]}
            </span>
          ) : null}
          <span
            className={item.is_signal ? "pill ok" : "pill neutral"}
            data-tip={item.is_signal ? SIGNAL_DESC.signal : SIGNAL_DESC.noise}
          >
            {item.is_signal ? "Signal" : "Noise"}
          </span>
          <span
            className={statusPillClass(item.validation_status)}
            data-tip={VALIDATION_STATUS_DESC[item.validation_status] || item.validation_status}
          >
            {item.validation_status}
          </span>
          {item.systemic_impact ? (
            <span
              className={
                item.systemic_impact === "HOCH"
                  ? "pill warn"
                  : item.systemic_impact === "GERING"
                  ? "pill neutral"
                  : "pill neutral"
              }
              data-tip={`Systemischer Impact: ${
                IMPACT_DESC[item.systemic_impact] || item.systemic_impact
              }`}
            >
              Impact: {item.systemic_impact}
            </span>
          ) : null}
          {item.time_horizon ? (
            <span className="pill neutral" data-tip={TIME_HORIZON_DESC}>
              {item.time_horizon}
            </span>
          ) : null}
          {item.expert_valid === false ? (
            <span className="pill bad" data-tip={EXPERT_VALID_DESC.no}>
              unplausibel
            </span>
          ) : item.expert_valid === true ? (
            <span className="pill ok" data-tip={EXPERT_VALID_DESC.yes}>
              plausibel
            </span>
          ) : null}
        </div>

        {dims.length > 0 ? (
          <div className="modal-tags">
            {dims.map((d) => (
              <span
                key={d}
                className="pill neutral"
                style={{ fontSize: "0.72rem" }}
                data-tip={`Zieldreieck §1 EnWG: ${ZIELDREIECK_DESC[d] || ZIELDREIECK_LABEL[d] || d}`}
              >
                {ZIELDREIECK_LABEL[d] || d}
              </span>
            ))}
          </div>
        ) : null}

        <section className="modal-section">
          <h3>Rationale</h3>
          <p>{item.rationale}</p>
        </section>

        {item.expert_comment ||
        (item.zieldreieck_impact && Object.keys(item.zieldreieck_impact).length > 0) ? (
          <section className="modal-section">
            <h3>Energy Expert</h3>
            {item.expert_comment ? <p>{item.expert_comment}</p> : null}
            {item.zieldreieck_impact && Object.keys(item.zieldreieck_impact).length > 0 ? (
              <dl className="modal-zd">
                {Object.entries(item.zieldreieck_impact).map(([dim, text]) => (
                  <div key={dim} className="modal-zd-row">
                    <dt>{ZIELDREIECK_LABEL[dim] || dim}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ) : null}

        <section className="modal-section">
          <h3>Quellen ({item.sources.length})</h3>
          <ul className="modal-sources">
            {item.sources.map((source, index) => (
              <li key={`${item.case_id}_${index}`}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
                <div className="meta" style={{ marginTop: "0.2rem" }}>
                  {source.snippet}
                </div>
                <div className="meta">
                  Trust {source.trust_score} · {source.published_at || "—"}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {item.reviewer_comment ? (
          <section className="modal-section">
            <h3>Reviewer-Kommentar</h3>
            <p>{item.reviewer_comment}</p>
            {item.reviewed_by ? (
              <div className="meta" style={{ marginTop: "0.3rem" }}>
                {item.reviewed_by} ·{" "}
                {item.reviewed_at ? new Date(item.reviewed_at).toLocaleString("de-DE") : ""}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
