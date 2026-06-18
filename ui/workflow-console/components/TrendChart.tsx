import type { TooltipApi } from "../lib/useTooltip";

export interface TrendDatum {
  run_id: string;
  created_at: string;
  cases: number;
  signals: number;
  validated: number;
}

interface Props {
  data: TrendDatum[];
  tooltip: TooltipApi;
}

export function TrendChart({ data, tooltip }: Props) {
  if (data.length < 2) return null;

  const maxY = Math.max(1, ...data.flatMap((d) => [d.cases, d.signals, d.validated]));
  const padding = { top: 16, right: 16, bottom: 36, left: 36 };
  const width = 720;
  const height = 220;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const xScale = (i: number) =>
    padding.left + (data.length > 1 ? (i / (data.length - 1)) * innerW : innerW / 2);
  const yScale = (v: number) => padding.top + (1 - v / maxY) * innerH;
  const linePath = (key: "cases" | "signals" | "validated") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d[key])}`).join(" ");
  const yTicks = [0, Math.ceil(maxY / 2), maxY];

  return (
    <section
      className="surface"
      onMouseMove={tooltip.onMouseMove}
      onMouseLeave={tooltip.onMouseLeave}
    >
      <div className="surface-header">
        <h2>Trend über Runs</h2>
        <span className="meta">{data.length} abgeschlossene Runs</span>
      </div>
      <div className="trend-chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} className="trend-chart">
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
          {data.map((d, i) => {
            if (
              data.length > 4 &&
              i !== 0 &&
              i !== data.length - 1 &&
              i !== Math.floor(data.length / 2)
            ) {
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
                {new Date(d.created_at).toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </text>
            );
          })}
          <path d={linePath("cases")} stroke="var(--ink-faint)" fill="none" strokeWidth={2} />
          <path d={linePath("signals")} stroke="var(--accent)" fill="none" strokeWidth={2} />
          <path d={linePath("validated")} stroke="var(--ok)" fill="none" strokeWidth={2.5} />
          {data.map((d, i) => {
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
}
