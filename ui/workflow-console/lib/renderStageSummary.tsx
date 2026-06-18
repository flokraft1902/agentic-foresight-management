import type { ReactNode } from "react";

// Tiny markdown renderer for the LLM stage summaries produced by summarize_stage().
// Handles only the syntax we actually ask the LLM to use: ## / ### headings and
// "- " / "* " bullets. Everything else becomes a paragraph. Designed to be safe
// against partial / streaming input — half-typed lines render gracefully.
export function renderStageSummary(text: string | null | undefined): ReactNode {
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
