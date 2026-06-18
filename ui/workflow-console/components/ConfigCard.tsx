import type { WorkflowRun } from "../lib/types";

interface Props {
  termsText: string;
  onTermsTextChange: (value: string) => void;
  focus: string;
  onFocusChange: (value: string) => void;
  parsedTerms: string[];
  run: WorkflowRun | null;
  message: string;
  loading: boolean;
  onSaveTerms: () => void;
  onStartWorkflow: () => void;
  onRefreshRun: () => void;
}

export function ConfigCard({
  termsText,
  onTermsTextChange,
  focus,
  onFocusChange,
  parsedTerms,
  run,
  message,
  loading,
  onSaveTerms,
  onStartWorkflow,
  onRefreshRun,
}: Props) {
  const suggestions = (run?.suggested_search_terms || []).filter(
    (s) => !parsedTerms.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  const acceptSuggestion = (suggestion: string) => {
    if (parsedTerms.some((t) => t.toLowerCase() === suggestion.toLowerCase())) return;
    onTermsTextChange([...parsedTerms, suggestion].join(", "));
  };

  return (
    <article className="surface">
      <div className="surface-header">
        <h2>Konfiguration</h2>
        <span className="meta">{parsedTerms.length} Begriffe</span>
      </div>

      <label>
        Suchbegriffe (komma-getrennt)
        <textarea
          rows={3}
          value={termsText}
          onChange={(event) => onTermsTextChange(event.target.value)}
          placeholder="hydrogen import germany, energy storage solid state battery"
        />
      </label>

      {run?.suggested_search_terms && suggestions.length > 0 ? (
        <div className="suggestion-block">
          <div className="suggestion-label">
            Vorschläge aus Run{" "}
            <span className="kbd" style={{ fontSize: "0.7rem" }}>
              {run.run_id.replace("run_", "").slice(0, 17)}
            </span>
          </div>
          <div className="suggestion-chips">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion-chip"
                title="Klicken um diesen Begriff zu den Suchbegriffen hinzuzufügen"
                onClick={() => acceptSuggestion(suggestion)}
              >
                + {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <label>
        Strategischer Fokus
        <textarea rows={2} value={focus} onChange={(event) => onFocusChange(event.target.value)} />
      </label>

      <div className="btn-row">
        <button onClick={onSaveTerms} type="button">
          Begriffe speichern
        </button>
        <button className="primary" onClick={onStartWorkflow} type="button" disabled={loading}>
          {loading ? "Läuft …" : "Workflow starten"}
        </button>
        <button onClick={onRefreshRun} type="button" disabled={!run}>
          Aktualisieren
        </button>
      </div>

      {message ? <div className="toast">{message}</div> : null}
    </article>
  );
}
