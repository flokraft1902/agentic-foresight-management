import {
  ANSOFF_DESC,
  ANSOFF_LABEL,
  IMPACT_DESC,
  PESTEL_DESC,
  PESTEL_LABEL,
  ZIELDREIECK_DESC,
  ZIELDREIECK_LABEL,
} from "../lib/labels";
import type { TooltipApi } from "../lib/useTooltip";

interface Props {
  casesLength: number;
  pestelCounts: Record<string, number>;
  pestelTotal: number;
  ansoffCounts: Record<number, number>;
  impactCounts: Record<string, number>;
  zieldreieckCounts: Record<string, number>;
  tooltip: TooltipApi;
}

const ZD_KEYS = ["wirtschaftlichkeit", "versorgungssicherheit", "umweltvertraeglichkeit"] as const;

export function AnalyseCharts({
  casesLength,
  pestelCounts,
  pestelTotal,
  ansoffCounts,
  impactCounts,
  zieldreieckCounts,
  tooltip,
}: Props) {
  if (casesLength === 0) return null;

  const pestelMax = Math.max(
    1,
    ...(["P", "E", "S", "T", "En", "L"] as const).map((k) => pestelCounts[k]),
  );
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
      onMouseMove={tooltip.onMouseMove}
      onMouseLeave={tooltip.onMouseLeave}
    >
      <div className="surface-header">
        <h2>Analyse</h2>
        <span className="meta">{casesLength} Cases</span>
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
          <div className="chart-sub">
            Woher die Veränderung kommt — hover über die Balken für Details
          </div>
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
                      style={{
                        width: `${pct}%`,
                        background: lvl >= 4 ? "var(--ink-faint)" : "var(--accent)",
                      }}
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
          <div className="chart-sub">
            Wirkungsstärke laut Energy Expert — hover über die Donut-Segmente
          </div>
          <div className="donut-wrap">
            <svg
              width={donutSize}
              height={donutSize}
              viewBox={`0 0 ${donutSize} ${donutSize}`}
              className="donut"
            >
              <circle
                cx={donutSize / 2}
                cy={donutSize / 2}
                r={donutRadius}
                fill="none"
                stroke="var(--surface-muted)"
                strokeWidth={22}
              />
              {impactTotal > 0
                ? impactSegments.map((seg) => {
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
                  })
                : null}
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
          <div className="chart-sub">
            Welche §1 EnWG-Ziele tangiert sind — Cases können mehrere abdecken
          </div>
          <div className="bar-chart">
            {ZD_KEYS.map((key) => {
              const count = zieldreieckCounts[key];
              const pct = (count / zdMax) * 100;
              const casesPct = casesLength > 0 ? Math.round((count / casesLength) * 100) : 0;
              return (
                <div
                  key={key}
                  className="bar-row"
                  data-tip={`${ZIELDREIECK_DESC[key]}\n${count} Cases tangieren diese Dimension (${casesPct}% aller Cases)`}
                >
                  <div className="bar-key" style={{ fontSize: "0.7rem" }}>
                    {key === "wirtschaftlichkeit"
                      ? "W"
                      : key === "versorgungssicherheit"
                      ? "V"
                      : "U"}
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
}
