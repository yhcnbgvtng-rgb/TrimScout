"use client";

import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { isCounter, overMaxCashDue, validateLeaseQuote, LEASE_MILES, LEASE_TERMS, type LeaseQuote, type LeaseRequestPrefs, type LineItem } from "../lib/leaseQuote";
import { aprFromMf, dasTotal, dueAtSigningFrom, effectiveMonthly, monthlyPreTax, monthlyWithTax, netCapCost, num, residualAmountFrom, totalLeaseCost } from "../lib/leaseMath";
import { getZipCoordinates } from "../lib/otdCalculator";

/**
 * The buyer-side lease calculator: record what a dealer quoted (email,
 * phone, text) as the same structured lease contract the dealer's own
 * calculator produces — not a new request, and never a monthly-only or
 * lump-sum entry. Stacked inputs → computed results, everything blank
 * until the numbers exist. Standard lease arithmetic (lib/leaseMath.ts);
 * no third-party branding or copy.
 */
type Draft = {
  msrp: string;
  capCost: string;
  capReduction: string;
  acquisitionFee: string;
  termMonths: string;
  milesPerYear: string;
  residualPercent: string;
  residualAmount: string;
  moneyFactor: string;
  taxRatePercent: string;
  taxesAtSigning: string;
  expiresAt: string;
  vin: string;
  stockNumber: string;
  notes: string;
  counterNote: string;
};
type DraftItem = { name: string; amount: string };

const money = (n: number | null, digits = 0) =>
  n == null ? null : `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

function Blank() {
  return <span className="text-ink-faint">—</span>;
}

export function LeaseCalculatorSheet({
  prefs,
  vin,
  stockNumber,
  onSubmit,
  onCancel,
}: {
  prefs: LeaseRequestPrefs;
  vin: string;
  stockNumber: string | null;
  onSubmit: (input: { lease: LeaseQuote; vin: string; stockNumber: string | null; mustHaveAcknowledgement: boolean }) => Promise<void>;
  onCancel: () => void;
}) {
  // Every number starts blank. Only identity (VIN) and the tax-rate context
  // from the buyer's ZIP are prefilled — and the rate is editable.
  const zipRate = prefs.zip ? getZipCoordinates(prefs.zip).taxRate : null;
  const [f, setF] = useState<Draft>({
    msrp: "",
    capCost: "",
    capReduction: "",
    acquisitionFee: "",
    termMonths: "",
    milesPerYear: "",
    residualPercent: "",
    residualAmount: "",
    moneyFactor: "",
    taxRatePercent: zipRate != null ? String(Math.round(zipRate * 10000) / 100) : "",
    taxesAtSigning: "",
    expiresAt: "",
    vin,
    stockNumber: stockNumber || "",
    notes: "",
    counterNote: "",
  });
  const [incentives, setIncentives] = useState<DraftItem[]>([]);
  const [otherFees, setOtherFees] = useState<DraftItem[]>([]);
  const [addOns, setAddOns] = useState<DraftItem[]>([]);
  const [counterOffer, setCounterOffer] = useState(false);
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const items = (list: DraftItem[]): LineItem[] => list.map((i) => ({ name: i.name.trim(), amount: num(i.amount) ?? NaN })).filter((i) => i.name && Number.isFinite(i.amount));

  // --- derived, all nullable ------------------------------------------
  const d = useMemo(() => {
    const msrp = num(f.msrp);
    const capCost = num(f.capCost);
    const capReduction = num(f.capReduction);
    const term = num(f.termMonths);
    const miles = num(f.milesPerYear);
    const residualPercent = num(f.residualPercent);
    const residualFromMsrp = residualAmountFrom(msrp, residualPercent);
    const residualAmount = num(f.residualAmount) ?? residualFromMsrp;
    const mf = num(f.moneyFactor);
    const taxRate = num(f.taxRatePercent) != null ? num(f.taxRatePercent)! / 100 : null;
    const inc = items(incentives);
    const netCap = netCapCost({ capCost, capReduction, incentivesTotal: inc.reduce((t, i) => t + i.amount, 0) });
    const monthly = monthlyPreTax({ netCap, residualAmount, moneyFactor: mf, termMonths: term });
    const taxed = monthlyWithTax(monthly, taxRate);
    const das = dueAtSigningFrom({ monthly, monthlyTaxed: taxed, acquisitionFee: num(f.acquisitionFee), capReduction, taxesOverride: num(f.taxesAtSigning), taxRate, otherFees: items(otherFees) });
    const total = totalLeaseCost(monthly, term, das);
    return { msrp, capCost, capReduction, term, miles, residualPercent, residualFromMsrp, residualAmount, mf, apr: aprFromMf(mf), taxRate, netCap, monthly, taxed, das, dasTotal: dasTotal(das), total, effective: effectiveMonthly(total, term), incentives: inc };
  }, [f, incentives, otherFees]);

  const quote: Partial<LeaseQuote> = {
    capCost: d.capCost ?? undefined,
    residualPercent: d.residualPercent ?? undefined,
    residualAmount: d.residualAmount ?? undefined,
    moneyFactor: d.mf ?? undefined,
    termMonths: d.term ?? undefined,
    milesPerYear: d.miles ?? undefined,
    capReduction: d.capReduction ?? 0,
    monthlyPaymentPreTax: d.monthly ?? undefined,
    monthlyPaymentWithEstTax: d.taxed,
    dueAtSigning: d.das ?? undefined,
    incentives: d.incentives,
    addOns: items(addOns),
    expiresAt: f.expiresAt ? new Date(f.expiresAt + "T23:59:59").toISOString() : "",
    notes: f.notes.trim() || null,
    counter: { counterOffer, note: f.counterNote },
  };
  const validation = validateLeaseQuote(quote, prefs, { vin: f.vin, stockNumber: f.stockNumber });
  const termMilesDiffer = (d.term != null && d.term !== prefs.termMonths) || (d.miles != null && d.miles !== prefs.milesPerYear);
  const overCap = overMaxCashDue(d.das, prefs);
  const flagged = termMilesDiffer || overCap;
  const counterNow = d.term != null && d.miles != null && isCounter({ termMonths: d.term, milesPerYear: d.miles, dueAtSigning: d.das ?? undefined }, prefs);

  const submit = async () => {
    if (validation.errors.length) {
      setError(validation.errors);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ lease: quote as LeaseQuote, vin: f.vin.trim().toUpperCase(), stockNumber: f.stockNumber.trim() || null, mustHaveAcknowledgement: ack });
    } catch (err) {
      setError([err instanceof Error ? err.message : "Could not record this quote."]);
      setSubmitting(false);
    }
  };

  const input = "w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none tabular-nums";
  const label = "block text-[10px] font-bold uppercase tracking-wide text-ink-light";
  const hint = "block text-[10px] text-ink-faint";
  // Render helpers (not components): a component defined inside render is a
  // new type every render, which remounts its inputs and drops focus per keystroke.
  const field = ({ k, title, note, placeholder, mono }: { k: keyof Draft; title: string; note?: string; placeholder?: string; mono?: boolean }) => (
    <label className="space-y-1">
      <span className={label}>{title}</span>
      <input type="text" inputMode="decimal" value={f[k]} onChange={set(k)} placeholder={placeholder || ""} className={`${input} ${mono ? "font-mono" : ""}`} />
      {note ? <span className={hint}>{note}</span> : null}
    </label>
  );
  const itemList = ({ title, list, setList, addLabel, placeholder }: { title: string; list: DraftItem[]; setList: React.Dispatch<React.SetStateAction<DraftItem[]>>; addLabel: string; placeholder: string }) => (
    <div className="space-y-1.5">
      <span className={label}>{title}</span>
      {list.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input type="text" value={it.name} onChange={(e) => setList((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={placeholder} className={`${input} flex-1`} />
          <input type="text" inputMode="decimal" value={it.amount} onChange={(e) => setList((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="Amount" className={`${input} w-28`} />
          <button type="button" onClick={() => setList((p) => p.filter((_, j) => j !== i))} className="text-ink-muted hover:text-rose-400" aria-label={`Remove ${title.toLowerCase()} line`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setList((p) => [...p, { name: "", amount: "" }])} className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300">
        <Plus className="h-3 w-3" /> {addLabel}
      </button>
    </div>
  );
  const out = ({ title, value, strong, tone }: { title: string; value: string | null; strong?: boolean; tone?: string }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-ink-muted">{title}</span>
      <span className={`tabular-nums ${strong ? "text-base font-extrabold" : "text-xs font-semibold"} ${tone || "text-white"}`}>{value ?? <Blank />}</span>
    </div>
  );

  return (
    <div className="space-y-4 rounded-xl border border-border bg-background p-4" data-testid="lease-calculator-sheet">
      <p className="text-[11px] text-ink-muted">
        Record the dealer&apos;s lease quote — from their email, call or text — through this calculator. It&apos;s a record of their reply, not a new request; the same fields every dealer quotes on.
      </p>

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          {/* 1 — Deal inputs */}
          <section className="space-y-2.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">1 · Deal inputs</h4>
            <div className="grid grid-cols-2 gap-2.5">
              {field({ k: "msrp", title: "MSRP (optional)", note: "Used only to turn residual % into dollars." })}
              {field({ k: "capCost", title: "Cap cost / selling price", note: "Required to calculate." })}
              {field({ k: "capReduction", title: "Cap cost reduction / cash down" })}
              {field({ k: "acquisitionFee", title: "Acquisition fee" })}
            </div>
            {itemList({ title: "Incentives / rebates", list: incentives, setList: setIncentives, addLabel: "Add incentive", placeholder: "e.g. Loyalty" })}
            {itemList({ title: "Other fees at signing (itemized)", list: otherFees, setList: setOtherFees, addLabel: "Add fee", placeholder: "e.g. Doc fee" })}
            {itemList({ title: "Add-ons", list: addOns, setList: setAddOns, addLabel: "Add add-on", placeholder: "e.g. Wheel & tire" })}
          </section>

          {/* 2 — Lease terms */}
          <section className="space-y-2.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">2 · Lease terms</h4>
            <p className={hint}>
              You asked for {prefs.termMonths} mo · {prefs.milesPerYear.toLocaleString()} mi/yr
              {prefs.maxCashDueAtSigning != null ? ` · max $${prefs.maxCashDueAtSigning.toLocaleString()} due at signing` : ""}. A different term, miles or a higher due-at-signing is a counter.
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="space-y-1">
                <span className={label}>Term (months)</span>
                <select value={f.termMonths} onChange={set("termMonths")} className={input}>
                  <option value="">Choose</option>
                  {LEASE_TERMS.map((t) => (
                    <option key={t} value={t}>{t}{t === prefs.termMonths ? " (your pick)" : ""}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={label}>Miles per year</span>
                <select value={f.milesPerYear} onChange={set("milesPerYear")} className={input}>
                  <option value="">Choose</option>
                  {LEASE_MILES.map((m) => (
                    <option key={m} value={m}>{m.toLocaleString()}{m === prefs.milesPerYear ? " (your pick)" : ""}</option>
                  ))}
                </select>
              </label>
              {field({ k: "residualPercent", title: "Residual %", note: d.residualFromMsrp != null && !f.residualAmount ? `= ${money(d.residualFromMsrp)} of MSRP` : undefined })}
              {field({ k: "residualAmount", title: "Residual amount ($)", note: d.residualFromMsrp != null ? "Calculated from MSRP — type to override." : "Enter MSRP above, or type the dollar residual.", placeholder: d.residualFromMsrp != null ? String(d.residualFromMsrp) : "", mono: true })}
              {field({ k: "moneyFactor", title: "Money factor", note: d.apr != null ? `≈ ${d.apr}% APR` : "e.g. 0.00225", mono: true })}
            </div>
          </section>

          {/* 3 — Tax context */}
          <section className="space-y-2.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">3 · Tax context</h4>
            <div className="grid grid-cols-2 gap-2.5">
              {field({ k: "taxRatePercent", title: "Sales tax rate (%)", note: prefs.zip ? `Estimated for ZIP ${prefs.zip} — edit if the dealer used another rate. Blank = tax estimated at signing.` : "Blank = tax estimated at signing." })}
              {field({ k: "taxesAtSigning", title: "Taxes due at signing", note: "Defaults to tax on the cap reduction; type the dealer's figure to override." })}
            </div>
          </section>

          {/* 5 — Meta */}
          <section className="space-y-2.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Quote details</h4>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="space-y-1">
                <span className={label}>Quote expires</span>
                <input type="date" value={f.expiresAt} onChange={set("expiresAt")} className={input} />
                <span className={hint}>Required to save.</span>
              </label>
              {field({ k: "vin", title: "VIN quoted", mono: true })}
              {field({ k: "stockNumber", title: "Stock # (optional)", mono: true })}
            </div>
            <label className="space-y-1 block">
              <span className={label}>Notes (optional)</span>
              <textarea value={f.notes} onChange={set("notes")} rows={2} className={input} />
            </label>
            {flagged ? (
              <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/20 px-3.5 py-3">
                <label className="flex items-start gap-2 text-xs text-amber-100">
                  <input type="checkbox" checked={counterOffer} onChange={(e) => setCounterOffer(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
                  <span>
                    This is a <strong>counter-offer</strong> — {overCap && prefs.maxCashDueAtSigning != null ? `due at signing is above your max of $${prefs.maxCashDueAtSigning.toLocaleString()}` : `the term or miles differ from what you asked for (${prefs.termMonths} mo / ${prefs.milesPerYear.toLocaleString()} mi)`}. Save it flagged.
                  </span>
                </label>
                <input type="text" value={f.counterNote} onChange={set("counterNote")} placeholder="The dealer's reason, in a few words" maxLength={300} className={input} />
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-[11px] text-ink-light">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
              <span>The dealer confirmed all locked must-haves are on this VIN before quoting.</span>
            </label>
          </section>
        </div>

        {/* 4 — Results */}
        <aside className="h-fit space-y-3 rounded-xl border border-border bg-surface p-4 lg:sticky lg:top-4" data-testid="lease-results">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">4 · Results</h4>
          {out({ title: "Monthly (pre-tax)", value: money(d.monthly, 2), strong: true })}
          {out({ title: d.taxRate != null ? "Monthly with est. tax" : "Tax", value: d.taxRate != null ? money(d.taxed, 2) : d.monthly != null ? "estimated at signing" : null })}
          <div className="border-t border-border/60 pt-2">
            {out({ title: "Due at signing", value: money(d.dasTotal, 2), strong: true, tone: overCap ? "text-amber-300" : undefined })}
            {d.das ? (
              <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted tabular-nums">
                <li className="flex justify-between"><span>First month</span><span>{money(d.das.firstMonth, 2)}</span></li>
                <li className="flex justify-between"><span>Acquisition fee</span><span>{money(d.das.acquisitionFee, 2)}</span></li>
                <li className="flex justify-between"><span>Cap reduction</span><span>{money(d.das.capReduction, 2)}</span></li>
                <li className="flex justify-between"><span>Taxes</span><span>{money(d.das.taxes, 2)}</span></li>
                {d.das.otherFees.map((x, i) => (
                  <li key={i} className="flex justify-between"><span>{x.name}</span><span>{money(x.amount, 2)}</span></li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[10px] text-ink-faint">Itemized once cap cost, residual, money factor and term are in.</p>
            )}
            {overCap && prefs.maxCashDueAtSigning != null ? <p className="mt-1 text-[10px] font-bold text-amber-300">Over your ${prefs.maxCashDueAtSigning.toLocaleString()} max</p> : null}
          </div>
          <div className="border-t border-border/60 pt-2 space-y-1">
            {out({ title: "Net cap cost", value: money(d.netCap) })}
            {out({ title: "Residual", value: d.residualAmount != null ? `${money(d.residualAmount)}${d.residualPercent != null ? ` (${d.residualPercent}%)` : ""}` : null })}
            {out({ title: "Money factor", value: d.mf != null ? `${d.mf}${d.apr != null ? ` ≈ ${d.apr}% APR` : ""}` : null })}
            {out({ title: "Total lease cost", value: money(d.total) })}
            {out({ title: "Effective monthly", value: money(d.effective, 2) })}
          </div>
          {counterNow ? <p className="rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-300">Counter vs. your prefs</p> : null}
        </aside>
      </div>

      {error ? (
        <ul className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300 space-y-0.5">
          {error.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {!error && validation.warnings.length ? (
        <ul className="text-[10px] text-amber-200/90 space-y-0.5">
          {validation.warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={submitting} className="flex-1 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all disabled:opacity-50">
          {submitting ? "Saving…" : "Save Quote"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2.5 text-xs font-bold text-ink-light hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}
