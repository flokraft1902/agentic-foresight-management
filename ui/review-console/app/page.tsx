import Link from "next/link";
import { getAllCases } from "@/lib/store";

function statusClass(status: string): string {
  if (status === "approved") return "pill approved";
  if (status === "corrected") return "pill corrected";
  if (status === "rejected") return "pill rejected";
  return "pill pending";
}

export default async function HomePage() {
  const cases = await getAllCases();

  return (
    <main>
      <section className="card" style={{ marginBottom: "1rem" }}>
        <h1 style={{ marginTop: 0 }}>Foresight Review Console</h1>
        <p style={{ marginBottom: 0 }}>
          Diese Oberfläche sammelt Review-Fälle aus n8n, macht Entscheidungen nachvollziehbar
          und erlaubt Approve, Correct oder Reject mit Audit-Trail.
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Offene und entschiedene Fälle</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Agent</th>
              <th>Status</th>
              <th>Erstellt</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 ? (
              <tr>
                <td colSpan={5}>Noch keine Fälle vorhanden. n8n kann via /api/n8n/intake neue Fälle anlegen.</td>
              </tr>
            ) : (
              cases.map((entry) => (
                <tr key={entry.caseId}>
                  <td>{entry.caseId}</td>
                  <td>{entry.agentName}</td>
                  <td>
                    <span className={statusClass(entry.reviewStatus)}>{entry.reviewStatus}</span>
                  </td>
                  <td>{new Date(entry.createdAt).toLocaleString("de-DE")}</td>
                  <td>
                    <Link href={`/cases/${entry.caseId}`}>Details</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
