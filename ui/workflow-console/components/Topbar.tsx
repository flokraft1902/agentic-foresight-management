export interface LlmHealth {
  ok: boolean;
  status: string;
  model?: string;
  api_key_present?: boolean;
  detail?: string;
  at?: string;
}

interface Props {
  llmHealth: LlmHealth | null;
  llmChecking: boolean;
  onCheckHealth: () => void;
}

export function Topbar({ llmHealth, llmChecking, onCheckHealth }: Props) {
  const pillClass = !llmHealth ? "pill neutral" : llmHealth.ok ? "pill ok" : "pill bad";
  const pillLabel = llmChecking
    ? "prüft …"
    : !llmHealth
    ? "unbekannt"
    : llmHealth.ok
    ? "LLM live"
    : "Fallback";

  return (
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
            className={pillClass}
            title={llmHealth?.detail || ""}
            style={{ cursor: "help" }}
          >
            <span className="dot" />
            {pillLabel}
          </span>
          <span className="kbd" title={llmHealth?.model}>
            {llmHealth?.model?.split("/").pop() || "—"}
          </span>
          <button className="ghost" onClick={onCheckHealth} disabled={llmChecking} type="button">
            ↻
          </button>
        </div>
      </div>
    </header>
  );
}
