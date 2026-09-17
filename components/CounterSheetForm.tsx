"use client";

import React, { useMemo, useState } from "react";
import { COUNTER_COPY, type CounterEditsPayload } from "../lib/buyerCounter";
import { applyCashCounter, applyFinanceCounter, applyLeaseCounter, changedKeys, isDocFee, validateCounterSheet, type CounterKind, type CounterSheet, type LeaseCounterEdits, type UsedCounterEdits } from "../lib/counterSheet";
import type { LeaseQuote, LineItem } from "../lib/leaseQuote";
import type { UsedQuote } from "../lib/usedQuote";
import { CounterComparison } from "./CounterComparison";

/**
 * The buyer's counter as the dealer's own sheet with only the price-side
 * lines unlocked. Everything the lender or the state set is shown but
 * fixed; the payment recomputes live from the dealer's own factors, and the
 * preview underneath is the exact before/after the dealer will see. Terms
 * never change here. Still a request, not a binding bid.
 */
type Line = { name: string; amount: string };
const money = (raw: string): number | undefined => {
  const t = raw.replace(/[$,\s]/g, "");
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
};
const toLines = (items: LineItem[] | undefined): Line[] => (items || []).map((i) => ({ name: i.name, amount: String(i.amount) }));
const fromLines = (lines: Line[]): LineItem[] => lines.map((l) => ({ name: l.name.trim(), amount: money(l.amount) ?? 0 })).filter((l) => l.name);

export function CounterSheetForm({
  dealerName,
  quote,
  quoteId,
  onSubmit,
  onCancel,
}: {
  dealerName: string;
  quote: { lease?: LeaseQuote | null; used?: UsedQuote | null };
  quoteId: string;
  onSubmit: (payload: CounterEditsPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const kind: CounterKind = quote.lease ? "lease" : (quote.used?.kind as CounterKind);
  const lease = quote.lease || null;
  const used = quote.used || null;
  const [price, setPrice] = useState(String(lease ? lease.capCost : used?.sellingPrice ?? ""));
  const [down, setDown] = useState(String(lease ? lease.capReduction : used?.kind === "finance" ? used.downPayment : ""));
  const [addOns, setAddOns] = useState<Line[]>(toLines(lease ? lease.addOns : used?.addOns));
  const [rebates, setRebates] = useState<Line[]>(toLines(lease ? lease.incentives : used?.rebates));
  const [fees, setFees] = useState<Line[]>(toLines(lease ? lease.dueAtSigning.otherFees : used?.dueAtSigning));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const edits = useMemo<LeaseCounterEdits | UsedCounterEdits>(() => {
    if (kind === "lease") {
      const e: LeaseCounterEdits = { addOns: fromLines(addOns), incentives: fromLines(rebates), otherFees: fromLines(fees) };
      const p = money(price); if (p !== undefined) e.capCost = p;
      const d = money(down); if (d !== undefined) e.capReduction = d;
      return e;
    }
    const e: UsedCounterEdits = { addOns: fromLines(addOns), rebates: fromLines(rebates), dueAtSigning: fromLines(fees) };
    const p = money(price); if (p !== undefined) e.sellingPrice = p;
    if (kind === "finance") { const d = money(down); if (d !== undefined) e.downPayment = d; }
    return e;
  }, [kind, price, down, addOns, rebates, fees]);

  const sheet = useMemo<CounterSheet | null>(() => {
    let base: Omit<CounterSheet, "changed"> | null = null;
    if (lease) base = { kind: "lease", before: lease, after: applyLeaseCounter(lease, edits as LeaseCounterEdits) };
    else if (used?.kind === "finance") base = { kind: "finance", before: used, after: applyFinanceCounter(used, edits as UsedCounterEdits) };
    else if (used?.kind === "cash") base = { kind: "cash", before: used, after: applyCashCounter(used, edits as UsedCounterEdits) };
    return base ? { ...base, changed: changedKeys(base) } : null;
  }, [lease, used, edits]);
  const errors = sheet ? validateCounterSheet(sheet) : ["No quote to counter."];

  const input = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none tabular-nums";
  const label = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";
  const setLine = (list: Line[], set: (l: Line[]) => void, i: number, amount: string) => set(list.map((l, j) => (j === i ? { ...l, amount } : l)));
  const strike = (list: Line[], set: (l: Line[]) => void, i: number) => setLine(list, set, i, "0");

  const submit = async () => {
    if (!sheet || errors.length) return;
    setBusy(true);
    setServerError(null);
    try {
      await onSubmit({ againstQuoteId: quoteId, edits, note: note.trim() || null });
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Could not send your counter.");
    } finally {
      setBusy(false);
    }
  };

  const priceLabel = kind === "lease" ? "Cap cost (selling price)" : "Selling price";
  const downLabel = kind === "lease" ? "Cap reduction (cash down)" : "Down payment";
  const feeEditable = (name: string) => (kind === "lease" ? true : isDocFee(name));

  return (
    <div className="space-y-3 rounded-xl border border-sky-500/40 bg-sky-950/20 px-4 py-3" data-testid="counter-sheet-form" data-kind={kind}>
      <div>
        <p className="text-xs font-bold text-white">Counter {dealerName}&apos;s quote — edit only the lines you&apos;re asking about</p>
        <p className="text-[10px] text-ink-muted">
          {kind === "lease" ? "Money factor, residual, term, miles, acquisition fee and taxes stay as quoted; the monthly and due-at-signing recompute from their own factors." : kind === "finance" ? "APR, term, tax and title stay as quoted; amount financed and the monthly recompute." : "Tax and title stay as quoted; out-the-door recomputes."}{" "}
          Prices and fees can only go down, add-ons can be lowered or struck, rebates added. {COUNTER_COPY}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={label}>{priceLabel} <span className="normal-case font-normal text-ink-muted">— quoted ${(lease ? lease.capCost : used!.sellingPrice).toLocaleString()}</span></span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={input} data-testid="counter-price" />
        </label>
        {kind !== "cash" ? (
          <label className="space-y-1">
            <span className={label}>{downLabel} <span className="normal-case font-normal text-ink-muted">— quoted ${(lease ? lease.capReduction : (used as { downPayment: number }).downPayment).toLocaleString()}</span></span>
            <input value={down} onChange={(e) => setDown(e.target.value)} inputMode="decimal" className={input} data-testid="counter-down" />
          </label>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <span className={label}>Add-ons <span className="normal-case font-normal text-ink-muted">— lower or strike</span></span>
          {addOns.length === 0 ? <p className="text-[10px] text-ink-faint">None quoted.</p> : null}
          {addOns.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink-light">{l.name}</span>
              <input value={l.amount} onChange={(e) => setLine(addOns, setAddOns, i, e.target.value)} inputMode="decimal" className={`${input} w-24 flex-none`} aria-label={`Add-on ${l.name}`} />
              <button type="button" onClick={() => strike(addOns, setAddOns, i)} className="text-[10px] font-bold text-rose-300 hover:text-white" title="Ask to remove this add-on">strike</button>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <span className={label}>Fees <span className="normal-case font-normal text-ink-muted">— {kind === "lease" ? "lower any" : "doc fee only"}</span></span>
          {fees.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className={`min-w-0 flex-1 truncate text-[11px] ${feeEditable(l.name) ? "text-ink-light" : "text-ink-faint"}`}>{l.name}{feeEditable(l.name) ? "" : " (fixed)"}</span>
              <input value={l.amount} onChange={(e) => setLine(fees, setFees, i, e.target.value)} inputMode="decimal" disabled={!feeEditable(l.name)} className={`${input} w-24 flex-none disabled:opacity-50`} aria-label={`Fee ${l.name}`} />
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <span className={label}>{kind === "lease" ? "Incentives" : "Rebates"} <span className="normal-case font-normal text-ink-muted">— add or raise</span></span>
          {rebates.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={l.name} onChange={(e) => setRebates(rebates.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className={`${input} min-w-0 flex-1`} aria-label="Rebate name" />
              <input value={l.amount} onChange={(e) => setLine(rebates, setRebates, i, e.target.value)} inputMode="decimal" className={`${input} w-24 flex-none`} aria-label={`Rebate ${l.name || i + 1}`} />
            </div>
          ))}
          <button type="button" onClick={() => setRebates([...rebates, { name: "", amount: "" }])} className="text-[10px] font-bold text-sky-300 hover:text-white" data-testid="counter-add-rebate">+ Add a rebate you qualify for</button>
        </div>
      </div>

      <label className="block space-y-1">
        <span className={label}>Note to the dealer (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="e.g. I have the loyalty rebate — happy to sign this week at these numbers." className={input} />
      </label>

      {sheet ? (
        <div className="space-y-1">
          <p className={label}>Preview — what {dealerName} will see</p>
          <CounterComparison sheet={sheet} compact />
        </div>
      ) : null}

      {errors.length ? (
        <ul className="space-y-0.5 text-[11px] text-rose-300" data-testid="counter-errors">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : null}
      {serverError ? <p className="text-[11px] text-rose-300">{serverError}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={submit} disabled={busy || errors.length > 0} className="rounded-lg bg-sky-400 px-3.5 py-1.5 text-[11px] font-black text-black hover:bg-sky-300 disabled:opacity-50" data-testid="send-counter">
          {busy ? "Sending…" : "Send counter"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-3.5 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50">Cancel</button>
        <span className="text-[10px] text-ink-faint">{COUNTER_COPY}</span>
      </div>
    </div>
  );
}
