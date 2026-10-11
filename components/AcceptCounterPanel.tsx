"use client";

import React, { useMemo, useState } from "react";
import { CounterComparison } from "./CounterComparison";
import { acceptedOutTheDoor, buildAcceptedQuote, prefillTax, taxBaseChanged } from "../lib/acceptCounter";
import { isTaxLine } from "../lib/counterSheet";
import type { BuyerCounter } from "../lib/rfq";
import type { UsedCashQuote } from "../lib/usedQuote";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The dealer's one-step "yes" to a buyer's counter on a cash quote: the
 * countered lines, the new out-the-door, and the sales-tax field — the only
 * thing they can edit. Doc fee, title & registration and every other line
 * are the counter's own and are shown, not editable. The server re-checks.
 */
export function AcceptCounterPanel({ token, counter, onAccepted, onCancel }: { token: string; counter: BuyerCounter & { sheet: NonNullable<BuyerCounter["sheet"]> }; onAccepted: (outTheDoor: number) => void; onCancel: () => void }) {
  const before = counter.sheet.before as UsedCashQuote;
  const after = counter.sheet.after as UsedCashQuote;
  const changed = taxBaseChanged(before, after);
  const [taxText, setTaxText] = useState(() => String(prefillTax(before, after)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tax = Number(taxText.replace(/[$,\s]/g, ""));
  const taxOk = taxText.trim() !== "" && Number.isFinite(tax) && tax >= 0;
  const accepted = useMemo(() => buildAcceptedQuote(after, taxOk ? tax : 0, counter.sentAt), [after, tax, taxOk, counter.sentAt]);
  const otd = acceptedOutTheDoor(accepted);
  const hasTaxLine = after.dueAtSigning.some((l) => isTaxLine(l.name));

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quote-invite/accept-counter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, quote: accepted }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((Array.isArray(j.errors) && j.errors.join(" ")) || j.error || "Could not accept the counter.");
      onAccepted(typeof j.outTheDoor === "number" ? j.outTheDoor : otd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept the counter.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4" data-testid="accept-counter-panel">
      <p className="font-bold text-white">Accept the buyer&apos;s counter</p>
      <p className="text-xs text-amber-100/90">You&apos;re sending a revised quote equal to their counter. Doc fee, title &amp; registration and every other line are fixed; only sales tax can change.</p>
      <CounterComparison sheet={{ ...counter.sheet, after: accepted }} beforeLabel="You quoted" afterLabel="Accepting" compact />
      <label className="block text-xs text-ink-light">
        Sales tax{changed ? " — recalculated at the rate of your original quote" : ""}
        <div className="mt-1 flex items-center gap-2">
          <span className="text-white">$</span>
          <input type="text" inputMode="decimal" value={taxText} onChange={(e) => setTaxText(e.target.value)} disabled={!hasTaxLine || busy} className="w-32 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-white tabular-nums" data-testid="accept-counter-tax" />
        </div>
      </label>
      <p className="text-sm text-white">Final out-the-door: <strong className="tabular-nums" data-testid="accept-counter-otd">{money(otd)}</strong></p>
      {error ? <p className="text-xs text-rose-300" data-testid="accept-counter-error">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={confirm} disabled={busy || !taxOk || !hasTaxLine} className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50" data-testid="accept-counter-confirm">{busy ? "Sending…" : "Confirm and send"}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink-light hover:bg-surface disabled:opacity-50">Back</button>
      </div>
    </div>
  );
}
