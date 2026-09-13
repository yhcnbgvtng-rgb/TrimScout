"use client";

import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { overMaxCashDue, validateLeaseQuote, LEASE_MILES, LEASE_TERMS, type LeaseQuote, type LeaseRequestPrefs, type LineItem } from "../lib/leaseQuote";
import {
  aprFromMf,
  dasTotal,
  dueAtSigningFrom,
  formatMoneyFactorInput,
  formatMoneyInput,
  formatPercentInput,
  monthlyPreTax,
  monthlyWithTax,
  netCapFromWorksheet,
  num,
  residualAmountFrom,
} from "../lib/leaseMath";
import { getZipCoordinates } from "../lib/otdCalculator";

/**
 * The dealer's lease calculator — the only way a quote gets in. Laid out
 * the way a lease worksheet is built: MSRP → selling price → incentives →
 * net cap cost → term / miles → residual (% of MSRP, dollars autofilled)
 * → money factor (APR shown) → cap reduction → fees → monthly + tax →
 * due at signing itemized → add-ons, expiry, notes. Inputs format as
 * money / percent while typing and store numbers; every computed figure
 * stays blank until its inputs exist. Validation is lib/leaseQuote.ts,
 * shared with the server, so what blocks here blocks there. Standard lease
 * arithmetic (lib/leaseMath.ts); no third-party branding or copy.
 */
type Draft = {
  vin: string;
  stockNumber: string;
  msrp: string;
  sellingPrice: string;
  capCost: string; // override only; blank = derived
  termMonths: string;
  milesPerYear: string;
  residualPercent: string;
  residualAmount: string; // override only; blank = derived from MSRP × %
  moneyFactor: string;
  capReduction: string;
  acquisitionFee: string;
  taxRatePercent: string;
  taxesAtSigning: string;
  expiresAt: string;
  notes: string;
  counterNote: string;
};
type DraftItem = { name: string; amount: string };

const money = (n: number | null, digits = 0) => (n == null ? null : `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);

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
  const zipRate = prefs.zip ? getZipCoordinates(prefs.zip).taxRate : null;
  const [f, setF] = useState<Draft>({
    vin,
    stockNumber: stockNumber || "",
    msrp: "",
    sellingPrice: "",
    capCost: "",
    termMonths: String(prefs.termMonths),
    milesPerYear: String(prefs.milesPerYear),
    residualPercent: "",
    residualAmount: "",
    moneyFactor: "",
    capReduction: "",
    acquisitionFee: "",
    taxRatePercent: zipRate != null ? String(Math.round(zipRate * 10000) / 100) : "",
    taxesAtSigning: "",
    expiresAt: "",
    notes: "",
    counterNote: "",
  });
  const [incentives, setIncentives] = useState<DraftItem[]>([]);
  const [otherFees, setOtherFees] = useState<DraftItem[]>([]);
  const [addOns, setAddOns] = useState<DraftItem[]>([]);
  const [capitalizeAcq, setCapitalizeAcq] = useState(false);
  const [counterOffer, setCounterOffer] = useState(false);
  const [noTaxEstimate, setNoTaxEstimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  // Which formatted fields are being edited right now (show raw while typing).
  const [focused, setFocused] = useState<keyof Draft | null>(null);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const items = (list: DraftItem[]): LineItem[] => list.map((i) => ({ name: i.name.trim(), amount: num(i.amount) ?? NaN })).filter((i) => i.name && Number.isFinite(i.amount));

  // --- the worksheet, all nullable -------------------------------------
  const d = useMemo(() => {
    const msrp = num(f.msrp);
    const sellingPrice = num(f.sellingPrice);
    const inc = items(incentives);
    const incentivesTotal = inc.reduce((t, i) => t + i.amount, 0);
    const acquisitionFee = num(f.acquisitionFee);
    const capitalizedFees = capitalizeAcq ? (acquisitionFee ?? 0) : 0;
    const derivedCap = netCapFromWorksheet({ sellingPrice, incentivesTotal, capitalizedFees });
    const capCost = num(f.capCost) ?? derivedCap;
    const term = num(f.termMonths);
    const miles = num(f.milesPerYear);
    const residualPercent = num(f.residualPercent);
    const residualFromMsrp = residualAmountFrom(msrp, residualPercent);
    const residualAmount = num(f.residualAmount) ?? residualFromMsrp;
    const mf = num(f.moneyFactor);
    const capReduction = num(f.capReduction);
    const taxRate = noTaxEstimate ? null : num(f.taxRatePercent) != null ? num(f.taxRatePercent)! / 100 : null;
    // Cap reduction lowers what's financed; incentives were already netted into the cap cost.
    const netCap = capCost != null && capCost > 0 ? capCost - (capReduction ?? 0) : null;
    const monthly = monthlyPreTax({ netCap, residualAmount, moneyFactor: mf, termMonths: term });
    const taxed = monthlyWithTax(monthly, taxRate);
    const das = dueAtSigningFrom({
      monthly,
      monthlyTaxed: taxed,
      acquisitionFee: capitalizeAcq ? 0 : acquisitionFee,
      capReduction,
      taxesOverride: num(f.taxesAtSigning),
      taxRate,
      otherFees: items(otherFees),
    });
    const residualDrift = num(f.residualAmount) != null && residualFromMsrp != null && Math.abs(num(f.residualAmount)! - residualFromMsrp) > 1;
    return { msrp, sellingPrice, incentivesTotal, derivedCap, capCost, term, miles, residualPercent, residualFromMsrp, residualAmount, mf, apr: aprFromMf(mf), capReduction, taxRate, netCap, monthly, taxed, das, dasTotal: dasTotal(das), residualDrift, incentives: inc };
  }, [f, incentives, otherFees, capitalizeAcq, noTaxEstimate]);

  const quote: Partial<LeaseQuote> = {
    capCost: d.capCost ?? undefined,
    residualPercent: d.residualPercent ?? undefined,
    residualAmount: d.residualAmount ?? undefined,
    moneyFactor: d.mf ?? undefined,
    termMonths: d.term ?? undefined,
    milesPerYear: d.miles ?? undefined,
    capReduction: d.capReduction ?? 0,
    monthlyPaymentPreTax: d.monthly ?? undefined,
    monthlyPaymentWithEstTax: noTaxEstimate ? null : d.taxed,
    dueAtSigning: d.das ?? undefined,
    incentives: d.incentives,
    addOns: items(addOns),
    expiresAt: f.expiresAt ? new Date(f.expiresAt + "T23:59:59").toISOString() : "",
    notes: f.notes.trim() || null,
    counter: { counterOffer, note: f.counterNote },
  };
  const validation = useMemo(() => validateLeaseQuote(quote, prefs, { vin: f.vin, stockNumber: f.stockNumber }), [quote, prefs, f.vin, f.stockNumber]);
  const warnings = [...validation.warnings, ...(d.residualDrift ? [`Residual amount ${money(d.residualAmount)} doesn't match ${d.residualPercent}% of MSRP (${money(d.residualFromMsrp)}) — double-check which one is right.`] : [])];
  const overCap = overMaxCashDue(d.das, prefs);
  const termMilesDiffer = Number(f.termMonths) !== prefs.termMonths || Number(f.milesPerYear) !== prefs.milesPerYear;
  const differs = termMilesDiffer || overCap;

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
      onSubmitted({ warnings: json.warnings || [], dueAtSigningTotal: json.dueAtSigningTotal || d.dasTotal || 0 });
    } finally {
      setBusy(false);
    }
  };

  // --- render helpers (plain functions: nested components would remount and drop focus) ---
  const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none tabular-nums";
  const labelCls = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";
  const hintCls = "block text-[10px] text-ink-faint";
  type Fmt = "money" | "percent" | "mf" | "text";
  const fmt = (kind: Fmt, raw: string) => (kind === "money" ? formatMoneyInput(raw) : kind === "percent" ? formatPercentInput(raw) : kind === "mf" ? formatMoneyFactorInput(raw) : raw);
  const field = (o: { k: keyof Draft; title: string; kind?: Fmt; hint?: React.ReactNode; placeholder?: string; required?: boolean; mono?: boolean }) => {
    const kind = o.kind || "money";
    const editing = focused === o.k;
    return (
      <label className="space-y-1">
        <span className={labelCls}>
          {o.title} {o.required ? <span className="text-amber-300">*</span> : null}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={editing || kind === "text" ? f[o.k] : fmt(kind, f[o.k])}
          onFocus={() => setFocused(o.k)}
          onBlur={() => setFocused(null)}
          onChange={set(o.k)}
          placeholder={o.placeholder ?? ""}
          className={`${input} ${o.mono || kind !== "text" ? "font-mono" : ""}`}
        />
        {o.hint ? <span className={hintCls}>{o.hint}</span> : null}
      </label>
    );
  };
  const itemList = (o: { title: string; list: DraftItem[]; setList: React.Dispatch<React.SetStateAction<DraftItem[]>>; addLabel: string; placeholder: string; hint?: string }) => (
    <div className="space-y-1.5">
      <span className={labelCls}>{o.title}</span>
      {o.list.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input type="text" value={it.name} onChange={(e) => o.setList((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={o.placeholder} className={`${input} flex-1`} />
          <input
            type="text"
            inputMode="decimal"
            value={focused === (`item:${o.title}:${i}` as never) ? it.amount : formatMoneyInput(it.amount)}
            onFocus={() => setFocused(`item:${o.title}:${i}` as never)}
            onBlur={() => setFocused(null)}
            onChange={(e) => o.setList((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
            placeholder="Amount"
            className={`${input} w-32 font-mono`}
          />
          <button type="button" onClick={() => o.setList((p) => p.filter((_, j) => j !== i))} className="text-ink-muted hover:text-rose-400" aria-label={`Remove ${o.title.toLowerCase()} line`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => o.setList((p) => [...p, { name: "", amount: "" }])} className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300">
        <Plus className="h-3 w-3" /> {o.addLabel}
      </button>
      {o.hint ? <span className={hintCls}>{o.hint}</span> : null}
    </div>
  );
  const out = (title: string, value: string | null, o: { strong?: boolean; tone?: string } = {}) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-ink-muted">{title}</span>
      <span className={`tabular-nums ${o.strong ? "text-base font-extrabold" : "text-xs font-semibold"} ${o.tone || "text-white"}`}>{value ?? <span className="text-ink-faint">—</span>}</span>
    </div>
  );
  const section = (title: string, children: React.ReactNode) => (
    <section className="space-y-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{title}</h4>
      {children}
    </section>
  );

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5" data-testid="dealer-lease-calculator">
      {/* 1 — identity */}
      <div className="grid grid-cols-2 gap-3">
        {field({ k: "vin", title: "VIN", kind: "text", required: true, mono: true })}
        {field({ k: "stockNumber", title: "Stock #", kind: "text", mono: true })}
      </div>

      {/* 2 — buyer prefs banner */}
      <div className="rounded-xl border border-border/70 bg-surface-elevated px-3.5 py-3 text-xs text-ink-light" data-testid="buyer-prefs-banner">
        Buyer asked for <strong className="text-white">{prefs.termMonths} months · {prefs.milesPerYear.toLocaleString()} mi/yr</strong>
        {prefs.maxCashDueAtSigning != null ? (
          <>
            {" "}· max <strong className="text-white">${prefs.maxCashDueAtSigning.toLocaleString()} due at signing</strong>
          </>
        ) : null}
        {prefs.zip ? <> · ZIP {prefs.zip} (tax context)</> : null}. Quote to that, or mark a counter below.
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          {/* 3 — MSRP → selling price → incentives → cap cost */}
          {section(
            "3 · Price to cap cost",
            <>
              <div className="grid grid-cols-2 gap-3">
                {field({ k: "msrp", title: "MSRP", hint: "Residual % is a share of this." })}
                {field({ k: "sellingPrice", title: "Selling price", required: true, hint: d.msrp != null && d.sellingPrice != null && d.msrp > 0 ? `${money(d.msrp - d.sellingPrice)} (${Math.round(((d.msrp - d.sellingPrice) / d.msrp) * 1000) / 10}%) off MSRP` : "Before incentives." })}
              </div>
              {itemList({ title: "Incentives / rebates", list: incentives, setList: setIncentives, addLabel: "Add incentive", placeholder: "e.g. Loyalty" })}
              {field({
                k: "capCost",
                title: "Net cap cost",
                placeholder: d.derivedCap != null ? formatMoneyInput(d.derivedCap) : "",
                hint: (
                  <>
                    = selling price − incentives{capitalizeAcq ? " + acquisition fee" : ""}
                    {d.derivedCap != null && !f.capCost ? ` → ${money(d.derivedCap)}` : ""}. Type to override.
                  </>
                ),
              })}
            </>
          )}

          {/* 4 — term / miles */}
          {section(
            "4 · Term & miles",
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={labelCls}>Term (months)</span>
                <select value={f.termMonths} onChange={set("termMonths")} className={input}>
                  {LEASE_TERMS.map((t) => (
                    <option key={t} value={t}>{t}{t === prefs.termMonths ? " (buyer's pick)" : ""}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={labelCls}>Miles per year</span>
                <select value={f.milesPerYear} onChange={set("milesPerYear")} className={input}>
                  {LEASE_MILES.map((m) => (
                    <option key={m} value={m}>{m.toLocaleString()}{m === prefs.milesPerYear ? " (buyer's pick)" : ""}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* 5/6 — residual, money factor */}
          {section(
            "5 · Residual & money factor",
            <div className="grid grid-cols-2 gap-3">
              {field({ k: "residualPercent", title: "Residual %", kind: "percent", required: true, hint: "Of MSRP." })}
              {field({
                k: "residualAmount",
                title: "Residual amount",
                required: true,
                placeholder: d.residualFromMsrp != null ? formatMoneyInput(d.residualFromMsrp) : "",
                hint: d.residualFromMsrp != null ? (f.residualAmount ? `MSRP × ${d.residualPercent}% = ${money(d.residualFromMsrp)} — you overrode it.` : `= MSRP × ${d.residualPercent}%. Type to override.`) : "Enter MSRP above and it fills in, or type it.",
              })}
              {field({ k: "moneyFactor", title: "Money factor", kind: "mf", required: true, hint: d.apr != null ? `≈ ${d.apr}% APR` : "e.g. 0.00250", placeholder: "0.00000" })}
              {field({ k: "capReduction", title: "Cap cost reduction", hint: "Cash down applied to the cap cost; also a due-at-signing line." })}
            </div>
          )}

          {/* 8 — fees */}
          {section(
            "6 · Fees",
            <>
              <div className="grid grid-cols-2 gap-3">
                {field({ k: "acquisitionFee", title: "Acquisition fee" })}
                <label className="flex items-start gap-2 pt-5 text-[11px] text-ink-light">
                  <input type="checkbox" checked={capitalizeAcq} onChange={(e) => setCapitalizeAcq(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
                  <span>Roll the acquisition fee into the cap cost (otherwise it&apos;s due at signing)</span>
                </label>
              </div>
              {itemList({ title: "Other fees at signing (itemized)", list: otherFees, setList: setOtherFees, addLabel: "Add fee", placeholder: "e.g. Doc fee", hint: "Each fee named — a single unlabeled lump can't be submitted." })}
            </>
          )}

          {/* 9 — tax */}
          {section(
            "7 · Tax",
            <>
              <div className="grid grid-cols-2 gap-3">
                {field({ k: "taxRatePercent", title: "Sales tax rate", kind: "percent", hint: prefs.zip ? `Estimated for ZIP ${prefs.zip} — edit if you use another rate.` : "Blank = tax estimated at signing." })}
                {field({ k: "taxesAtSigning", title: "Taxes due at signing", hint: "Defaults to tax on the cap reduction; type your figure to override." })}
              </div>
              <label className="flex items-start gap-2 text-[11px] text-ink-light">
                <input type="checkbox" checked={noTaxEstimate} onChange={(e) => setNoTaxEstimate(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
                <span>Can&apos;t estimate tax — the buyer sees &ldquo;tax estimated at signing&rdquo;</span>
              </label>
            </>
          )}

          {/* 11 — add-ons, expiry, notes, counter */}
          {section(
            "8 · Add-ons, expiry & notes",
            <>
              {itemList({ title: "Add-ons", list: addOns, setList: setAddOns, addLabel: "Add add-on", placeholder: "e.g. Wheel & tire", hint: "Optional. The buyer sees each line." })}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className={labelCls}>
                    Quote good through <span className="text-amber-300">*</span>
                  </span>
                  <input type="date" value={f.expiresAt} onChange={set("expiresAt")} className={input} />
                </label>
                <label className="space-y-1">
                  <span className={labelCls}>Notes (optional)</span>
                  <input type="text" value={f.notes} onChange={set("notes")} className={input} />
                </label>
              </div>
              {differs ? (
                <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/20 px-3.5 py-3" data-testid="counter-box">
                  <label className="flex items-start gap-2 text-xs text-amber-100">
                    <input type="checkbox" checked={counterOffer} onChange={(e) => setCounterOffer(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
                    <span>
                      This is a <strong>counter-offer</strong> —{" "}
                      {overCap && prefs.maxCashDueAtSigning != null && !termMilesDiffer
                        ? `due at signing is above the buyer's max of $${prefs.maxCashDueAtSigning.toLocaleString()}`
                        : `the term or miles differ from what the buyer asked for (${prefs.termMonths} mo / ${prefs.milesPerYear.toLocaleString()} mi)${overCap && prefs.maxCashDueAtSigning != null ? `, and due at signing is above their $${prefs.maxCashDueAtSigning.toLocaleString()} max` : ""}`}
                      . The buyer will see it flagged.
                    </span>
                  </label>
                  <input
                    type="text"
                    value={f.counterNote}
                    onChange={set("counterNote")}
                    placeholder={overCap && !termMilesDiffer ? "Why — e.g. the acquisition fee can't be rolled into the cap cost on this program" : "Why — e.g. 39 mo carries a better residual this month"}
                    maxLength={300}
                    className={input}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* 9/10 — results, live */}
        <aside className="h-fit space-y-3 rounded-xl border border-border bg-background p-4 lg:sticky lg:top-4" data-testid="dealer-lease-results">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Payments</h4>
          {out("Monthly (pre-tax)", money(d.monthly, 2), { strong: true })}
          {noTaxEstimate ? out("Tax", d.monthly != null ? "estimated at signing" : null) : out("Monthly with est. tax", money(d.taxed, 2))}
          <div className="border-t border-border/60 pt-2">
            {out("Due at signing", money(d.dasTotal, 2), { strong: true, tone: overCap ? "text-amber-300" : undefined })}
            {d.das ? (
              <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted tabular-nums">
                <li className="flex justify-between"><span>First month</span><span>{money(d.das.firstMonth, 2)}</span></li>
                <li className="flex justify-between"><span>Acquisition fee</span><span>{money(d.das.acquisitionFee, 2)}</span></li>
                <li className="flex justify-between"><span>Cap reduction</span><span>{money(d.das.capReduction, 2)}</span></li>
                <li className="flex justify-between"><span>Taxes</span><span>{noTaxEstimate && !f.taxesAtSigning ? "at signing" : money(d.das.taxes, 2)}</span></li>
                {d.das.otherFees.map((x, i) => (
                  <li key={i} className="flex justify-between"><span>{x.name}</span><span>{money(x.amount, 2)}</span></li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[10px] text-ink-faint">Itemized once selling price, residual, money factor and term are in.</p>
            )}
            {overCap && prefs.maxCashDueAtSigning != null ? <p className="mt-1 text-[10px] font-bold text-amber-300">Over the buyer&apos;s ${prefs.maxCashDueAtSigning.toLocaleString()} max</p> : null}
          </div>
          <div className="border-t border-border/60 pt-2 space-y-1">
            {out("Net cap cost", money(d.capCost))}
            {out("Financed (after cap reduction)", money(d.netCap))}
            {out("Residual", d.residualAmount != null ? `${money(d.residualAmount)}${d.residualPercent != null ? ` (${d.residualPercent}%)` : ""}` : null)}
            {out("Money factor", d.mf != null ? `${formatMoneyFactorInput(d.mf)}${d.apr != null ? ` ≈ ${d.apr}% APR` : ""}` : null)}
          </div>
        </aside>
      </div>

      {touched && validation.errors.length ? (
        <ul className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300 space-y-0.5" data-testid="calc-errors">
          {validation.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {serverError ? <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{serverError}</p> : null}
      {warnings.length ? (
        <ul className="text-[10px] text-amber-200/90 space-y-0.5">
          {warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}

      <button type="button" onClick={submit} disabled={busy} className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all disabled:opacity-50">
        {busy ? "Submitting…" : "Submit lease quote"}
      </button>
    </div>
  );
}
