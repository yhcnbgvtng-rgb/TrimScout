"use client";
import React, { useEffect, useRef, useState } from "react";

const LEFT = ["Your build", "Must-haves", "Trade-in"];
const RIGHT = ["Dealer 1", "Dealer 2", "Dealer 3"];
const ROWS = [40, 120, 200];
const RUN_MS = 1700;
const FADE_MS = 300;

/** CSS/SVG only, no libraries. Streaks flow left chips -> logo -> right chips, then the whole thing fades into step 1. */
export function QuoteIntro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const finished = useRef(false);

  const finish = (fadeMs: number) => {
    if (finished.current) return;
    finished.current = true;
    setLeaving(true);
    window.setTimeout(() => done.current(), fadeMs);
  };

  useEffect(() => {
    const t = window.setTimeout(() => finish(FADE_MS), RUN_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      data-testid="quote-intro"
      className="quote-intro absolute inset-0 z-20 flex flex-col items-center justify-center bg-surface px-4"
      style={{ opacity: leaving ? 0 : 1, transition: `opacity ${FADE_MS}ms ease` }}
      role="presentation"
    >
      <style>{`
        .quote-intro .qi-streak{stroke-dasharray:60 340;stroke-dashoffset:60;opacity:0;animation:qi-flow 700ms ease-in-out forwards}
        .quote-intro .qi-in{animation-delay:150ms}
        .quote-intro .qi-out{animation-delay:700ms}
        .quote-intro .qi-line{stroke-dasharray:1;opacity:0;animation:qi-fade 400ms ease forwards}
        .quote-intro .qi-chip{opacity:0;animation:qi-fade 350ms ease forwards}
        .quote-intro .qi-chip-r{animation-delay:650ms}
        .quote-intro .qi-ring{transform-origin:210px 120px;animation:qi-glow 1500ms ease-in-out forwards}
        .quote-intro .qi-logo{opacity:0;animation:qi-fade 400ms ease 100ms forwards}
        @keyframes qi-flow{0%{stroke-dashoffset:60;opacity:0}15%{opacity:1}100%{stroke-dashoffset:-340;opacity:0}}
        @keyframes qi-fade{to{opacity:1}}
        @keyframes qi-glow{0%{transform:scale(.9);opacity:.3}50%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:.85}}
        @media (prefers-reduced-motion: reduce){.quote-intro *{animation:none!important}}
      `}</style>
      <svg viewBox="0 0 420 240" className="w-full max-w-md" aria-hidden="true">
        <defs>
          <clipPath id="qi-clip"><circle cx="210" cy="120" r="32" /></clipPath>
          <radialGradient id="qi-glow-g">
            <stop offset="55%" stopColor="#5DB391" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#5DB391" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="qi-streak-g" x1="0" x2="1">
            <stop offset="0%" stopColor="#B7E2D1" stopOpacity="0" />
            <stop offset="100%" stopColor="#B7E2D1" />
          </linearGradient>
        </defs>
        {ROWS.map((y, i) => (
          <React.Fragment key={y}>
            <path d={`M104 ${y} C160 ${y}, 160 120, 176 120`} fill="none" className="qi-line stroke-border-strong" strokeWidth="1" pathLength={1} />
            <path d={`M244 120 C260 120, 260 ${y}, 316 ${y}`} fill="none" className="qi-line stroke-border-strong" strokeWidth="1" pathLength={1} style={{ animationDelay: "500ms" }} />
            <path d={`M104 ${y} C160 ${y}, 160 120, 176 120 L244 120 C260 120, 260 ${y}, 316 ${y}`} fill="none" stroke="url(#qi-streak-g)" strokeWidth="1.5" strokeLinecap="round" className="qi-streak qi-in" style={{ animationDelay: `${150 + i * 90}ms` }} />
            <g className="qi-chip" style={{ animationDelay: `${i * 90}ms` }}>
              <rect x="0" y={y - 14} width="104" height="28" rx="14" className="fill-surface-elevated stroke-border-strong" strokeWidth="1" />
              <text x="52" y={y + 4} textAnchor="middle" className="fill-ink-muted" fontSize="11" fontWeight="600">{LEFT[i]}</text>
            </g>
            <g className="qi-chip qi-chip-r" style={{ animationDelay: `${650 + i * 90}ms` }}>
              <rect x="316" y={y - 14} width="104" height="28" rx="14" className="fill-surface-elevated stroke-border-strong" strokeWidth="1" />
              <text x="368" y={y + 4} textAnchor="middle" className="fill-ink-muted" fontSize="11" fontWeight="600">{RIGHT[i]}</text>
            </g>
          </React.Fragment>
        ))}
        <circle cx="210" cy="120" r="52" fill="url(#qi-glow-g)" className="qi-ring" />
        <circle cx="210" cy="120" r="34" className="fill-background stroke-brand-400 qi-ring" strokeWidth="1.5" />
        <g clipPath="url(#qi-clip)">
          <image href="/scoutmark.png" x="184" y="94" width="52" height="52" className="qi-logo" preserveAspectRatio="xMidYMid slice" />
        </g>
      </svg>
      <button
        type="button"
        onClick={() => finish(120)}
        data-testid="quote-intro-skip"
        className="absolute bottom-4 right-4 rounded px-2 py-1 text-xs text-ink-muted underline-offset-2 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        Skip
      </button>
    </div>
  );
}
