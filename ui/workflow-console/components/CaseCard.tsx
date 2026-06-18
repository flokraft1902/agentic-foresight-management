import type { SignalCase } from "../lib/types";
import { statusPillClass } from "../lib/stepHelpers";
import {
  ANSOFF_DESC,
  CONFIDENCE_DESC,
  EXPERT_LABEL_DESC,
  EXPERT_VALID_DESC,
  HISTORY_PILL_DESC,
  IMPACT_DESC,
  PESTEL_DESC,
  SIGNAL_DESC,
  TIME_HORIZON_DESC,
  VALIDATION_STATUS_DESC,
  ZIELDREIECK_DESC,
  ZIELDREIECK_LABEL,
} from "../lib/labels";

export interface CaseEditState {
  is_signal: boolean;
  comment: string;
  corrected_title: string;
  corrected_rationale: string;
}

interface Props {
  item: SignalCase;
  edit: CaseEditState;
  onOpenDetail: (caseId: string) => void;
  onChangeEdit: (caseId: string, patch: Partial<CaseEditState>) => void;
  onSubmitReview: (item: SignalCase) => void;
}

export function CaseCard({ item, edit, onOpenDetail, onChangeEdit, onSubmitReview }: Props) {
  const needsReview = item.validation_status === "awaiting_review";

  return (
    <article className={`case${needsReview ? " awaiting" : ""}`}>
      <div className="case-head">
        <div>
          <button
            type="button"
            className="case-title case-title-button"
            onClick={() => onOpenDetail(item.case_id)}
            title="Vollansicht öffnen"
          >
            {item.title}
          </button>
          <div className="case-meta">
            <span
              data-tip={`Suchbegriff aus der Konfiguration, der diesen Case erzeugt hat: "${item.keyword}"`}
            >
              Keyword: {item.keyword}
            </span>
            <span data-tip={CONFIDENCE_DESC}>
              Confidence: {Math.round(item.confidence * 100)}%
            </span>
            <span data-tip={`Ansoff L${item.ansoff_level}: ${ANSOFF_DESC[item.ansoff_level] || "—"}`}>
              Ansoff L{item.ansoff_level}
            </span>
            <span
              className="kbd"
              data-tip="Eindeutige Case-ID — wird im Export und in der Run-History referenziert"
            >
              {item.case_id}
            </span>
          </div>
        </div>
        <div className="case-pills">
          {item.seen_count && item.seen_count > 1 ? (
            <span
              className="pill neutral history-pill"
              data-tip={`${HISTORY_PILL_DESC}\nGesehen in ${item.seen_count} Runs seit ${
                item.first_seen_at
                  ? new Date(item.first_seen_at).toLocaleDateString("de-DE")
                  : "?"
              }`}
            >
              ↻ {item.seen_count}× seit{" "}
              {item.first_seen_at
                ? new Date(item.first_seen_at).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                  })
                : "?"}
            </span>
          ) : null}
          {item.pestel_category ? (
            <span
              className="pill neutral"
              data-tip={`PESTEL: ${PESTEL_DESC[item.pestel_category] || item.pestel_category}`}
            >
              {item.pestel_category}
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
        </div>
      </div>

      {item.zieldreieck_dimensions && item.zieldreieck_dimensions.length > 0 ? (
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
          {item.zieldreieck_dimensions.map((d) => (
            <span
              key={d}
              className="pill neutral"
              style={{ fontSize: "0.7rem" }}
              data-tip={`Zieldreieck §1 EnWG: ${ZIELDREIECK_DESC[d] || ZIELDREIECK_LABEL[d] || d}`}
            >
              {ZIELDREIECK_LABEL[d] || d}
            </span>
          ))}
        </div>
      ) : null}

      <p className="case-rationale">{item.rationale}</p>

      {item.expert_comment ||
      item.systemic_impact ||
      item.time_horizon ||
      (item.zieldreieck_impact && Object.keys(item.zieldreieck_impact).length > 0) ? (
        <div className="expert-block">
          <div className="expert-pills">
            <span className="expert-label" data-tip={EXPERT_LABEL_DESC}>
              Energy Expert
            </span>
            {item.expert_valid === false ? (
              <span className="pill bad" data-tip={EXPERT_VALID_DESC.no}>
                unplausibel
              </span>
            ) : item.expert_valid === true ? (
              <span className="pill ok" data-tip={EXPERT_VALID_DESC.yes}>
                plausibel
              </span>
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
          </div>

          {item.expert_comment ? (
            <p className="meta" style={{ marginTop: "0.35rem" }}>
              {item.expert_comment}
            </p>
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
          <div className="meta" style={{ marginBottom: "0.4rem", fontWeight: 600 }}>
            Quellen
          </div>
          <ul className="source-list">
            {item.sources.map((source, index) => (
              <li key={`${item.case_id}_${index}`}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
                <div className="source-meta">{source.snippet}</div>
                <div className="source-meta">
                  Trust {source.trust_score} · {source.published_at || "—"}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="review-form">
          <div className="meta" style={{ marginBottom: "0.4rem", fontWeight: 600 }}>
            Korrektur
          </div>
          <label>
            Klassifikation
            <select
              value={edit.is_signal ? "signal" : "noise"}
              onChange={(event) =>
                onChangeEdit(item.case_id, { is_signal: event.target.value === "signal" })
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
              onChange={(event) => onChangeEdit(item.case_id, { comment: event.target.value })}
            />
          </label>
          <label>
            Titel überschreiben (optional)
            <input
              value={edit.corrected_title}
              onChange={(event) =>
                onChangeEdit(item.case_id, { corrected_title: event.target.value })
              }
            />
          </label>
          <label>
            Begründung überschreiben (optional)
            <textarea
              rows={2}
              value={edit.corrected_rationale}
              onChange={(event) =>
                onChangeEdit(item.case_id, { corrected_rationale: event.target.value })
              }
            />
          </label>
          <div className="btn-row">
            <button className="primary" type="button" onClick={() => onSubmitReview(item)}>
              Speichern
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
