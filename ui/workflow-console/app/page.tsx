"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  RunListResponse,
  RunSummary,
  SignalCase,
  WorkflowResponse,
  WorkflowRun,
} from "../lib/types";
import { exportReport } from "../lib/exportReport";
import { PESTEL_LABEL, ZIELDREIECK_LABEL } from "../lib/labels";
import { useTooltip } from "../lib/useTooltip";
import { Topbar, type LlmHealth } from "../components/Topbar";
import { ConfigCard } from "../components/ConfigCard";
import { RunOverviewCard } from "../components/RunOverviewCard";
import { HitlBanner } from "../components/HitlBanner";
import { RunHistoryCard } from "../components/RunHistoryCard";
import { WorkflowTimeline } from "../components/WorkflowTimeline";
import { AnalyseCharts } from "../components/AnalyseCharts";
import { TrendChart } from "../components/TrendChart";
import { CasesSection, type CaseFilter } from "../components/CasesSection";
import type { CaseEditState } from "../components/CaseCard";
import { CaseModal } from "../components/CaseModal";
import { CustomTooltip } from "../components/CustomTooltip";

export default function HomePage() {
  const [termsText, setTermsText] = useState("");
  const [focus, setFocus] = useState(
    "Weak signals in the energy economy with impact on policy, security, and sustainability.",
  );
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [cases, setCases] = useState<SignalCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [caseEdits, setCaseEdits] = useState<Record<string, CaseEditState>>({});
  const [llmHealth, setLlmHealth] = useState<LlmHealth | null>(null);
  const [llmChecking, setLlmChecking] = useState(false);
  const [runList, setRunList] = useState<RunSummary[]>([]);
  const [caseFilter, setCaseFilter] = useState<CaseFilter>("all");
  const [caseSearch, setCaseSearch] = useState("");
  const [detailCaseId, setDetailCaseId] = useState<string | null>(null);
  const tooltip = useTooltip();

  // Initial load
  useEffect(() => {
    void loadTerms();
    void checkLlmHealth();
    void loadRunList();
  }, []);

  // ESC closes the case-detail modal
  useEffect(() => {
    if (!detailCaseId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailCaseId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailCaseId]);

  // Auto-scroll any streaming step-summary container to its bottom whenever
  // the run updates (new tokens just landed).
  useEffect(() => {
    if (!run) return;
    const containers = document.querySelectorAll<HTMLElement>(".step-summary-streaming");
    containers.forEach((el) => {
      el.scrollTop = el.scrollHeight;
    });
  }, [run]);

  // Live polling while a run is in progress
  useEffect(() => {
    if (!run || run.status !== "running") {
      if (loading && run && run.status !== "running") {
        setLoading(false);
        if (run.status === "awaiting_review") {
          const awaiting = Number(run.summary?.awaiting_review || 0);
          setMessage(
            awaiting > 0
              ? `Workflow pausiert: ${awaiting} Cases warten auf Review.`
              : "Workflow pausiert, wartet auf Review.",
          );
        } else {
          setMessage(
            run.status === "completed"
              ? `Run ${run.run_id} abgeschlossen.`
              : `Run ${run.run_id} ${run.status}.`,
          );
        }
        void checkLlmHealth();
        void loadRunList();
      }
      return;
    }

    let cancelled = false;
    let tick = 0;
    const intervalId = window.setInterval(async () => {
      tick += 1;
      try {
        const response = await fetch(`/api/workflow/${run.run_id}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as WorkflowResponse;
        if (cancelled) return;
        if (data.ok) {
          setRun(data.run);
          setCases(data.cases || []);
        }
        if (tick % 8 === 0) void loadRunList();
      } catch {
        // swallow transient polling errors
      }
    }, 750);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.run_id, run?.status]);

  // === Data-fetching helpers ===

  async function loadRunList(): Promise<void> {
    try {
      const response = await fetch("/api/workflow?limit=15", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as RunListResponse;
      if (data.ok) setRunList(data.runs);
    } catch {
      // ignore transient errors
    }
  }

  async function resetHistory(): Promise<void> {
    if (
      !window.confirm(
        "Wirklich die gesamte Run History loeschen? Diese Aktion kann nicht rueckgaengig gemacht werden.",
      )
    ) {
      return;
    }
    await performReset(false);
  }

  async function performReset(force: boolean): Promise<void> {
    try {
      const url = force ? "/api/workflow?force=true" : "/api/workflow";
      const response = await fetch(url, { method: "DELETE" });
      const data = (await response.json()) as {
        ok?: boolean;
        detail?: string;
        deleted_runs?: number;
      };

      if (response.status === 409 && !force) {
        const proceed = window.confirm(
          (data.detail || "Es laufen Runs.") +
            "\n\nWahrscheinlich verwaiste Runs aus alten Sessions. Trotzdem alles loeschen?",
        );
        if (proceed) {
          await performReset(true);
        }
        return;
      }

      if (!response.ok || !data.ok) {
        setMessage(data.detail || "Reset fehlgeschlagen.");
        return;
      }
      setRun(null);
      setCases([]);
      setRunList([]);
      setMessage(`History geloescht (${data.deleted_runs} Runs).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset fehlgeschlagen.");
    }
  }

  async function loadRun(runId: string): Promise<void> {
    setMessage(`Lade Run ${runId} …`);
    const response = await fetch(`/api/workflow/${runId}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage(`Run ${runId} konnte nicht geladen werden.`);
      return;
    }
    const data = (await response.json()) as WorkflowResponse;
    if (data.ok) {
      setRun(data.run);
      setCases(data.cases || []);
      setMessage(`Run ${runId} geladen.`);
    }
  }

  async function loadTerms(): Promise<void> {
    const response = await fetch("/api/config/search-terms", { cache: "no-store" });
    const data = (await response.json()) as { search_terms: string[] };
    setTermsText((data.search_terms || []).join(", "));
  }

  async function checkLlmHealth(): Promise<void> {
    setLlmChecking(true);
    try {
      const response = await fetch("/api/llm-health", { cache: "no-store" });
      const data = (await response.json()) as LlmHealth;
      setLlmHealth(data);
    } catch (error) {
      setLlmHealth({
        ok: false,
        status: "request_failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLlmChecking(false);
    }
  }

  function parsedTerms(): string[] {
    return termsText.split(",").map((term) => term.trim()).filter(Boolean);
  }

  async function saveTerms(): Promise<void> {
    const search_terms = parsedTerms();
    const response = await fetch("/api/config/search-terms", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search_terms }),
    });
    setMessage(response.ok ? "Suchbegriffe gespeichert." : "Fehler beim Speichern.");
  }

  async function startWorkflow(): Promise<void> {
    setLoading(true);
    setMessage("Workflow gestartet — Live-Updates folgen …");
    try {
      const response = await fetch("/api/workflow/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search_terms: parsedTerms(), focus }),
      });
      const data = (await response.json()) as WorkflowResponse;
      if (!response.ok || !data.ok) {
        setMessage("Workflow konnte nicht gestartet werden.");
        setLoading(false);
        return;
      }
      setRun(data.run);
      setCases(data.cases || []);
      void loadRunList();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Start fehlgeschlagen.");
      setLoading(false);
    }
  }

  async function resumeWorkflow(): Promise<void> {
    if (!run) return;
    setMessage("Workflow wird fortgesetzt …");
    try {
      const response = await fetch(`/api/workflow/${run.run_id}/resume`, { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; detail?: string };
      if (response.status === 409) {
        // Most likely a duplicate click — the workflow has already moved past
        // the HITL gate. Refresh local state so the UI reflects reality.
        await refreshRun();
        const detail = data.detail || "";
        if (detail.includes("'completed'")) {
          setMessage("Workflow wurde bereits abgeschlossen — kein Resume nötig.");
        } else if (detail.includes("'running'")) {
          setMessage("Workflow läuft bereits — Status-Update folgt automatisch.");
        } else {
          setMessage(detail || "Resume nicht möglich.");
        }
        return;
      }
      if (!response.ok || !data.ok) {
        setMessage(data.detail || "Resume fehlgeschlagen.");
        return;
      }
      setLoading(true);
      await refreshRun();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Resume fehlgeschlagen.");
    }
  }

  async function refreshRun(): Promise<void> {
    if (!run) return;
    const response = await fetch(`/api/workflow/${run.run_id}`, { cache: "no-store" });
    const data = (await response.json()) as WorkflowResponse;
    if (response.ok && data.ok) {
      setRun(data.run);
      setCases(data.cases || []);
      setMessage("Daten aktualisiert.");
    }
  }

  // === Case review helpers ===

  function editForCase(item: SignalCase): CaseEditState {
    return (
      caseEdits[item.case_id] || {
        is_signal: item.is_signal,
        comment: item.reviewer_comment || "",
        corrected_title: "",
        corrected_rationale: "",
      }
    );
  }

  function updateCaseEdit(caseId: string, patch: Partial<CaseEditState>): void {
    setCaseEdits((prev) => {
      const current = prev[caseId] || {
        is_signal: true,
        comment: "",
        corrected_title: "",
        corrected_rationale: "",
      };
      return { ...prev, [caseId]: { ...current, ...patch } };
    });
  }

  async function submitCaseReview(item: SignalCase): Promise<void> {
    const state = editForCase(item);
    const response = await fetch(`/api/cases/${item.case_id}/review`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...state, reviewer: "frontend.reviewer" }),
    });
    if (!response.ok) {
      setMessage(`Review für ${item.case_id} fehlgeschlagen.`);
      return;
    }
    setMessage(`Review für ${item.case_id} gespeichert.`);
    await refreshRun();
  }

  // === Derived data ===

  const caseCounts = useMemo(() => {
    const c = { all: cases.length, awaiting_review: 0, validated: 0, rejected: 0 };
    for (const item of cases) {
      if (item.validation_status === "awaiting_review") c.awaiting_review += 1;
      else if (item.validation_status === "validated") c.validated += 1;
      else if (item.validation_status === "rejected") c.rejected += 1;
    }
    return c;
  }, [cases]);

  const pestelCounts = useMemo(() => {
    const keys: Array<"P" | "E" | "S" | "T" | "En" | "L"> = ["P", "E", "S", "T", "En", "L"];
    const c: Record<string, number> = { P: 0, E: 0, S: 0, T: 0, En: 0, L: 0, unknown: 0 };
    for (const item of cases) {
      if (item.pestel_category && keys.includes(item.pestel_category)) {
        c[item.pestel_category] += 1;
      } else {
        c.unknown += 1;
      }
    }
    return c;
  }, [cases]);

  const pestelTotal = useMemo(
    () =>
      Object.entries(pestelCounts)
        .filter(([k]) => k !== "unknown")
        .reduce((s, [, v]) => s + v, 0),
    [pestelCounts],
  );

  const ansoffCounts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const item of cases) {
      const lvl = item.ansoff_level;
      if (lvl >= 1 && lvl <= 4) c[lvl] += 1;
    }
    return c;
  }, [cases]);

  const impactCounts = useMemo(() => {
    const c: Record<string, number> = { HOCH: 0, MITTEL: 0, GERING: 0, unknown: 0 };
    for (const item of cases) {
      if (item.systemic_impact && ["HOCH", "MITTEL", "GERING"].includes(item.systemic_impact)) {
        c[item.systemic_impact] += 1;
      } else {
        c.unknown += 1;
      }
    }
    return c;
  }, [cases]);

  const zieldreieckCounts = useMemo(() => {
    const c: Record<string, number> = {
      wirtschaftlichkeit: 0,
      versorgungssicherheit: 0,
      umweltvertraeglichkeit: 0,
    };
    for (const item of cases) {
      for (const dim of item.zieldreieck_dimensions || []) {
        if (dim in c) c[dim] += 1;
      }
    }
    return c;
  }, [cases]);

  const trendData = useMemo(() => {
    return runList
      .slice()
      .reverse() // oldest first
      .filter((r) => r.status === "completed")
      .map((r) => ({
        run_id: r.run_id,
        created_at: r.created_at,
        cases: Number(r.summary?.cases_total || 0),
        signals: Number(r.summary?.signals || 0),
        validated: Number(r.summary?.validated_signals || 0),
      }));
  }, [runList]);

  const filteredCases = useMemo(() => {
    const search = caseSearch.trim().toLowerCase();
    const matchesStatus = (item: SignalCase) =>
      caseFilter === "all" || item.validation_status === caseFilter;
    const matchesSearch = (item: SignalCase) => {
      if (!search) return true;
      const haystack =
        `${item.title} ${item.rationale} ${item.keyword} ${item.expert_comment || ""}`.toLowerCase();
      return haystack.includes(search);
    };

    const priority = (status: string) => {
      if (status === "awaiting_review") return 0;
      if (status === "pending") return 1;
      if (status === "validated") return 2;
      return 3; // rejected
    };

    return cases
      .filter((item) => matchesStatus(item) && matchesSearch(item))
      .sort((a, b) => {
        const p = priority(a.validation_status) - priority(b.validation_status);
        if (p !== 0) return p;
        return b.confidence - a.confidence;
      });
  }, [cases, caseFilter, caseSearch]);

  // === Export helpers ===

  function downloadBlob(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    const str = Array.isArray(value) ? value.join("; ") : String(value);
    if (/[",;\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  }

  function exportCases(format: "csv" | "json"): void {
    if (cases.length === 0) {
      setMessage("Keine Cases zum Exportieren vorhanden.");
      return;
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const runIdPart = run ? `_${run.run_id.replace("run_", "")}` : "";
    const filename = `foresight_cases${runIdPart}_${ts}.${format}`;

    if (format === "json") {
      downloadBlob(filename, JSON.stringify(cases, null, 2), "application/json");
      setMessage(`${cases.length} Cases als JSON exportiert (${filename}).`);
      return;
    }

    const headers = [
      "case_id",
      "run_id",
      "keyword",
      "title",
      "is_signal",
      "confidence",
      "ansoff_level",
      "pestel_category",
      "zieldreieck_dimensions",
      "validation_status",
      "expert_valid",
      "systemic_impact",
      "time_horizon",
      "rationale",
      "expert_comment",
      "reviewer_comment",
      "reviewed_by",
      "reviewed_at",
      "seen_count",
      "first_seen_at",
      "source_urls",
    ];
    const lines = [headers.join(",")];
    for (const c of cases) {
      lines.push(
        [
          c.case_id,
          c.run_id,
          c.keyword,
          c.title,
          c.is_signal,
          c.confidence,
          c.ansoff_level,
          c.pestel_category ?? "",
          c.zieldreieck_dimensions ?? [],
          c.validation_status,
          c.expert_valid ?? "",
          c.systemic_impact ?? "",
          c.time_horizon ?? "",
          c.rationale,
          c.expert_comment ?? "",
          c.reviewer_comment ?? "",
          c.reviewed_by ?? "",
          c.reviewed_at ?? "",
          c.seen_count ?? "",
          c.first_seen_at ?? "",
          c.sources.map((s) => s.url).join("; "),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    downloadBlob(filename, "﻿" + lines.join("\n"), "text/csv;charset=utf-8");
    setMessage(`${cases.length} Cases als CSV exportiert (${filename}).`);
  }

  function handleExportReport(): void {
    if (!run) {
      setMessage("Kein Run geladen — bitte erst einen Run starten oder laden.");
      return;
    }
    try {
      const filename = exportReport(run, cases, {
        pestel: PESTEL_LABEL,
        zieldreieck: ZIELDREIECK_LABEL,
      });
      setMessage(`Foresight Report exportiert (${filename}).`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Report-Export fehlgeschlagen: ${error.message}`
          : "Report-Export fehlgeschlagen.",
      );
    }
  }

  const detailCase =
    detailCaseId !== null ? cases.find((c) => c.case_id === detailCaseId) || null : null;

  return (
    <>
      <Topbar
        llmHealth={llmHealth}
        llmChecking={llmChecking}
        onCheckHealth={() => void checkLlmHealth()}
      />

      <main className="fade-up">
        <section className="grid two">
          <ConfigCard
            termsText={termsText}
            onTermsTextChange={setTermsText}
            focus={focus}
            onFocusChange={setFocus}
            parsedTerms={parsedTerms()}
            run={run}
            message={message}
            loading={loading}
            onSaveTerms={() => void saveTerms()}
            onStartWorkflow={() => void startWorkflow()}
            onRefreshRun={() => void refreshRun()}
          />
          <RunOverviewCard run={run} onExportReport={handleExportReport} />
        </section>

        <HitlBanner run={run} cases={cases} onResume={resumeWorkflow} />

        <RunHistoryCard
          runList={runList}
          activeRun={run}
          onSelectRun={(runId) => void loadRun(runId)}
          onReload={() => void loadRunList()}
          onReset={() => void resetHistory()}
        />

        <WorkflowTimeline run={run} />

        <AnalyseCharts
          casesLength={cases.length}
          pestelCounts={pestelCounts}
          pestelTotal={pestelTotal}
          ansoffCounts={ansoffCounts}
          impactCounts={impactCounts}
          zieldreieckCounts={zieldreieckCounts}
          tooltip={tooltip}
        />

        <TrendChart data={trendData} tooltip={tooltip} />

        <CasesSection
          run={run}
          cases={cases}
          filteredCases={filteredCases}
          caseCounts={caseCounts}
          caseFilter={caseFilter}
          caseSearch={caseSearch}
          onCaseFilterChange={setCaseFilter}
          onCaseSearchChange={setCaseSearch}
          onExportCases={exportCases}
          onExportReport={handleExportReport}
          onOpenDetail={setDetailCaseId}
          editForCase={editForCase}
          onChangeEdit={updateCaseEdit}
          onSubmitReview={(item) => void submitCaseReview(item)}
          tooltip={tooltip}
        />
      </main>

      {detailCase ? (
        <CaseModal
          item={detailCase}
          tooltip={tooltip}
          onClose={() => setDetailCaseId(null)}
        />
      ) : null}

      <CustomTooltip tooltip={tooltip.tooltip} />
    </>
  );
}
