"use client";

// The large headline count at the top of /search. The number eases from the old value to the new one (skipped for reduced motion).

import React, { useEffect, useRef, useState } from "react";

export interface LiveCountProps {
  /** null = nothing to show yet (lists still loading). */
  value: number | null;
  /** The box stopped counting at its cap: shown as "1,000+". */
  capped?: boolean;
  /** A newer count is on its way: the old number dims. */
  pending?: boolean;
  /** One line under the number, e.g. why it is a wider count than the filters ask for. */
  note?: string | null;
}

const DURATION_MS = 380;

function useEasedNumber(target: number | null): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    if (target == null) { setShown(null); from.current = null; return; }
    const start = from.current ?? target;
    const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || start === target || typeof requestAnimationFrame !== "function") { setShown(target); from.current = target; return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (target - start) * eased);
      setShown(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

export function LiveCount({ value, capped, pending, note }: LiveCountProps) {
  const shown = useEasedNumber(value);
  const text = shown == null ? "—" : `${shown.toLocaleString()}${capped && shown === value ? "+" : ""}`;
  return (
    <div className="text-center" data-testid="live-count">
      <p
        aria-live="polite"
        aria-atomic="true"
        className={`text-5xl font-semibold leading-none tracking-tight tabular-nums text-white transition-opacity duration-200 sm:text-6xl ${pending ? "opacity-50" : "opacity-100"}`}
      >
        {text}
      </p>
      <p className="mt-2 text-sm text-ink-muted">{value === 1 && !capped ? "vehicle matches" : "vehicles match"}</p>
      {note && <p className="mt-1 text-xs text-ink-faint">{note}</p>}
    </div>
  );
}
