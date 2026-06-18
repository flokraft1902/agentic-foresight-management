"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  RunListResponse,
  RunSummary,
  SignalCase,
  WorkflowResponse,
  WorkflowRun,
  WorkflowStep,
} from "../lib/types";

interface CaseEditState {
  is_signal: boolean;
  comment: string;
  corrected_title: string;
  corrected_rationale: string;
}

interface LlmHealth {
  ok: boolean;
  status: string;
  model?: string;
  api_key_present?: boolean;
  detail?: string;
  at?: string;
}

function statusPillClass(status: string): string {
  if (status === "done" || status === "completed" || status === "validated") return "pill ok";
  if (status === "running" || status === "pending" || status === "awaiting_review") return "pill warn";
  if (status === "failed" || status === "rejected") return "pill bad";
  return "pill neutral";
}

const PESTEL_LABEL: Record<string, string> = {
  P: "Political",
  E: "Economic",
  S: "Social",
  T: "Technological",
  En: "Environmental",
  L: "Legal",
};

const PESTEL_DESC: Record<string, string> = {
  P: "Political — Politik, Regulierung, Geopolitik (z.B. EEG-Novelle, H2-Importstrategie)",
  E: "Economic — Märkte, Preise, Kapitalkosten (z.B. Merit-Order-Spread, CO2-Preis, LCOE)",
  S: "Social — Akzeptanz, Konsumverhalten, Gerechtigkeit (z.B. Bürgerenergie, Energiearmut)",
  T: "Technological — Innovationen, Effizienzsprünge, Patente (z.B. Solid State Battery, V2G)",
  En: "Environmental — Klimawandel, Ressourcen, physische Risiken (z.B. Dürre, kritische Rohstoffe)",
  L: "Legal — Rechtsprechung, Normen, Genehmigungen (z.B. RED III, Beschleunigungsgesetz)",
};

const ANSOFF_DESC: Record<number, string> = {
  1: "Sense of Threat — vages Gefühl der Veränderung, kaum Belege",
  2: "Source Known — Quelle identifizierbar, Natur der Entwicklung unklar",
  3: "Threat Characterized — Entwicklung konkretisiert, strategische Implikationen offen",
  4: "Response Known — Reaktionsmöglichkeiten bekannt; Übergang vom Weak Signal zum Trend",
};

const IMPACT_DESC: Record<string, string> = {
  HOCH: "Hohe Wirkung — kann Merit-Order verschieben oder Kapazitätsmärkte beeinflussen",
  MITTEL: "Mittlere Wirkung — operativ relevant, kein Strukturbruch",
  GERING: "Geringe Wirkung — Tagesgeschehen ohne systemische Folgen",
};

const ZIELDREIECK_LABEL: Record<string, string> = {
  wirtschaftlichkeit: "Wirtschaftlichkeit",
  versorgungssicherheit: "Versorgungssicherheit",
  umweltvertraeglichkeit: "Umweltverträglichkeit",
};

const ZIELDREIECK_DESC: Record<string, string> = {
  wirtschaftlichkeit: "Wirtschaftlichkeit — Wettbewerbsfähigkeit, Merit-Order, LCOE, Investitionsrenditen",
  versorgungssicherheit: "Versorgungssicherheit — Gesicherte Leistung, N-1, Diversifikation, Netzstabilität",
  umweltvertraeglichkeit: "Umweltverträglichkeit — Dekarbonisierung, Treibhausgasreduktion, Nachhaltigkeit",
};

const VALIDATION_STATUS_DESC: Record<string, string> = {
  pending: "pending — Case wurde noch nicht vom Energy Expert validiert",
  awaiting_review: "awaiting_review — Expert konnte nicht eindeutig entscheiden; Human Review nötig",
  validated: "validated — Energy Expert hat den Case als domain-plausibel bestätigt",
  rejected: "rejected — Case wurde als domain-unplausibel oder irrelevant verworfen",
};

const SIGNAL_DESC = {
  signal: "Signal — Assessment-Stage hat den Case als bedeutsamen Weak Signal eingestuft (relevant für strategische Foresight)",
  noise: "Noise — Case wurde als Tagesnachricht ohne strategische Wirkung klassifiziert",
};

const TIME_HORIZON_DESC = "Geschätzter Zeithorizont der Auswirkung (z.B. <2J, 2-5J, >5J) — vom Energy-Expert-LLM beurteilt";
const EXPERT_VALID_DESC = {
  yes: "plausibel — Domain-Check bestanden: Case ist energiewirtschaftlich konsistent mit Merit-Order, Missing-Money, Netzphysik, Marktdesign",
  no: "unplausibel — Domain-Check fehlgeschlagen: Case widerspricht energiewirtschaftlichen Grundprinzipien",
};
const EXPERT_LABEL_DESC = "Energy Expert: LLM-gestützter Domain-Check pro Case (Merit-Order / Missing-Money / Kannibalisierung / Netzphysik) — siehe MAS_Foresight_Architektur §6.3";
const CONFIDENCE_DESC = "Confidence: Wie sicher die Assessment-Stage in der Signal/Noise-Klassifikation ist (0-100%)";
const HISTORY_PILL_DESC = "Diese Quelle wurde bereits in früheren Runs gefunden — Wiederkehrende URL deutet auf einen stabileren Trend hin als Einzelfundstücke";

function formatTime(iso?: string): string {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "–";
  }
}

function stepCrewSummary(step: WorkflowStep): string | null {
  const crewai = (step.detail as { crewai?: { summary?: string } }).crewai;
  return crewai?.summary || null;
}

function stepUsedCrewai(step: WorkflowStep): boolean | null {
  const crewai = (step.detail as { crewai?: { enabled?: boolean } }).crewai;
  if (crewai === undefined) return null;
  return crewai.enabled === true;
}

function stepIsStreaming(step: WorkflowStep): boolean {
  const crewai = (step.detail as { crewai?: { streaming?: boolean } }).crewai;
  return crewai?.streaming === true && step.status !== "done";
}

interface StepProgress {
  label: string;            // e.g. "Klassifiziert" or "Validiert"
  done: number;
  total: number;
  llm: number | null;
  heuristic: number | null;
  extras: { label: string; count: number; tone: "ok" | "warn" | "neutral" | "bad" }[];
}

function stepProgressInfo(step: WorkflowStep): StepProgress | null {
  const d = step.detail as Record<string, unknown>;
  if (!d) return null;
  const prog = d.progress as { classified?: number; validated?: number; total?: number } | undefined;

  // Assessment step
  if (prog?.classified !== undefined || d.llm_classified !== undefined) {
    const extras: StepProgress["extras"] = [];
    if (typeof d.signal_count === "number") extras.push({ label: "Signale", count: d.signal_count, tone: "neutral" });
    if (typeof d.noise_count === "number") extras.push({ label: "Noise", count: d.noise_count, tone: "neutral" });
    return {
      label: "Klassifiziert",
      done: prog?.classified ?? 0,
      total: prog?.total ?? 0,
      llm: typeof d.llm_classified === "number" ? d.llm_classified : null,
      heuristic: typeof d.heuristic_classified === "number" ? d.heuristic_classified : null,
      extras,
    };
  }

  // Expert validation step
  if (prog?.validated !== undefined || d.llm_validated !== undefined) {
    const extras: StepProgress["extras"] = [];
    if (typeof d.validated_count === "number") extras.push({ label: "Validiert", count: d.validated_count, tone: "ok" });
    if (typeof d.awaiting_review_count === "number" && d.awaiting_review_count > 0)
      extras.push({ label: "Review nötig", count: d.awaiting_review_count, tone: "warn" });
    if (typeof d.rejected_count === "number" && d.rejected_count > 0)
      extras.push({ label: "Rejected", count: d.rejected_count, tone: "neutral" });
    if (typeof d.domain_rejected === "number" && d.domain_rejected > 0)
      extras.push({ label: "Domain-rejected", count: d.domain_rejected, tone: "bad" });
    return {
      label: "Validiert",
      done: prog?.validated ?? 0,
      total: prog?.total ?? 0,
      llm: typeof d.llm_validated === "number" ? d.llm_validated : null,
      heuristic: typeof d.heuristic_validated === "number" ? d.heuristic_validated : null,
      extras,
    };
  }

  return null;
}

// Tiny markdown renderer for the stage summaries produced by summarize_stage().
// Handles only the syntax we actually ask the LLM to use: ## / ### headings and
// "- " / "* " bullets. Everything else becomes a paragraph. Designed to be safe
// against partial / streaming input — half-typed lines render gracefully.
function renderStageSummary(text: string | null | undefined): ReactNode {
  if (!text || !text.trim()) return null;
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let paragraph: string[] = [];
  let counter = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    blocks.push(
      <ul key={`b${counter++}`} className="stage-summary-list">
        {items.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const para = paragraph;
    blocks.push(
      <p key={`p${counter++}`} className="stage-summary-p">
        {para.join(" ")}
      </p>,
    );
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("### ")) {
      flushBullets();
      flushParagraph();
      blocks.push(
        <h5 key={`h${counter++}`} className="stage-summary-h5">
          {line.slice(4)}
        </h5>,
      );
    } else if (line.startsWith("## ")) {
      flushBullets();
      flushParagraph();
      blocks.push(
        <h4 key={`h${counter++}`} className="stage-summary-h4">
          {line.slice(3)}
        </h4>,
      );
    } else if (line.startsWith("# ")) {
      flushBullets();
      flushParagraph();
      blocks.push(
        <h4 key={`h${counter++}`} className="stage-summary-h4">
          {line.slice(2)}
        </h4>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      bullets.push(line.slice(2));
    } else if (line === "") {
      flushBullets();
      flushParagraph();
    } else {
      flushBullets();
      paragraph.push(line);
    }
  }
  flushBullets();
  flushParagraph();

  return <>{blocks}</>;
}

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
  const [caseFilter, setCaseFilter] = useState<"all" | "awaiting_review" | "validated" | "rejected">("all");
  const [caseSearch, setCaseSearch] = useState("");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [detailCaseId, setDetailCaseId] = useState<string | null>(null);

  useEffect(() => {
    void loadTerms();
    void checkLlmHealth();
    void loadRunList();
  }, []);

  useEffect(() => {
    if (!detailCaseId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailCaseId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailCaseId]);

  // Auto-scroll any streaming step-summary container to its bottom whenever
  // the run updates (new tokens just landed). Only active while streaming.
  useEffect(() => {
    if (!run) return;
    const containers = document.querySelectorAll<HTMLElement>(".step-summary-streaming");
    containers.forEach((el) => {
      el.scrollTop = el.scrollHeight;
    });
  }, [run]);

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
    if (!window.confirm("Wirklich die gesamte Run History loeschen? Diese Aktion kann nicht rueckgaengig gemacht werden.")) {
      return;
    }
    await performReset(false);
  }

  async function performReset(force: boolean): Promise<void> {
    try {
      const url = force ? "/api/workflow?force=true" : "/api/workflow";
      const response = await fetch(url, { method: "DELETE" });
      const data = (await response.json()) as { ok?: boolean; detail?: string; deleted_runs?: number };

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

  // Live polling while the run is still in progress
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
    // 750ms is fast enough to reliably catch short streaming windows
    // (Scanning/Assessment/Expert summaries finish in ~2-3s). Run-list
    // refresh stays throttled via the tick % 8 check.
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

  const summary = useMemo(() => run?.summary || {}, [run]);

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
    () => Object.entries(pestelCounts).filter(([k]) => k !== "unknown").reduce((s, [, v]) => s + v, 0),
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
    const c: Record<string, number> = { wirtschaftlichkeit: 0, versorgungssicherheit: 0, umweltvertraeglichkeit: 0 };
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
      const haystack = `${item.title} ${item.rationale} ${item.keyword} ${item.expert_comment || ""}`.toLowerCase();
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

  function handleTooltipMove(e: React.MouseEvent<HTMLElement>) {
    const target = e.target as Element | null;
    if (!target || typeof (target as Element).closest !== "function") {
      setTooltip(null);
      return;
    }
    const el = (target as Element).closest("[data-tip]");
    const tip = el?.getAttribute("data-tip");
    if (tip) {
      setTooltip({ x: e.clientX, y: e.clientY, text: tip });
    } else {
      setTooltip(null);
    }
  }

  function handleTooltipLeave() {
    setTooltip(null);
  }

  const llmPillClass = !llmHealth ? "pill neutral" : llmHealth.ok ? "pill ok" : "pill bad";
  const llmPillLabel = llmChecking
    ? "prüft …"
    : !llmHealth
    ? "unbekannt"
    : llmHealth.ok
    ? "LLM live"
    : `Fallback`;

  return (
    <>
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
              className={llmPillClass}
              title={llmHealth?.detail || ""}
              style={{ cursor: "help" }}
            >
              <span className="dot" />
              {llmPillLabel}
            </span>
            <span className="kbd" title={llmHealth?.model}>{llmHealth?.model?.split("/").pop() || "—"}</span>
            <button className="ghost" onClick={() => void checkLlmHealth()} disabled={llmChecking} type="button">
              ↻
            </button>
          </div>
        </div>
      </header>

      <main className="fade-up">
        {/* Konfiguration + Run Übersicht */}
        <section className="grid two">
          <article className="surface">
            <div className="surface-header">
              <h2>Konfiguration</h2>
              <span className="meta">{parsedTerms().length} Begriffe</span>
            </div>

            <label>
              Suchbegriffe (komma-getrennt)
              <textarea
                rows={3}
                value={termsText}
                onChange={(event) => setTermsText(event.target.value)}
                placeholder="hydrogen import germany, energy storage solid state battery"
              />
            </label>

            {run?.suggested_search_terms && run.suggested_search_terms.length > 0 ? (
              <div className="suggestion-block">
                <div className="suggestion-label">
                  Vorschläge aus Run <span className="kbd" style={{ fontSize: "0.7rem" }}>{run.run_id.replace("run_", "").slice(0, 17)}</span>
                </div>
                <div className="suggestion-chips">
                  {run.suggested_search_terms
                    .filter((s) => !parsedTerms().some((t) => t.toLowerCase() === s.toLowerCase()))
                    .map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="suggestion-chip"
                        title="Klicken um diesen Begriff zu den Suchbegriffen hinzuzufügen"
                        onClick={() => {
                          const current = parsedTerms();
                          if (current.some((t) => t.toLowerCase() === suggestion.toLowerCase())) return;
                          setTermsText([...current, suggestion].join(", "));
                        }}
                      >
                        + {suggestion}
                      </button>
                    ))}
                </div>
              </div>
            ) : null}

            <label>
              Strategischer Fokus
              <textarea rows={2} value={focus} onChange={(event) => setFocus(event.target.value)} />
            </label>

            <div className="btn-row">
              <button onClick={() => void saveTerms()} type="button">
                Begriffe speichern
              </button>
              <button className="primary" onClick={() => void startWorkflow()} type="button" disabled={loading}>
                {loading ? "Läuft …" : "Workflow starten"}
              </button>
              <button onClick={() => void refreshRun()} type="button" disabled={!run}>
                Aktualisieren
              </button>
            </div>

            {message ? <div className="toast">{message}</div> : null}
          </article>

          <article className="surface">
            <div className="surface-header">
              <h2>Run Übersicht</h2>
              {run ? <span className={statusPillClass(run.status)}>{run.status}</span> : null}
            </div>

            {!run ? (
              <div className="empty">Noch kein Run gestartet.</div>
            ) : (
              <>
                <div className="grid four">
                  <div className="kpi">
                    <div className="kpi-label">Cases</div>
                    <div className="kpi-value">{summary.cases_total || 0}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Signale</div>
                    <div className="kpi-value" style={{ color: "var(--ok)" }}>{summary.signals || 0}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Noise</div>
                    <div className="kpi-value" style={{ color: "var(--ink-faint)" }}>{summary.noise || 0}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Validiert</div>
                    <div className="kpi-value" style={{ color: "var(--accent)" }}>{summary.validated_signals || 0}</div>
                  </div>
                </div>

                <div className="divider" />

                <div style={{ display: "grid", gap: "0.35rem", fontSize: "0.8rem", color: "var(--ink-soft)", marginTop: "auto" }}>
                  <div><span className="kbd">{run.run_id}</span></div>
                  <div>Gestartet {formatTime(run.created_at)} · {new Date(run.created_at).toLocaleDateString("de-DE")}</div>
                  <div
                    title={run.focus}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                      maxWidth: "100%",
                    }}
                  >
                    Fokus: {run.focus}
                  </div>
                </div>
              </>
            )}
          </article>
        </section>

        {/* HITL Banner */}
        {run && run.status === "awaiting_review" ? (() => {
          const stillAwaiting = cases.filter((c) => c.validation_status === "awaiting_review").length;
          return (
            <section className="surface hitl-banner">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
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
                  onClick={() => void resumeWorkflow()}
                  disabled={stillAwaiting > 0}
                  title={stillAwaiting > 0 ? "Erst alle pending Cases reviewen" : "Scenario-Step starten"}
                >
                  Workflow fortsetzen
                </button>
              </div>
            </section>
          );
        })() : null}

        {/* Run History */}
        <section className="surface">
          <div className="surface-header">
            <h2>Run History</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="meta">{runList.length} Runs</span>
              <button className="ghost" type="button" onClick={() => void loadRunList()} title="Liste neu laden">
                ↻
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => void resetHistory()}
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
                const isActive = run?.run_id === item.run_id;
                const signals = Number(item.summary?.signals || 0);
                const total = Number(item.summary?.cases_total || 0);
                const validated = Number(item.summary?.validated_signals || 0);
                return (
                  <button
                    key={item.run_id}
                    type="button"
                    className={`run-item${isActive ? " active" : ""}`}
                    onClick={() => void loadRun(item.run_id)}
                  >
                    <div className="run-item-head">
                      <span className="kbd">{item.run_id.replace("run_", "").slice(0, 17)}</span>
                      <span className={statusPillClass(item.status)}>{item.status}</span>
                    </div>
                    <div className="run-item-meta">
                      {formatTime(item.created_at)} · {new Date(item.created_at).toLocaleDateString("de-DE")}
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

        {/* Workflow Schritte */}
        <section className="surface">
          <div className="surface-header">
            <h2>Workflow Schritte</h2>
            <span className="meta">{run?.steps?.length || 0} Schritte</span>
          </div>

          {!run || run.steps.length === 0 ? (
            <div className="empty">Nach dem Start erscheinen hier alle Stages mit Live-Status.</div>
          ) : (
            <div className="timeline">
              {run.steps.map((step) => {
                const usedLlm = stepUsedCrewai(step);
                const summaryText = stepCrewSummary(step);
                const progress = stepProgressInfo(step);
                const isStreaming = stepIsStreaming(step);
                const pct = progress && progress.total > 0
                  ? Math.round((progress.done / progress.total) * 100)
                  : null;
                return (
                  <div key={step.name} className={`step ${step.status}`}>
                    <div className="step-head">
                      <div className="step-name">{step.name.replace(/_/g, " ")}</div>
                      <div className="step-pills">
                        {isStreaming ? (
                          <span className="pill warn streaming-pill" title="LLM streamt gerade Tokens">
                            <span className="dot streaming-dot" />
                            streaming
                          </span>
                        ) : null}
                        {usedLlm === null ? null : (
                          <span className={usedLlm ? "pill ok" : "pill warn"} title={usedLlm ? "LLM hat diesen Schritt verarbeitet" : "Heuristik-Fallback verwendet"}>
                            {usedLlm ? "LLM" : "Fallback"}
                          </span>
                        )}
                        <span className={statusPillClass(step.status)}>{step.status}</span>
                      </div>
                    </div>
                    <div className="step-meta">
                      {formatTime(step.started_at)} → {formatTime(step.finished_at)}
                    </div>

                    {progress ? (
                      <div style={{ marginTop: "0.55rem" }}>
                        {progress.total > 0 ? (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                              <span>{progress.label}</span>
                              <span>{progress.done} / {progress.total}{pct !== null ? ` · ${pct}%` : ""}</span>
                            </div>
                            <div style={{ height: 4, background: "var(--surface-muted)", borderRadius: 999, overflow: "hidden", marginTop: 4 }}>
                              <div style={{ height: "100%", width: `${pct ?? 0}%`, background: "var(--accent)", transition: "width 300ms ease" }} />
                            </div>
                          </div>
                        ) : null}
                        {(progress.llm !== null || progress.heuristic !== null || progress.extras.length > 0) ? (
                          <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                            {progress.llm !== null ? (
                              <span className="pill ok" title="durch LLM verarbeitet">LLM · {progress.llm}</span>
                            ) : null}
                            {progress.heuristic !== null && progress.heuristic > 0 ? (
                              <span className="pill warn" title="Heuristik-Fallback verwendet">Heuristik · {progress.heuristic}</span>
                            ) : null}
                            {progress.extras.map((extra) => (
                              <span key={extra.label} className={`pill ${extra.tone}`}>
                                {extra.label} · {extra.count}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {summaryText || isStreaming ? (
                      <div className="step-summary-block">
                        <div className="step-summary-eyebrow">
                          <span className="step-summary-dot" />
                          <span>Agent Summary</span>
                          {isStreaming ? (
                            <span className="step-summary-eyebrow-streaming">· streaming</span>
                          ) : null}
                        </div>
                        <div className={`step-summary${isStreaming ? " step-summary-streaming" : ""}`}>
                          {renderStageSummary(summaryText)}
                        </div>
                      </div>
                    ) : null}
                    <details className="step-detail">
                      <summary>Rohdetails</summary>
                      <pre>{JSON.stringify(step.detail, null, 2)}</pre>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Analyse: vier Charts in einer Grid */}
        {cases.length > 0 ? (() => {
          const ANSOFF_LABEL: Record<number, string> = {
            1: "Sense of Threat",
            2: "Source Known",
            3: "Threat Characterized",
            4: "Response Known",
          };
          const ZD_KEYS = ["wirtschaftlichkeit", "versorgungssicherheit", "umweltvertraeglichkeit"] as const;
          const pestelMax = Math.max(1, ...(["P", "E", "S", "T", "En", "L"] as const).map((k) => pestelCounts[k]));
          const ansoffMax = Math.max(1, ...[1, 2, 3, 4].map((k) => ansoffCounts[k]));
          const zdMax = Math.max(1, ...ZD_KEYS.map((k) => zieldreieckCounts[k]));
          const impactTotal = impactCounts.HOCH + impactCounts.MITTEL + impactCounts.GERING;
          const impactSegments = [
            { label: "HOCH", value: impactCounts.HOCH, color: "var(--bad)" },
            { label: "MITTEL", value: impactCounts.MITTEL, color: "var(--warn)" },
            { label: "GERING", value: impactCounts.GERING, color: "var(--ink-faint)" },
          ];
          const donutSize = 150;
          const donutRadius = (donutSize - 26) / 2;
          const donutCircum = 2 * Math.PI * donutRadius;
          let cum = 0;

          return (
            <section
              className="surface"
              onMouseMove={handleTooltipMove}
              onMouseLeave={handleTooltipLeave}
            >
              <div className="surface-header">
                <h2>Analyse</h2>
                <span className="meta">{cases.length} Cases</span>
              </div>
              <div className="chart-grid">
                {/* PESTEL */}
                <div className="chart-block">
                  <div
                    className="chart-title"
                    data-tip="PESTEL klassifiziert jedes Signal nach dem Ursprung der Veränderung — sechs Dimensionen aus Politik bis Recht (siehe MAS_Foresight_Architektur §5.4)"
                  >
                    PESTEL-Verteilung
                  </div>
                  <div className="chart-sub">Woher die Veränderung kommt — hover über die Balken für Details</div>
                  <div className="bar-chart">
                    {(["P", "E", "S", "T", "En", "L"] as const).map((key) => {
                      const count = pestelCounts[key];
                      const pct = (count / pestelMax) * 100;
                      const totalPct = pestelTotal > 0 ? Math.round((count / pestelTotal) * 100) : 0;
                      return (
                        <div
                          key={key}
                          className="bar-row"
                          data-tip={`${PESTEL_DESC[key]}\n${count} Cases (${totalPct}% der klassifizierten Cases)`}
                        >
                          <div className="bar-key">{key}</div>
                          <div className="bar-label">{PESTEL_LABEL[key]}</div>
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="bar-count">{count}</div>
                        </div>
                      );
                    })}
                    {pestelCounts.unknown > 0 ? (
                      <div
                        className="meta"
                        style={{ fontSize: "0.7rem", marginTop: "0.3rem" }}
                        data-tip="Cases ohne PESTEL-Kategorie entstehen wenn das LLM keine eindeutige Zuordnung liefert oder die Heuristik den Case klassifiziert hat."
                      >
                        {pestelCounts.unknown} Cases ohne PESTEL-Kategorie
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Ansoff */}
                <div className="chart-block">
                  <div
                    className="chart-title"
                    data-tip="Ansoff (1975) Weak-Signal-Skala: je niedriger das Level, desto schwächer/früher das Signal. Level 4 bedeutet, die Entwicklung kippt vom Weak Signal zum erkennbaren Trend."
                  >
                    Ansoff Weak-Signal-Level
                  </div>
                  <div className="chart-sub">Reifegrad der detektierten Signale (L1 = schwach, L4 = bekannt)</div>
                  <div className="bar-chart">
                    {[1, 2, 3, 4].map((lvl) => {
                      const count = ansoffCounts[lvl];
                      const pct = (count / ansoffMax) * 100;
                      const totalAnsoff = ansoffCounts[1] + ansoffCounts[2] + ansoffCounts[3] + ansoffCounts[4];
                      const totalPct = totalAnsoff > 0 ? Math.round((count / totalAnsoff) * 100) : 0;
                      return (
                        <div
                          key={lvl}
                          className="bar-row"
                          data-tip={`${ANSOFF_DESC[lvl]}\n${count} Cases (${totalPct}% der Cases)`}
                        >
                          <div className="bar-key">L{lvl}</div>
                          <div className="bar-label">{ANSOFF_LABEL[lvl]}</div>
                          <div className="bar-track">
                            <div
                              className="bar-fill"
                              style={{ width: `${pct}%`, background: lvl >= 4 ? "var(--ink-faint)" : "var(--accent)" }}
                            />
                          </div>
                          <div className="bar-count">{count}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Systemic Impact Donut */}
                <div className="chart-block">
                  <div
                    className="chart-title"
                    data-tip="Systemischer Impact wird vom Energy-Expert-LLM pro Case beurteilt. Beurteilungsbasis: Merit-Order, Missing Money, Kannibalisierungseffekt, Netzphysik."
                  >
                    Systemischer Impact
                  </div>
                  <div className="chart-sub">Wirkungsstärke laut Energy Expert — hover über die Donut-Segmente</div>
                  <div className="donut-wrap">
                    <svg width={donutSize} height={donutSize} viewBox={`0 0 ${donutSize} ${donutSize}`} className="donut">
                      <circle
                        cx={donutSize / 2}
                        cy={donutSize / 2}
                        r={donutRadius}
                        fill="none"
                        stroke="var(--surface-muted)"
                        strokeWidth={22}
                      />
                      {impactTotal > 0 ? impactSegments.map((seg) => {
                        if (seg.value === 0) return null;
                        const length = (seg.value / impactTotal) * donutCircum;
                        const offset = -cum;
                        const segPct = Math.round((seg.value / impactTotal) * 100);
                        cum += length;
                        return (
                          <circle
                            key={seg.label}
                            cx={donutSize / 2}
                            cy={donutSize / 2}
                            r={donutRadius}
                            fill="none"
                            stroke={seg.color}
                            strokeWidth={22}
                            strokeDasharray={`${length} ${donutCircum}`}
                            strokeDashoffset={offset}
                            transform={`rotate(-90 ${donutSize / 2} ${donutSize / 2})`}
                            style={{ cursor: "help" }}
                            data-tip={`${seg.label}: ${seg.value} Cases (${segPct}%)\n${IMPACT_DESC[seg.label]}`}
                          />
                        );
                      }) : null}
                      <text
                        x={donutSize / 2}
                        y={donutSize / 2 - 4}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{ fontSize: "1.5rem", fontWeight: 600, fill: "var(--ink)" }}
                      >
                        {impactTotal}
                      </text>
                      <text
                        x={donutSize / 2}
                        y={donutSize / 2 + 14}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{ fontSize: "0.7rem", fill: "var(--ink-faint)" }}
                      >
                        bewertet
                      </text>
                    </svg>
                    <div className="donut-legend">
                      {impactSegments.map((seg) => {
                        const segPct = impactTotal > 0 ? Math.round((seg.value / impactTotal) * 100) : 0;
                        return (
                          <div
                            key={seg.label}
                            className="donut-legend-row"
                            data-tip={`${IMPACT_DESC[seg.label]}\n${seg.value} Cases (${segPct}%)`}
                          >
                            <span className="donut-legend-dot" style={{ background: seg.color }} />
                            <span className="donut-legend-label">{seg.label}</span>
                            <span className="donut-legend-count">{seg.value}</span>
                          </div>
                        );
                      })}
                      {impactCounts.unknown > 0 ? (
                        <div
                          className="meta"
                          style={{ fontSize: "0.7rem", marginTop: "0.3rem" }}
                          data-tip="Cases ohne Impact-Bewertung: Expert-LLM nicht erreichbar oder Heuristik-Fallback aktiv."
                        >
                          {impactCounts.unknown} ohne Bewertung
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Zieldreieck */}
                <div className="chart-block">
                  <div
                    className="chart-title"
                    data-tip="Energiepolitisches Zieldreieck aus §1 EnWG. Jeder Case kann mehrere Dimensionen gleichzeitig tangieren, daher kann die Summe > Anzahl Cases sein."
                  >
                    Zieldreieck-Coverage
                  </div>
                  <div className="chart-sub">Welche §1 EnWG-Ziele tangiert sind — Cases können mehrere abdecken</div>
                  <div className="bar-chart">
                    {ZD_KEYS.map((key) => {
                      const count = zieldreieckCounts[key];
                      const pct = (count / zdMax) * 100;
                      const casesPct = cases.length > 0 ? Math.round((count / cases.length) * 100) : 0;
                      return (
                        <div
                          key={key}
                          className="bar-row"
                          data-tip={`${ZIELDREIECK_DESC[key]}\n${count} Cases tangieren diese Dimension (${casesPct}% aller Cases)`}
                        >
                          <div className="bar-key" style={{ fontSize: "0.7rem" }}>
                            {key === "wirtschaftlichkeit" ? "W" : key === "versorgungssicherheit" ? "V" : "U"}
                          </div>
                          <div className="bar-label">{ZIELDREIECK_LABEL[key]}</div>
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${pct}%`, background: "var(--ok)" }} />
                          </div>
                          <div className="bar-count">{count}</div>
                        </div>
                      );
                    })}
                    <div className="meta" style={{ fontSize: "0.7rem", marginTop: "0.3rem" }}>
                      Cases können mehrere Dimensionen tangieren
                    </div>
                  </div>
                </div>
              </div>
            </section>
          );
        })() : null}

        {/* Trend über Runs */}
        {trendData.length >= 2 ? (() => {
          const maxY = Math.max(1, ...trendData.flatMap((d) => [d.cases, d.signals, d.validated]));
          const padding = { top: 16, right: 16, bottom: 36, left: 36 };
          const width = 720;
          const height = 220;
          const innerW = width - padding.left - padding.right;
          const innerH = height - padding.top - padding.bottom;
          const xScale = (i: number) =>
            padding.left + (trendData.length > 1 ? (i / (trendData.length - 1)) * innerW : innerW / 2);
          const yScale = (v: number) => padding.top + (1 - v / maxY) * innerH;
          const linePath = (key: "cases" | "signals" | "validated") =>
            trendData.map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d[key])}`).join(" ");

          const yTicks = [0, Math.ceil(maxY / 2), maxY];

          return (
            <section
              className="surface"
              onMouseMove={handleTooltipMove}
              onMouseLeave={handleTooltipLeave}
            >
              <div className="surface-header">
                <h2>Trend über Runs</h2>
                <span className="meta">{trendData.length} abgeschlossene Runs</span>
              </div>
              <div className="trend-chart-wrap">
                <svg viewBox={`0 0 ${width} ${height}`} className="trend-chart">
                  {/* Y gridlines */}
                  {yTicks.map((t) => (
                    <g key={t}>
                      <line
                        x1={padding.left}
                        x2={width - padding.right}
                        y1={yScale(t)}
                        y2={yScale(t)}
                        stroke="var(--line)"
                        strokeDasharray="2 4"
                      />
                      <text
                        x={padding.left - 8}
                        y={yScale(t)}
                        textAnchor="end"
                        dominantBaseline="central"
                        style={{ fontSize: "0.7rem", fill: "var(--ink-faint)" }}
                      >
                        {t}
                      </text>
                    </g>
                  ))}
                  {/* X labels: first, middle, last */}
                  {trendData.map((d, i) => {
                    if (trendData.length > 4 && i !== 0 && i !== trendData.length - 1 && i !== Math.floor(trendData.length / 2)) {
                      return null;
                    }
                    return (
                      <text
                        key={d.run_id}
                        x={xScale(i)}
                        y={height - padding.bottom + 16}
                        textAnchor="middle"
                        style={{ fontSize: "0.7rem", fill: "var(--ink-faint)" }}
                      >
                        {new Date(d.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                      </text>
                    );
                  })}
                  {/* Lines */}
                  <path d={linePath("cases")} stroke="var(--ink-faint)" fill="none" strokeWidth={2} />
                  <path d={linePath("signals")} stroke="var(--accent)" fill="none" strokeWidth={2} />
                  <path d={linePath("validated")} stroke="var(--ok)" fill="none" strokeWidth={2.5} />
                  {/* Points with hover tooltips */}
                  {trendData.map((d, i) => {
                    const ts = new Date(d.created_at).toLocaleString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const tip = `Run vom ${ts}\nCases gesamt: ${d.cases}\nals Signal: ${d.signals}\nvalidiert: ${d.validated}\nRun-ID: ${d.run_id}`;
                    return (
                      <g key={d.run_id} style={{ cursor: "help" }} data-tip={tip}>
                        {/* Invisible larger hit-area for easier hover */}
                        <rect
                          x={xScale(i) - 18}
                          y={padding.top}
                          width={36}
                          height={innerH}
                          fill="transparent"
                        />
                        <circle cx={xScale(i)} cy={yScale(d.cases)} r={2.5} fill="var(--ink-faint)" />
                        <circle cx={xScale(i)} cy={yScale(d.signals)} r={2.5} fill="var(--accent)" />
                        <circle cx={xScale(i)} cy={yScale(d.validated)} r={3.5} fill="var(--ok)" />
                      </g>
                    );
                  })}
                </svg>
                <div className="trend-legend">
                  <div className="trend-legend-row">
                    <span className="trend-legend-line" style={{ background: "var(--ink-faint)" }} />
                    <span>Cases gesamt</span>
                  </div>
                  <div className="trend-legend-row">
                    <span className="trend-legend-line" style={{ background: "var(--accent)" }} />
                    <span>als Signal klassifiziert</span>
                  </div>
                  <div className="trend-legend-row">
                    <span className="trend-legend-line" style={{ background: "var(--ok)" }} />
                    <span>vom Expert validiert</span>
                  </div>
                </div>
              </div>
            </section>
          );
        })() : null}

        {/* Cases */}
        <section
          className="surface"
          onMouseMove={handleTooltipMove}
          onMouseLeave={handleTooltipLeave}
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
                onClick={() => exportCases("csv")}
                disabled={cases.length === 0}
                title="Cases als CSV exportieren (für Reports oder Übergabe an Gruppe 12)"
              >
                ↓ CSV
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => exportCases("json")}
                disabled={cases.length === 0}
                title="Cases als JSON exportieren (vollständige Datenstruktur)"
              >
                ↓ JSON
              </button>
            </div>
          </div>

          {cases.length === 0 ? (
            <div className="empty">Noch keine Cases vorhanden.</div>
          ) : (
            <>
              <div className="case-filter-bar">
                <div className="case-filter-chips">
                  {([
                    { id: "all", label: "Alle", count: caseCounts.all, accent: "neutral" as const },
                    { id: "awaiting_review", label: "Review nötig", count: caseCounts.awaiting_review, accent: "warn" as const },
                    { id: "validated", label: "Validiert", count: caseCounts.validated, accent: "ok" as const },
                    { id: "rejected", label: "Rejected", count: caseCounts.rejected, accent: "bad" as const },
                  ] as const).map((chip) => {
                    const active = caseFilter === chip.id;
                    const hot = chip.id === "awaiting_review" && chip.count > 0;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        className={`filter-chip ${chip.accent}${active ? " active" : ""}${hot ? " hot" : ""}`}
                        onClick={() => setCaseFilter(chip.id)}
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
                  onChange={(event) => setCaseSearch(event.target.value)}
                  className="case-search"
                />
              </div>

              {filteredCases.length === 0 ? (
                <div className="empty">Keine Cases passen zum Filter.</div>
              ) : (
                <div className="case-grid">
                  {filteredCases.map((item) => {
                    const edit = editForCase(item);
                    const needsReview = item.validation_status === "awaiting_review";
                    return (
                      <article key={item.case_id} className={`case${needsReview ? " awaiting" : ""}`}>
                    <div className="case-head">
                      <div>
                        <button
                          type="button"
                          className="case-title case-title-button"
                          onClick={() => setDetailCaseId(item.case_id)}
                          title="Vollansicht öffnen"
                        >
                          {item.title}
                        </button>
                        <div className="case-meta">
                          <span data-tip={`Suchbegriff aus der Konfiguration, der diesen Case erzeugt hat: "${item.keyword}"`}>
                            Keyword: {item.keyword}
                          </span>
                          <span data-tip={CONFIDENCE_DESC}>
                            Confidence: {Math.round(item.confidence * 100)}%
                          </span>
                          <span data-tip={`Ansoff L${item.ansoff_level}: ${ANSOFF_DESC[item.ansoff_level] || "—"}`}>
                            Ansoff L{item.ansoff_level}
                          </span>
                          <span className="kbd" data-tip="Eindeutige Case-ID — wird im Export und in der Run-History referenziert">
                            {item.case_id}
                          </span>
                        </div>
                      </div>
                      <div className="case-pills">
                        {item.seen_count && item.seen_count > 1 ? (
                          <span
                            className="pill neutral history-pill"
                            data-tip={`${HISTORY_PILL_DESC}\nGesehen in ${item.seen_count} Runs seit ${item.first_seen_at ? new Date(item.first_seen_at).toLocaleDateString("de-DE") : "?"}`}
                          >
                            ↻ {item.seen_count}× seit {item.first_seen_at ? new Date(item.first_seen_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : "?"}
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

                    {item.expert_comment || item.systemic_impact || item.time_horizon || (item.zieldreieck_impact && Object.keys(item.zieldreieck_impact).length > 0) ? (
                      <div className="expert-block">
                        <div className="expert-pills">
                          <span className="expert-label" data-tip={EXPERT_LABEL_DESC}>
                            Energy Expert
                          </span>
                          {item.expert_valid === false ? (
                            <span className="pill bad" data-tip={EXPERT_VALID_DESC.no}>unplausibel</span>
                          ) : item.expert_valid === true ? (
                            <span className="pill ok" data-tip={EXPERT_VALID_DESC.yes}>plausibel</span>
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
                              data-tip={`Systemischer Impact: ${IMPACT_DESC[item.systemic_impact] || item.systemic_impact}`}
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
                          <p className="meta" style={{ marginTop: "0.35rem" }}>{item.expert_comment}</p>
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
                        <div className="meta" style={{ marginBottom: "0.4rem", fontWeight: 600 }}>Quellen</div>
                        <ul className="source-list">
                          {item.sources.map((source, index) => (
                            <li key={`${item.case_id}_${index}`}>
                              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                              <div className="source-meta">{source.snippet}</div>
                              <div className="source-meta">
                                Trust {source.trust_score} · {source.published_at || "—"}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="review-form">
                        <div className="meta" style={{ marginBottom: "0.4rem", fontWeight: 600 }}>Korrektur</div>
                        <label>
                          Klassifikation
                          <select
                            value={edit.is_signal ? "signal" : "noise"}
                            onChange={(event) =>
                              updateCaseEdit(item.case_id, { is_signal: event.target.value === "signal" })
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
                            onChange={(event) => updateCaseEdit(item.case_id, { comment: event.target.value })}
                          />
                        </label>
                        <label>
                          Titel überschreiben (optional)
                          <input
                            value={edit.corrected_title}
                            onChange={(event) =>
                              updateCaseEdit(item.case_id, { corrected_title: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Begründung überschreiben (optional)
                          <textarea
                            rows={2}
                            value={edit.corrected_rationale}
                            onChange={(event) =>
                              updateCaseEdit(item.case_id, { corrected_rationale: event.target.value })
                            }
                          />
                        </label>
                        <div className="btn-row">
                          <button className="primary" type="button" onClick={() => void submitCaseReview(item)}>
                            Speichern
                          </button>
                        </div>
                      </div>
                    </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {(() => {
        if (!detailCaseId) return null;
        const item = cases.find((c) => c.case_id === detailCaseId);
        if (!item) return null;
        const dims = item.zieldreieck_dimensions || [];
        return (
          <div
            className="modal-backdrop"
            onClick={() => setDetailCaseId(null)}
            role="dialog"
            aria-modal="true"
            onMouseMove={handleTooltipMove}
            onMouseLeave={handleTooltipLeave}
          >
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <div className="modal-eyebrow">Case · {item.keyword}</div>
                  <h2 className="modal-title">{item.title}</h2>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setDetailCaseId(null)}
                  title="Schließen (Esc)"
                >
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
                    data-tip={`Systemischer Impact: ${IMPACT_DESC[item.systemic_impact] || item.systemic_impact}`}
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
                  <span className="pill bad" data-tip={EXPERT_VALID_DESC.no}>unplausibel</span>
                ) : item.expert_valid === true ? (
                  <span className="pill ok" data-tip={EXPERT_VALID_DESC.yes}>plausibel</span>
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
      })()}

      {tooltip ? (
        <div className="custom-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text.split("\n").map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}
    </>
  );
}
