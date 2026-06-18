import type { TooltipState } from "../lib/useTooltip";

interface Props {
  tooltip: TooltipState | null;
}

export function CustomTooltip({ tooltip }: Props) {
  if (!tooltip) return null;
  return (
    <div className="custom-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      {tooltip.text.split("\n").map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
