"use client";

import React, { useState } from "react";

/**
 * Shown only to an account on BUYER_TEST_MODE_EMAILS (session.user.testMode, derived on the server). Says what
 * test mode does, and carries the "Walk away from all my test requests" button. The route behind it answers 404 to
 * anyone not on the list, so hiding the bar is a convenience, not the guard.
 */
export function TestModeBar({ onWalked }: { onWalked?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const walkAll = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/test-mode/walk-all", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(json.error || "Could not walk away from your test requests.");
        return;
      }
      setNote(json.walked ? `Walked away from ${json.walked} test request${json.walked === 1 ? "" : "s"}.` : "No open test requests.");
      onWalked?.();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3.5 py-2.5 text-[11px] text-sky-200 flex flex-wrap items-center gap-x-3 gap-y-2" role="status" data-testid="test-mode-bar">
      <span>
        <strong>Test mode.</strong> No one-request limit. Every request is SAFE MODE (dealer email goes to the owner only) and flagged audit, so it stays out of metrics.
      </span>
      <button
        type="button"
        onClick={walkAll}
        disabled={busy}
        data-testid="test-mode-walk-all"
        className="rounded-md border border-sky-400/50 px-2.5 py-1 font-bold text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"
      >
        {busy ? "Walking away…" : "Walk away from all my test requests"}
      </button>
      {note ? <span data-testid="test-mode-note">{note}</span> : null}
    </div>
  );
}
