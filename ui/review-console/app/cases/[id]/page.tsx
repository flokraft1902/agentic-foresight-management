import Link from "next/link";
import { notFound } from "next/navigation";
import { getCaseById } from "@/lib/store";

async function sendDecision(formData: FormData): Promise<void> {
  "use server";

  const caseId = String(formData.get("caseId") || "");
  const decision = String(formData.get("decision") || "");
  const reviewer = String(formData.get("reviewer") || "");
  const comment = String(formData.get("comment") || "");
  const correctedDecisionRaw = String(formData.get("correctedDecision") || "");

  const correctedDecision = correctedDecisionRaw
    ? JSON.parse(correctedDecisionRaw)
    : undefined;

  await fetch(`${process.env.REVIEW_CONSOLE_BASE_URL || "http://localhost:3000"}/api/review/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      caseId,
      decision,
      reviewer,
      comment,
      correctedDecision,
    }),
    cache: "no-store",
  });
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await getCaseById(id);
  if (!entry) notFound();

  return (
    <main>
      <p><Link href="/">Zurück zur Übersicht</Link></p>
      <section className="card" style={{ marginBottom: "1rem" }}>
        <h1 style={{ marginTop: 0 }}>Case {entry.caseId}</h1>
        <p>
          Agent: <strong>{entry.agentName}</strong> | Run: <strong>{entry.runId}</strong> | Step: <strong>{entry.stepId}</strong>
        </p>
        <p>Status: <strong>{entry.reviewStatus}</strong></p>
      </section>

      <section className="grid columns-2">
        <article className="card">
          <h2 style={{ marginTop: 0 }}>Reasoning Fields</h2>
          <pre>{JSON.stringify(entry.reasoningFields, null, 2)}</pre>
        </article>

        <article className="card">
          <h2 style={{ marginTop: 0 }}>Decision Payload</h2>
          <pre>{JSON.stringify(entry.decision, null, 2)}</pre>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Quellen</h2>
        <ul>
          {entry.sources.map((source, index) => (
            <li key={`${source.url}_${index}`}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Review Entscheidung</h2>
        <form action={sendDecision} className="grid">
          <input type="hidden" name="caseId" value={entry.caseId} />
          <label>
            Reviewer
            <input name="reviewer" defaultValue={entry.reviewer || "human.reviewer"} required />
          </label>
          <label>
            Entscheidung
            <select name="decision" defaultValue="approve" required>
              <option value="approve">Approve</option>
              <option value="correct">Correct</option>
              <option value="reject">Reject</option>
            </select>
          </label>
          <label>
            Kommentar
            <textarea name="comment" rows={3} placeholder="Begründung oder Kontext zur Entscheidung" />
          </label>
          <label>
            Korrigierte Decision (JSON, optional)
            <textarea
              name="correctedDecision"
              rows={8}
              placeholder='{"signal":true,"ansoff_level":2}'
            />
          </label>
          <button className="button primary" type="submit">Entscheidung speichern</button>
        </form>
      </section>
    </main>
  );
}
