import { useState } from "react";
import type { SignalCase, WorkflowRun } from "../lib/types";

interface Props {
  run: WorkflowRun | null;
  cases: SignalCase[];
  onResume: () => Promise<void> | void;
}

export function HitlBanner({ run, cases, onResume }: Props) {
  const [resuming, setResuming] = useState(false);
  if (!run || run.status !== "awaiting_review") return null;
  const stillAwaiting = cases.filter((c) => c.validation_status === "awaiting_review").length;

  const handleResume = async () => {
    if (resuming || stillAwaiting > 0) return;
    setResuming(true);
    try {
      await onResume();
    } finally {
      // If the resume failed, allow another click. On success, the banner
      // unmounts anyway because run.status flips away from awaiting_review.
      setResuming(false);
    }
  };

  return (
    <section className="surface hitl-banner">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
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
          onClick={handleResume}
          disabled={stillAwaiting > 0 || resuming}
          title={
            stillAwaiting > 0
              ? "Erst alle pending Cases reviewen"
              : resuming
              ? "Scenario-Step läuft bereits"
              : "Scenario-Step starten"
          }
        >
          {resuming ? "Wird fortgesetzt …" : "Workflow fortsetzen"}
        </button>
      </div>
    </section>
  );
}
