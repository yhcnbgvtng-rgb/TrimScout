import React from "react";
import type { LoadFailure } from "@/lib/dealerAnalyticsPage";

const COPY: Record<LoadFailure, { title: string; body: string }> = {
  not_built: { title: "Dealer analytics not built yet", body: "First run pending. The nightly job fills these tables; check back after it has run." },
  not_found: { title: "Dealer not found", body: "No dealer with that id is in the latest run." },
  error: { title: "Could not load dealer analytics", body: "Something went wrong reaching the data service. Try Refresh." },
};

export function AnalyticsMessage({ kind, detail }: { kind: LoadFailure; detail?: string }) {
  const c = COPY[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} data-testid={`state-${kind}`} className="rounded-xl border border-border bg-surface/50 px-6 py-10 text-center">
      <p className="text-sm font-black text-white">{c.title}</p>
      <p className="mt-1 text-xs text-ink-muted">{c.body}</p>
      {kind === "error" && detail ? <p className="mt-2 text-[11px] text-ink-muted">{detail}</p> : null}
    </div>
  );
}

export function Skeleton({ rows = 8, testId = "skeleton" }: { rows?: number; testId?: string }) {
  return (
    <div data-testid={testId} aria-busy="true" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-elevated" />)}
    </div>
  );
}
