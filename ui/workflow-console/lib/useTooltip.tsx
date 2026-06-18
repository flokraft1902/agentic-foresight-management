"use client";

import { useCallback, useState, type MouseEvent } from "react";

export interface TooltipState {
  x: number;
  y: number;
  text: string;
}

export interface TooltipApi {
  tooltip: TooltipState | null;
  onMouseMove: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
}

// Custom tooltip that reads `data-tip="..."` from the closest ancestor under
// the pointer. Used to give all chart/case badges an instant tooltip with no
// native browser delay.
export function useTooltip(): TooltipApi {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const onMouseMove = useCallback((event: MouseEvent<HTMLElement>) => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") {
      setTooltip(null);
      return;
    }
    const el = target.closest("[data-tip]");
    const tip = el?.getAttribute("data-tip");
    if (tip) {
      setTooltip({ x: event.clientX, y: event.clientY, text: tip });
    } else {
      setTooltip(null);
    }
  }, []);

  const onMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  return { tooltip, onMouseMove, onMouseLeave };
}
