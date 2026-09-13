"use client";

import React, { useMemo, useState } from "react";
import {
  aprFromMoneyFactor,
  coerceLeaseQuote,
  dueAtSigningTotal,
  validateLeaseQuote,
  LEASE_MILES,
  LEASE_TERMS,
  type LeaseRequestPrefs,
  type LineItem,
} from "../lib/leaseQuote";

/**
 * The dealer's lease calculator — the only way a quote gets in. Every
 * field the buyer compares on is required; due at signing is itemized;
 * a term/miles that differ from the buyer's prefs must be marked as a
 * counter with a note. Validation is lib/leaseQuote.ts, shared with the
 * server, so what blocks here blocks there.
 */
export function LeaseCalculatorForm({
  token,
  vin,
  stockNumber,
  prefs,
  onSubmitted,
}: {
  token: string;
  vin: string;
  stockNumber: string | null;
  prefs: LeaseRequestPrefs;
  onSubmitted: (result: { warnings: string[]; dueAtSigningTotal: number }) => void;
}) {
  const [f, setF] = useState<Record<string, string>>({
    capCost: "",
    residualPercent: "",
    residualAmount: "",
    moneyFactor: "",
    termMonths: String(prefs.termMonths),
    milesPerYear: String(prefs.milesPerYear),
    capReduction: "0",
    monthlyPaymentPreTax: "",
    monthlyPaymentWithEstTax: "",
    firstMonth: "",
    acquisitionFee: "",
    dasCapReduction: "0",
    taxes: "",
    expiresAt: "",
    notes: "",
    counterNote: "",
    vin: vin,
    stockNumber: stockNumber || "",
  });
  const [otherFees, setOtherFees] = useState<LineItem[]>([{ name: "Doc fee", amount: 0 }]);
  const [incentives, setIncentives] = useState<LineItem[]>([]);
  const [addOns, setAddOns] = useState<LineItem[]>([]);
  const [counterOffer, setCounterOffer] = useState(false);
  const [noTaxEstimate, setNoTaxEstimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const quote = useMemo(
    () =>
      coerceLeaseQuote({
        capCost: f.capCost,
        residualPercent: f.residualPercent,
        residualAmount: f.residualAmount,
        moneyFactor: f.moneyFactor,
        termMonths: f.termMonths,
        milesPerYear: f.milesPerYear,
        capReduction: f.capReduction,
        monthlyPaymentPreTax: f.monthlyPaymentPreTax,
        monthlyPaymentWithEstTax: noTaxEstimate ? "" : f.monthlyPaymentWithEstTax,
        dueAtSigning: { firstMonth: f.firstMonth, acquisitionFee: f.acquisitionFee, capReduction: f.dasCapReduction, taxes: f.taxes, otherFees },
        incentives,
        addOns,
        expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : "",
        notes: f.notes,
        counter: { counterOffer, note: f.counterNote },
      }),
    [f, otherFees, incentives, addOns, counterOffer, noTaxEstimate]
  );
  const validation = useMemo(() => validateLeaseQuote(quote, prefs, { vin: f.vin, stockNumber: f.stockNumber }), [quote, prefs, f.vin, f.stockNumber]);
  const differs = Number(f.termMonths) !== prefs.termMonths || Number(f.milesPerYear) !== prefs.milesPerYear;
  const apr = Number(f.moneyFactor) > 0 ? aprFromMoneyFactor(Number(f.moneyFactor)) : null;
  const das = quote.dueAtSigning ? dueAtSigningTotal(quote.dueAtSigning) : 0;

  const submit = async () => {
    setTouched(true);
    setServerError(null);
    if (validation.errors.length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/quote-invite/lease-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, vin: f.vin, stockNumber: f.stockNumber, quote }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(Array.isArray(json.errors) && json.errors.length ? json.errors.join(" ") : json.error || "Could not submit the quote.");
        return;
      }
      onSubmitted({ warnings: json.warnings || [], dueAtSigningTotal: json.dueAtSigningTotal || das });
    } finally {
      setBusy(false);
    }
  };

  const money = (k: string, label: string, hint?: string, required = true) => (
    <label className="space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">
        {label} {required ? <span className="text-amber-300">*</span> : null}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={f[k]}
        onChange={set(k)}
        placeholder="0.00"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
      />
      {hint ? <span className="block text-[10px] text-ink-faint">{hint}</span> : null}
    </label>
  );

  const list = (items: LineItem[], setItems: (v: LineItem[]) => void, label: string, addLabel: string) => (
    <div className="space-y-1.5">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">{label}</span>
      {items.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="text"
            value={it.name}
            onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            placeholder="Name"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="text"
            inputMode="decimal"
            value={Number.isFinite(it.amount) ? String(it.amount) : ""}
            onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(/[$,\s]/g, "")) } : x)))}
            placeholder="0.00"
            className="w-32 shrink-0 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
          />
          <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="shrink-0 text-[10px] font-bold text-ink-muted hover:text-rose-400">
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setItems([...items, { name: "", amount: 0 }])} className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300">
        + {addLabel}
      </button>
    </div>
  );

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">VIN <span className="text-amber-300">*</span></span>
          <input type="text" value={f.vin} onChange={set("vin")} maxLength={17} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs uppercase text-white focus:border-emerald-500 focus:outline-none" />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Stock #</span>
          <input type="text" value={f.stockNumber} onChange={set("stockNumber")} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none" />
        </label>
      </div>

      <div className="rounded-xl border border-border/70 bg-surface-elevated px-3.5 py-3 text-xs text-ink-light">
        Buyer asked for <strong className="text-white">{prefs.termMonths} months · {prefs.milesPerYear.toLocaleString()} mi/yr</strong>
        {prefs.zip ? <> · ZIP {prefs.zip} (tax context)</> : null}. Quote to that, or mark a counter below.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Term (months) <span className="text-amber-300">*</span></span>
          <select value={f.termMonths} onChange={set("termMonths")} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            {LEASE_TERMS.map((t) => (
              <option key={t} value={t}>{t}{t === prefs.termMonths ? " (buyer's pick)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Miles / year <span className="text-amber-300">*</span></span>
          <select value={f.milesPerYear} onChange={set("milesPerYear")} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            {LEASE_MILES.map((m) => (
              <option key={m} value={m}>{m.toLocaleString()}{m === prefs.milesPerYear ? " (buyer's pick)" : ""}</option>
            ))}
          </select>
        </label>
        {money("capCost", "Cap cost", "Agreed vehicle price plus anything capitalized.")}
        {money("residualPercent", "Residual %", "Usually 40–70.")}
        {money("residualAmount", "Residual amount")}
        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Money factor <span className="text-amber-300">*</span></span>
          <input type="text" inputMode="decimal" value={f.moneyFactor} onChange={set("moneyFactor")} placeholder="0.00225" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none" />
          <span className="block text-[10px] text-ink-faint">{apr != null ? `≈ ${apr}% APR` : "Shown to the buyer as an APR equivalent."}</span>
        </label>
        {money("capReduction", "Cap reduction", "0 if none.")}
        {money("monthlyPaymentPreTax", "Monthly payment, pre-tax")}
        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Monthly with est. tax</span>
          <input type="text" inputMode="decimal" value={noTaxEstimate ? "" : f.monthlyPaymentWithEstTax} disabled={noTaxEstimate} onChange={set("monthlyPaymentWithEstTax")} placeholder="0.00" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none disabled:opacity-50" />
          <label className="flex items-center gap-1.5 text-[10px] text-ink-faint">
            <input type="checkbox" checked={noTaxEstimate} onChange={(e) => setNoTaxEstimate(e.target.checked)} className="h-3 w-3" />
            Can&apos;t estimate — tax estimated at signing
          </label>
        </label>
      </div>

      {differs ? (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/20 px-3.5 py-3">
          <label className="flex items-start gap-2 text-xs text-amber-100">
            <input type="checkbox" checked={counterOffer} onChange={(e) => setCounterOffer(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
            <span>
              This is a <strong>counter-offer</strong> — the term or miles differ from what the buyer asked for ({prefs.termMonths} mo / {prefs.milesPerYear.toLocaleString()} mi). The buyer will see it flagged.
            </span>
          </label>
          <input type="text" value={f.counterNote} onChange={set("counterNote")} placeholder="Why — e.g. 39 mo carries a better residual this month" maxLength={300} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none" />
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
          Due at signing — itemized <span className="text-amber-300">*</span>
          <span className="ml-2 font-normal normal-case text-ink-muted">A single lump sum is not accepted.</span>
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {money("firstMonth", "First month")}
          {money("acquisitionFee", "Acquisition fee")}
          {money("dasCapReduction", "Cap reduction")}
          {money("taxes", "Taxes")}
        </div>
        {list(otherFees, setOtherFees, "Other fees", "Add fee")}
        <p className="text-xs text-ink-light">
          Total due at signing: <strong className="font-mono text-white">${das.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {list(incentives, setIncentives, "Incentives applied", "Add incentive")}
        {list(addOns, setAddOns, "Add-ons included", "Add add-on")}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Quote good through <span className="text-amber-300">*</span></span>
          <input type="datetime-local" value={f.expiresAt} onChange={set("expiresAt")} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none" />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Notes</span>
          <textarea value={f.notes} onChange={set("notes")} rows={2} maxLength={1000} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none" />
        </label>
      </div>

      {touched && validation.errors.length ? (
        <ul className="space-y-1 rounded-xl border border-rose-500/40 bg-rose-950/20 px-3.5 py-3 text-xs text-rose-200" data-testid="lease-errors">
          {validation.errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      ) : null}
      {validation.warnings.length ? (
        <ul className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3.5 py-3 text-xs text-amber-200">
          {validation.warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}
      {serverError ? <p className="text-xs text-rose-300">{serverError}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={busy || (touched && validation.errors.length > 0)}
        className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-black hover:bg-emerald-400 transition-all disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit lease quote"}
      </button>
    </div>
  );
}
