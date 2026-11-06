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
  /** The sidebar version: a small number beside its label instead of the large centred headline. */
  compact?: boolean;
}

const DURATION_MS = 380;

/**
 * The count shown `p` of the way from `start` to `target`. `p` is clamped to 0..1 (a requestAnimationFrame timestamp can be earlier than the
 * performance.now() the animation started at, which made `p` negative and the cubic ease swing past the start), and the result is held
 * between the two ends and never below 0 — a vehicle count cannot be negative or exceed the real total.
 */
export function easedCount(start: number, target: number, p: number): number {
  const t = Number.isFinite(target) ? Math.max(0, target) : 0;
  const s = Number.isFinite(start) ? Math.max(0, start) : t;
  const q = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1;
  const eased = 1 - Math.pow(1 - q, 3);
  const v = Math.round(s + (t - s) * eased);
  return Math.max(0, Math.min(Math.max(s, t), Math.max(Math.min(s, t), v)));
}

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
      const p = Math.min(1, Math.max(0, (now - t0) / DURATION_MS));
      const v = easedCount(start, target, p);
      setShown(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

export function LiveCount({ value, capped, pending, note, compact }: LiveCountProps) {
  const shown = useEasedNumber(value);
  const text = shown == null ? "—" : `${shown.toLocaleString()}${capped ? "+" : ""}`;
  if (compact) {
    return (
      <div data-testid="live-count">
        <p className={`text-xs text-ink-light transition-opacity duration-200 ${pending ? "opacity-50" : "opacity-100"}`}>
          <span aria-live="polite" aria-atomic="true" className="text-2xl font-semibold tabular-nums text-white">{text}</span>{" "}
          {value === 1 && !capped ? "vehicle matches" : "vehicles match"}
        </p>
        {note && <p className="mt-1 text-[11px] text-ink-faint">{note}</p>}
      </div>
    );
  }
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
