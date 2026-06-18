import type { SignalCase, WorkflowRun } from "../lib/types";
import type { TooltipApi } from "../lib/useTooltip";
import { CaseCard, type CaseEditState } from "./CaseCard";

export type CaseFilter = "all" | "awaiting_review" | "validated" | "rejected";

interface Props {
  run: WorkflowRun | null;
  cases: SignalCase[];
  filteredCases: SignalCase[];
  caseCounts: { all: number; awaiting_review: number; validated: number; rejected: number };
  caseFilter: CaseFilter;
  caseSearch: string;
  onCaseFilterChange: (filter: CaseFilter) => void;
  onCaseSearchChange: (search: string) => void;
  onExportCases: (format: "csv" | "json") => void;
  onExportReport: () => void;
  onOpenDetail: (caseId: string) => void;
  editForCase: (item: SignalCase) => CaseEditState;
  onChangeEdit: (caseId: string, patch: Partial<CaseEditState>) => void;
  onSubmitReview: (item: SignalCase) => void;
  tooltip: TooltipApi;
}

export function CasesSection({
  run,
  cases,
  filteredCases,
  caseCounts,
  caseFilter,
  caseSearch,
  onCaseFilterChange,
  onCaseSearchChange,
  onExportCases,
  onExportReport,
  onOpenDetail,
  editForCase,
  onChangeEdit,
  onSubmitReview,
  tooltip,
}: Props) {
  const filterChips = [
    { id: "all", label: "Alle", count: caseCounts.all, accent: "neutral" as const },
    {
      id: "awaiting_review",
      label: "Review nötig",
      count: caseCounts.awaiting_review,
      accent: "warn" as const,
    },
    { id: "validated", label: "Validiert", count: caseCounts.validated, accent: "ok" as const },
    { id: "rejected", label: "Rejected", count: caseCounts.rejected, accent: "bad" as const },
  ] as const;

  return (
    <section
      className="surface"
      onMouseMove={tooltip.onMouseMove}
      onMouseLeave={tooltip.onMouseLeave}
    >
      <div className="surface-header">
        <h2>Signal / Noise Review</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span className="meta">
            {filteredCases.length === cases.length
              ? `${cases.length} Cases`
              : `${filteredCases.length} von ${cases.length} Cases`}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => onExportCases("csv")}
            disabled={cases.length === 0}
            title="Cases als CSV exportieren (für Reports oder Übergabe an Gruppe 12)"
          >
            ↓ CSV
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onExportCases("json")}
            disabled={cases.length === 0}
            title="Cases als JSON exportieren (Datenstruktur für Gruppe 12 / Dashboard)"
          >
            ↓ JSON
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onExportReport}
            disabled={!run}
            title={
              !run
                ? "Kein Run geladen"
                : "Foresight Report als PDF herunterladen (für Präsentation / Verteidigung)"
            }
          >
            ↓ Report
          </button>
        </div>
      </div>

      {cases.length === 0 ? (
        <div className="empty">Noch keine Cases vorhanden.</div>
      ) : (
        <>
          <div className="case-filter-bar">
            <div className="case-filter-chips">
              {filterChips.map((chip) => {
                const active = caseFilter === chip.id;
                const hot = chip.id === "awaiting_review" && chip.count > 0;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    className={`filter-chip ${chip.accent}${active ? " active" : ""}${
                      hot ? " hot" : ""
                    }`}
                    onClick={() => onCaseFilterChange(chip.id)}
                  >
                    {chip.label}
                    <span className="filter-chip-count">{chip.count}</span>
                  </button>
                );
              })}
            </div>
            <input
              type="search"
              placeholder="Suche in Titel, Begründung, Keyword …"
              value={caseSearch}
              onChange={(event) => onCaseSearchChange(event.target.value)}
              className="case-search"
            />
          </div>

          {filteredCases.length === 0 ? (
            <div className="empty">Keine Cases passen zum Filter.</div>
          ) : (
            <div className="case-grid">
              {filteredCases.map((item) => (
                <CaseCard
                  key={item.case_id}
                  item={item}
                  edit={editForCase(item)}
                  onOpenDetail={onOpenDetail}
                  onChangeEdit={onChangeEdit}
                  onSubmitReview={onSubmitReview}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
