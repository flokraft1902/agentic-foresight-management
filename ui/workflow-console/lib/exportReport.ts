import { jsPDF } from "jspdf";
import type { SignalCase, SourceItem, WorkflowRun } from "./types";

export interface ReportLabels {
  pestel: Record<string, string>;
  zieldreieck: Record<string, string>;
}

type RGB = readonly [number, number, number];

const COLORS = {
  ink: [22, 26, 29] as RGB,
  inkSoft: [100, 100, 100] as RGB,
  inkFaint: [156, 163, 175] as RGB,
  accent: [15, 118, 110] as RGB,
  line: [220, 220, 215] as RGB,
};

const MARGIN_X = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 64;

export function exportReport(
  run: WorkflowRun,
  cases: SignalCase[],
  labels: ReportLabels,
): string {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - 2 * MARGIN_X;

  let y = MARGIN_TOP;
  let pageNumber = 1;

  const setColor = (rgb: RGB) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

  const drawFooter = () => {
    const prevFontSize = doc.getFontSize();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(COLORS.inkFaint);
    doc.text(
      `Foresight Report · Gruppe 11 · DHBW Stuttgart · Seite ${pageNumber}`,
      MARGIN_X,
      pageHeight - 32,
    );
    doc.setFontSize(prevFontSize);
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - MARGIN_BOTTOM) {
      drawFooter();
      doc.addPage();
      pageNumber += 1;
      y = MARGIN_TOP;
    }
  };

  type FontStyle = "normal" | "bold" | "italic" | "bolditalic";

  const writeLines = (
    text: string,
    opts: {
      size: number;
      font?: FontStyle;
      color?: RGB;
      lineHeight?: number;
      indent?: number;
    },
  ) => {
    if (!text) return;
    doc.setFont("helvetica", opts.font || "normal");
    doc.setFontSize(opts.size);
    setColor(opts.color || COLORS.ink);
    const indent = opts.indent ?? 0;
    const lh = opts.lineHeight ?? opts.size * 1.4;
    const lines = doc.splitTextToSize(text, contentWidth - indent) as string[];
    for (const line of lines) {
      ensureSpace(lh);
      doc.text(line, MARGIN_X + indent, y);
      y += lh;
    }
  };

  const heading1 = (text: string) => {
    ensureSpace(32);
    writeLines(text, { size: 22, font: "bold", color: COLORS.ink, lineHeight: 28 });
    y += 4;
  };

  const heading2 = (text: string) => {
    ensureSpace(26);
    y += 6;
    writeLines(text, { size: 14, font: "bold", color: COLORS.accent, lineHeight: 20 });
    y += 4;
  };

  const heading3 = (text: string) => {
    ensureSpace(20);
    y += 4;
    writeLines(text, { size: 11, font: "bold", color: COLORS.ink, lineHeight: 16 });
    y += 2;
  };

  const paragraph = (
    text: string,
    opts?: {
      size?: number;
      font?: FontStyle;
      color?: RGB;
      lineHeight?: number;
    },
  ) => {
    if (!text) return;
    writeLines(text, {
      size: opts?.size ?? 10,
      font: opts?.font,
      color: opts?.color,
      lineHeight: opts?.lineHeight,
    });
    y += 4;
  };

  const bullet = (
    text: string,
    opts?: { size?: number; color?: RGB },
  ) => {
    const size = opts?.size ?? 10;
    const lh = size * 1.4;
    const indent = 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    setColor(opts?.color || COLORS.ink);
    const lines = doc.splitTextToSize(text, contentWidth - indent) as string[];
    lines.forEach((line, i) => {
      ensureSpace(lh);
      if (i === 0) doc.text("•", MARGIN_X, y);
      doc.text(line, MARGIN_X + indent, y);
      y += lh;
    });
  };

  const meta = (label: string, value: string) => {
    if (!value) return;
    const labelWidth = 100;
    ensureSpace(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setColor(COLORS.inkSoft);
    doc.text(label, MARGIN_X, y);
    doc.setFont("helvetica", "normal");
    setColor(COLORS.ink);
    const valueLines = doc.splitTextToSize(value, contentWidth - labelWidth) as string[];
    valueLines.forEach((line, i) => {
      if (i > 0) {
        y += 12;
        ensureSpace(12);
      }
      doc.text(line, MARGIN_X + labelWidth, y);
    });
    y += 14;
  };

  const divider = () => {
    ensureSpace(20);
    y += 8;
    doc.setDrawColor(COLORS.line[0], COLORS.line[1], COLORS.line[2]);
    doc.setLineWidth(0.5);
    doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);
    y += 14;
  };

  const sourceLink = (s: SourceItem) => {
    const indent = 14;
    const titleSize = 9;
    const titleLh = titleSize * 1.4;
    const urlSize = 7.5;
    const urlLh = 10;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(titleSize);
    setColor(COLORS.ink);
    const titleText = `${s.title} (Trust ${s.trust_score}${s.published_at ? `, ${s.published_at}` : ""})`;
    const titleLines = doc.splitTextToSize(titleText, contentWidth - indent) as string[];
    titleLines.forEach((line, i) => {
      ensureSpace(titleLh);
      if (i === 0) doc.text("•", MARGIN_X, y);
      doc.text(line, MARGIN_X + indent, y);
      y += titleLh;
    });

    doc.setFontSize(urlSize);
    setColor(COLORS.accent);
    const urlLines = doc.splitTextToSize(s.url, contentWidth - indent) as string[];
    urlLines.forEach((line) => {
      ensureSpace(urlLh);
      doc.textWithLink(line, MARGIN_X + indent, y, { url: s.url });
      y += urlLh;
    });
    y += 3;
  };

  // Render the LLM stage-summary markdown into the PDF.
  const renderStageMarkdown = (md: string) => {
    if (!md.trim()) return;
    const lines = md.split("\n");
    let bullets: string[] = [];
    const flushBullets = () => {
      for (const b of bullets) bullet(b, { size: 9 });
      bullets = [];
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("### ")) {
        flushBullets();
        y += 2;
        writeLines(line.slice(4), { size: 10, font: "bold", color: COLORS.inkSoft, lineHeight: 14 });
      } else if (line.startsWith("## ")) {
        flushBullets();
        y += 4;
        writeLines(line.slice(3), { size: 10.5, font: "bold", color: COLORS.ink, lineHeight: 14 });
      } else if (line.startsWith("# ")) {
        flushBullets();
        y += 4;
        writeLines(line.slice(2), { size: 11, font: "bold", color: COLORS.ink, lineHeight: 15 });
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        bullets.push(line.slice(2));
      } else if (line === "") {
        flushBullets();
      } else {
        flushBullets();
        writeLines(line, { size: 9.5, color: COLORS.ink, lineHeight: 13 });
      }
    }
    flushBullets();
    y += 4;
  };

  // === TITLE ===

  heading1("Foresight Report");
  writeLines("Energiewirtschaftliche Weak Signals · Multi-Agent-Pipeline", {
    size: 11,
    color: COLORS.inkSoft,
    lineHeight: 14,
  });
  y += 14;

  // === META ===

  meta("Run-ID", run.run_id);
  meta("Datum", new Date(run.created_at).toLocaleString("de-DE"));
  meta("Status", run.status);
  meta("Strategischer Fokus", run.focus);
  meta("Suchbegriffe", run.search_terms.join(", "));
  meta(
    "Methodik",
    "PESTEL · Ansoff (1975) · §1 EnWG Zieldreieck · LLM-gestützte Expert Validation",
  );

  // === EXECUTIVE SUMMARY ===

  heading2("Executive Summary");

  const total = cases.length;
  const signals = cases.filter((c) => c.is_signal).length;
  const validated = cases.filter((c) => c.validation_status === "validated").length;
  const awaiting = cases.filter((c) => c.validation_status === "awaiting_review").length;
  const rejected = cases.filter((c) => c.validation_status === "rejected").length;
  const validatedHighImpact = cases.filter(
    (c) => c.validation_status === "validated" && c.systemic_impact === "HOCH",
  ).length;

  bullet(`${total} Cases aus ${run.search_terms.length} Suchbegriffen identifiziert.`);
  bullet(`${signals} als Signal klassifiziert (Assessment-Stage).`);
  bullet(
    `${validated} vom Energy Expert validiert${validatedHighImpact > 0 ? ` — davon ${validatedHighImpact} mit Impact HOCH` : ""}.`,
  );
  if (awaiting > 0) bullet(`${awaiting} in Human Review (awaiting).`);
  if (rejected > 0) bullet(`${rejected} verworfen (Noise oder domain-unplausibel).`);

  y += 6;

  // PESTEL distribution
  const pestelCounts: Record<string, number> = { P: 0, E: 0, S: 0, T: 0, En: 0, L: 0 };
  cases.forEach((c) => {
    if (c.pestel_category && c.pestel_category in pestelCounts) {
      pestelCounts[c.pestel_category] += 1;
    }
  });
  const pestelOrder = (["T", "E", "L", "P", "En", "S"] as const)
    .filter((k) => pestelCounts[k] > 0)
    .map((k) => `${labels.pestel[k]} ${pestelCounts[k]}`)
    .join(" · ");
  if (pestelOrder) {
    heading3("PESTEL-Verteilung");
    paragraph(pestelOrder, { size: 9 });
  }

  // Zieldreieck coverage
  const zdCounts: Record<string, number> = {
    wirtschaftlichkeit: 0,
    versorgungssicherheit: 0,
    umweltvertraeglichkeit: 0,
  };
  cases.forEach((c) => {
    (c.zieldreieck_dimensions || []).forEach((d) => {
      if (d in zdCounts) zdCounts[d] += 1;
    });
  });
  const zdTotal =
    zdCounts.wirtschaftlichkeit +
    zdCounts.versorgungssicherheit +
    zdCounts.umweltvertraeglichkeit;
  if (zdTotal > 0) {
    heading3("Zieldreieck-Coverage (§1 EnWG)");
    paragraph(
      `Wirtschaftlichkeit ${zdCounts.wirtschaftlichkeit} · Versorgungssicherheit ${zdCounts.versorgungssicherheit} · Umweltverträglichkeit ${zdCounts.umweltvertraeglichkeit}`,
      { size: 9 },
    );
  }

  divider();

  // === VALIDATED SIGNALS ===

  const impactOrder = (impact: string | null | undefined) => {
    if (impact === "HOCH") return 0;
    if (impact === "MITTEL") return 1;
    if (impact === "GERING") return 2;
    return 3;
  };

  const validatedCases = cases
    .filter((c) => c.validation_status === "validated")
    .sort((a, b) => {
      const diff = impactOrder(a.systemic_impact) - impactOrder(b.systemic_impact);
      if (diff !== 0) return diff;
      return b.confidence - a.confidence;
    });

  heading2(`Strategische Signale (${validatedCases.length} validiert)`);

  if (validatedCases.length === 0) {
    paragraph("(Keine validierten Signale in diesem Run.)", {
      font: "italic",
      color: COLORS.inkSoft,
      size: 10,
    });
  } else {
    validatedCases.forEach((c, idx) => {
      heading3(`${idx + 1}. ${c.title}`);

      const metaLine = [
        `Confidence ${Math.round(c.confidence * 100)}%`,
        `Ansoff L${c.ansoff_level}`,
        c.pestel_category ? `PESTEL ${c.pestel_category}` : "",
        c.systemic_impact ? `Impact ${c.systemic_impact}` : "",
        c.time_horizon ? `Zeithorizont ${c.time_horizon}` : "",
        `Keyword: ${c.keyword}`,
      ]
        .filter(Boolean)
        .join(" · ");
      paragraph(metaLine, { size: 8.5, font: "italic", color: COLORS.inkSoft });

      paragraph("Rationale", { size: 9, font: "bold", color: COLORS.ink });
      paragraph(c.rationale, { size: 10 });

      if (c.expert_comment) {
        paragraph("Energy Expert", { size: 9, font: "bold", color: COLORS.ink });
        paragraph(c.expert_comment, { size: 10 });
      }

      if (c.zieldreieck_impact && Object.keys(c.zieldreieck_impact).length > 0) {
        paragraph("Zieldreieck-Impact", { size: 9, font: "bold", color: COLORS.ink });
        Object.entries(c.zieldreieck_impact).forEach(([dim, text]) => {
          bullet(`${labels.zieldreieck[dim] || dim}: ${text}`, { size: 9.5 });
        });
        y += 2;
      }

      if (c.sources && c.sources.length > 0) {
        paragraph("Quellen", { size: 9, font: "bold", color: COLORS.ink });
        c.sources.forEach((s) => sourceLink(s));
      }

      y += 10;
    });
  }

  // === AWAITING REVIEW ===

  const awaitingCases = cases.filter((c) => c.validation_status === "awaiting_review");
  if (awaitingCases.length > 0) {
    divider();
    heading2(`Cases in Human Review (${awaitingCases.length})`);
    awaitingCases.forEach((c, idx) => {
      heading3(`${idx + 1}. ${c.title}`);
      paragraph(
        `Confidence ${Math.round(c.confidence * 100)}% · Ansoff L${c.ansoff_level}${c.pestel_category ? ` · PESTEL ${c.pestel_category}` : ""}`,
        { size: 8.5, font: "italic", color: COLORS.inkSoft },
      );
      paragraph(c.rationale, { size: 9.5 });
      if (c.expert_comment) {
        paragraph(`Expert: ${c.expert_comment}`, {
          size: 9,
          font: "italic",
          color: COLORS.inkSoft,
        });
      }
      y += 6;
    });
  }

  // === STAGE SUMMARIES ===

  const stepsWithSummary =
    run.steps?.filter((s) => {
      const detail = s.detail as { crewai?: { summary?: string } };
      return Boolean(detail.crewai?.summary?.trim());
    }) || [];

  if (stepsWithSummary.length > 0) {
    divider();
    heading2("Stage-Zusammenfassungen");
    stepsWithSummary.forEach((step) => {
      const niceName = step.name
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      heading3(niceName);
      const summaryText =
        (step.detail as { crewai?: { summary?: string } }).crewai?.summary || "";
      renderStageMarkdown(summaryText);
    });
  }

  // === METHODOLOGY ===

  divider();
  heading2("Methodik");

  paragraph("PESTEL", { size: 9, font: "bold", color: COLORS.ink });
  paragraph(
    "Sechs-Dimensionen-Framework für die Herkunft eines Signals: Political, Economic, Social, Technological, Environmental, Legal.",
    { size: 9 },
  );

  paragraph("Ansoff (1975) Weak-Signal-Skala", { size: 9, font: "bold", color: COLORS.ink });
  paragraph(
    "L1 Sense of Threat → L2 Source Known → L3 Threat Characterized → L4 Response Known. Misst den Reifegrad des Signals.",
    { size: 9 },
  );

  paragraph("§1 EnWG Zieldreieck", { size: 9, font: "bold", color: COLORS.ink });
  paragraph(
    "Wirtschaftlichkeit · Versorgungssicherheit · Umweltverträglichkeit. Energiepolitisches Bewertungsraster für jede Maßnahme.",
    { size: 9 },
  );

  paragraph("Energy Expert", { size: 9, font: "bold", color: COLORS.ink });
  paragraph(
    "LLM-gestützter Domain-Check pro Case: Merit-Order, Missing-Money, Kannibalisierungseffekte, Netzphysik.",
    { size: 9 },
  );

  y += 10;
  writeLines(
    `Foresight Workflow Console — Gruppe 11, DHBW Stuttgart · Erstellt: ${new Date().toLocaleString("de-DE")}`,
    { size: 8, font: "italic", color: COLORS.inkFaint, lineHeight: 10 },
  );

  drawFooter();

  // === SAVE ===

  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const runIdPart = run.run_id.replace("run_", "");
  const filename = `foresight_report_${runIdPart}_${ts}.pdf`;
  doc.save(filename);
  return filename;
}
