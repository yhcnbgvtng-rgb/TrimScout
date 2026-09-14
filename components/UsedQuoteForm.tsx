"use client";

import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CREDIT_BAND_LABELS, FINANCE_TERMS, financeMonthly, validateUsedQuote, dueAtSigningSum, type QuotePrefs, type UsedQuote } from "../lib/usedQuote";
import { formatMoneyInput, formatPercentInput, num } from "../lib/leaseMath";
import { getZipCoordinates } from "../lib/otdCalculator";

/**
 * The dealer's Cash / Finance sheet, new or used, to match the buyer's
 * locks (term · down · credit band · ZIP). Same discipline as the lease
 * calculator: structured fields, itemized due-at-signing with a sales-tax
 * line (never a lump), add-ons as their own lines or an explicit none, and
 * a future expiry before it can be submitted. Term and down must equal
 * the locks — no counters, so every sheet compares apples to apples.
 * Monthly is computed from amount financed / APR / term — there is no
 * monthly-only entry. A request, not a bid.
 */
type Item = { name: string; amount: string };
const STANDING_FEES = 3;

const money = (n: number | null, digits = 0) => (n == null ? null : `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);

export function UsedQuoteForm({
  token,
  vin,
  stockNumber,
  prefs,
  condition = "used",
  buyerMiles,
  onSubmitted,
}: {
  token: string;
  vin: string;
  stockNumber: string | null;
  prefs: QuotePrefs;
  condition?: "new" | "used" | "cpo";
  buyerMiles: number | null;
  onSubmitted: (result: { warnings: string[] }) => void;
}) {
  const kind = prefs.quoteType;
  const used = condition !== "new";
  const zip = kind === "finance" ? prefs.finance.zip : prefs.cash.zip;
  const zipRate = zip ? getZipCoordinates(zip).taxRate : null;
  const [f, setF] = useState({
    vin,
    stockNumber: stockNumber || "",
    sellingPrice: "",
    miles: "",
    cpo: false,
    expiresAt: "",
    notes: "",
    // finance
    downPayment: kind === "finance" ? String(prefs.finance.downPayment) : "",
    tradeEquity: "",
    apr: "",
    termMonths: kind === "finance" ? String(prefs.finance.termMonths) : "",
    lenderName: "",
  });
  const [noTaxEstimate, setNoTaxEstimate] = useState(false);
  const [addOns, setAddOns] = useState<Item[]>([]);
  const [noAddOns, setNoAddOns] = useState(false);
  const [rebates, setRebates] = useState<Item[]>([]);
  const [fees, setFees] = useState<Item[]>([
    { name: "Sales tax", amount: "" },
    { name: "Doc fee", amount: "" },
    { name: "Title & registration", amount: "" },
  ]);
  const [focused, setFocused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const toLines = (list: Item[]) => list.map((i) => ({ name: i.name.trim(), amount: num(i.amount) ?? NaN })).filter((i) => i.name && Number.isFinite(i.amount));
  const d = useMemo(() => {
    const sellingPrice = num(f.sellingPrice);
    const items = toLines(fees);
    const addOnLines = toLines(addOns);
    const rebateLines = toLines(rebates);
    const dasTotal = dueAtSigningSum(items);
    const addOnTotal = dueAtSigningSum(addOnLines);
    const rebateTotal = dueAtSigningSum(rebateLines);
    const down = num(f.downPayment);
    const trade = num(f.tradeEquity);
    const apr = num(f.apr);
    const term = num(f.termMonths);
    // Amount financed = selling price + add-ons − rebates − down − trade equity + fees rolled in (all fees assumed rolled in for the estimate).
    const amountFinanced = sellingPrice != null && sellingPrice > 0 ? Math.max(0, sellingPrice + addOnTotal - rebateTotal - (down ?? 0) - (trade ?? 0) + dasTotal) : null;
    const monthly = amountFinanced != null && apr != null && term != null ? financeMonthly(amountFinanced, apr, term) : null;
    const taxed = monthly != null && zipRate != null && !noTaxEstimate ? Math.round(monthly * (1 + zipRate) * 100) / 100 : null;
    const estTaxOnPrice = sellingPrice != null && zipRate != null ? Math.round(sellingPrice * zipRate) : null;
    const cashDue = down != null ? Math.round((down + dasTotal + addOnTotal - rebateTotal) * 100) / 100 : null;
    const otd = sellingPrice != null ? Math.round((sellingPrice + dasTotal + addOnTotal - rebateTotal) * 100) / 100 : null;
    return { sellingPrice, items, addOnLines, rebateLines, dasTotal, addOnTotal, rebateTotal, down, trade, apr, term, amountFinanced, monthly, taxed, estTaxOnPrice, cashDue, otd };
  }, [f, fees, addOns, rebates, noTaxEstimate, zipRate]);

  const base = {
    sellingPrice: d.sellingPrice ?? undefined,
    dueAtSigning: d.items,
    addOns: d.addOnLines,
    noAddOns,
    rebates: d.rebateLines,
    miles: used ? num(f.miles) ?? undefined : null,
    stockNumber: f.stockNumber.trim() || null,
    cpo: used ? f.cpo : false,
    expiresAt: f.expiresAt ? new Date(f.expiresAt + "T23:59:59").toISOString() : "",
    notes: f.notes.trim() || null,
  };
  const quote: Partial<UsedQuote> =
    kind === "cash"
      ? { kind: "cash", ...base }
      : {
          kind: "finance",
          ...base,
          downPayment: d.down ?? undefined,
          tradeEquity: d.trade,
          amountFinanced: d.amountFinanced ?? undefined,
          apr: d.apr ?? undefined,
          termMonths: d.term ?? undefined,
          monthlyPaymentPreTax: d.monthly ?? undefined,
          monthlyPaymentWithEstTax: noTaxEstimate ? null : d.taxed,
          lenderName: f.lenderName.trim() || null,
        };
  const validation = useMemo(() => validateUsedQuote(quote, prefs, { vin: f.vin, stockNumber: f.stockNumber, condition }), [quote, prefs, f.vin, f.stockNumber, condition]);
  const lockBroken = kind === "finance" && ((d.term != null && d.term !== prefs.finance.termMonths) || (d.down != null && Math.round(d.down) !== prefs.finance.downPayment));

  const submit = async () => {
    setTouched(true);
    setServerError(null);
    if (validation.errors.length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/quote-invite/used-quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, vin: f.vin, stockNumber: f.stockNumber, quote }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(Array.isArray(json.errors) && json.errors.length ? json.errors.join(" ") : json.error || "Could not submit the quote.");
        return;
      }
      onSubmitted({ warnings: json.warnings || [] });
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none tabular-nums";
  const labelCls = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";
  const hintCls = "block text-[10px] text-ink-faint";
  const field = (o: { k: keyof typeof f; title: string; kind?: "money" | "percent" | "text"; hint?: React.ReactNode; required?: boolean; placeholder?: string }) => {
    const kd = o.kind || "money";
    const editing = focused === o.k;
    const raw = String(f[o.k]);
    return (
      <label className="space-y-1">
        <span className={labelCls}>{o.title} {o.required ? <span className="text-amber-300">*</span> : null}</span>
        <input type="text" inputMode={kd === "text" ? "text" : "decimal"} value={editing || kd === "text" ? raw : kd === "money" ? formatMoneyInput(raw) : formatPercentInput(raw)} onFocus={() => setFocused(o.k)} onBlur={() => setFocused(null)} onChange={set(o.k)} placeholder={o.placeholder || ""} className={`${input} ${kd !== "text" ? "font-mono" : ""}`} />
        {o.hint ? <span className={hintCls}>{o.hint}</span> : null}
      </label>
    );
  };
  const out = (title: string, value: string | null, strong = false) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-ink-muted">{title}</span>
      <span className={`tabular-nums ${strong ? "text-base font-extrabold" : "text-xs font-semibold"} text-white`}>{value ?? <span className="text-ink-faint">—</span>}</span>
    </div>
  );

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5" data-testid="used-quote-form">
      <div className="rounded-xl border border-border/70 bg-surface-elevated px-3.5 py-3 text-xs text-ink-light" data-testid="used-prefs-banner">
        Buyer locked a <strong className="text-white">{kind === "finance" ? "finance" : "cash"}</strong> quote
        {kind === "finance" ? <> · <strong className="text-white">{prefs.finance.termMonths} months · ${prefs.finance.downPayment.toLocaleString()} down · {CREDIT_BAND_LABELS[prefs.finance.creditBand].toLowerCase()} credit</strong></> : null}
        {zip ? <> · ZIP {zip} (tax context)</> : null}
        {buyerMiles != null ? <> · they noted {buyerMiles.toLocaleString()} miles</> : null}.{" "}
        {kind === "finance" ? "Quote to exactly that term, down and band — every dealer does, so the buyer compares like for like." : "Quote the car out the door, itemized."}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          <section className="space-y-2.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">1 · The car</h4>
            <div className="grid grid-cols-2 gap-3">
              {field({ k: "vin", title: "VIN", kind: "text", required: true })}
              {field({ k: "stockNumber", title: "Stock #", kind: "text" })}
              {used ? field({ k: "miles", title: "Miles on the car", kind: "text", required: true, placeholder: "e.g. 34,512" }) : null}
              {used ? (
                <label className="flex items-start gap-2 pt-5 text-[11px] text-ink-light">
                  <input type="checkbox" checked={f.cpo} onChange={(e) => setF((p) => ({ ...p, cpo: e.target.checked }))} className="mt-0.5 h-3.5 w-3.5" />
                  <span>Certified pre-owned (CPO)</span>
                </label>
              ) : null}
            </div>
          </section>

          <section className="space-y-2.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">2 · Price</h4>
            <div className="grid grid-cols-2 gap-3">
              {field({ k: "sellingPrice", title: "Selling price", required: true, hint: "Before fees and taxes." })}
              {kind === "finance" ? field({ k: "downPayment", title: "Down payment applied", required: true, hint: `Buyer's lock: $${prefs.finance.downPayment.toLocaleString()} — must match.` }) : null}
              {kind === "finance" ? field({ k: "tradeEquity", title: "Trade equity", hint: "Optional — positive reduces the amount financed." }) : null}
            </div>
          </section>

          {kind === "finance" ? (
            <section className="space-y-2.5">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">3 · Financing</h4>
              <div className="grid grid-cols-2 gap-3">
                {field({ k: "apr", title: "APR", kind: "percent", required: true, placeholder: "e.g. 6.49" })}
                <label className="space-y-1">
                  <span className={labelCls}>Term confirmed <span className="text-amber-300">*</span></span>
                  <select value={f.termMonths} onChange={set("termMonths")} className={input} data-testid="finance-term">
                    {FINANCE_TERMS.map((t) => (
                      <option key={t} value={t}>{t} months{t === prefs.finance.termMonths ? " — buyer's lock" : ""}</option>
                    ))}
                  </select>
                  <span className={hintCls}>Must match the buyer&apos;s {prefs.finance.termMonths}-month lock.</span>
                </label>
                <label className="space-y-1">
                  <span className={labelCls}>Quoting to credit band</span>
                  <input type="text" readOnly value={CREDIT_BAND_LABELS[prefs.finance.creditBand]} className={`${input} opacity-80`} aria-label="Credit band (buyer's lock)" />
                  <span className={hintCls}>The buyer&apos;s own estimate — no pull. Rate this band.</span>
                </label>
                {field({ k: "lenderName", title: "Lender", kind: "text", placeholder: "Optional — e.g. GM Financial" })}
              </div>
              <p className={hintCls}>Amount financed = selling price + add-ons − rebates − down − trade equity + fees below (rolled in). Monthly is calculated — there is no monthly-only entry.</p>
            </section>
          ) : null}

          <section className="space-y-2.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{kind === "finance" ? "4" : "3"} · Due at signing (itemized)</h4>
            <div className="grid grid-cols-[1fr_140px_20px] gap-2">
              <span className={labelCls}>Line</span>
              <span className={labelCls}>Amount</span>
              <span />
            </div>
            {fees.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_20px] items-center gap-2">
                <input type="text" value={it.name} readOnly={i < STANDING_FEES} onChange={(e) => setFees((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Describe the fee" aria-label="Fee description" className={input} />
                <span className="relative block">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">$</span>
                  <input type="text" inputMode="decimal" value={focused === `fee:${i}` ? it.amount : formatMoneyInput(it.amount).replace(/^\$/, "")} onFocus={() => setFocused(`fee:${i}`)} onBlur={() => setFocused(null)} onChange={(e) => setFees((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder={i === 0 && d.estTaxOnPrice != null ? String(d.estTaxOnPrice) : "0"} aria-label={`${it.name || "fee"} amount`} className={`${input} pl-6 font-mono`} />
                </span>
                {i < STANDING_FEES ? <span /> : (
                  <button type="button" onClick={() => setFees((p) => p.filter((_, j) => j !== i))} className="text-ink-muted hover:text-rose-400" aria-label="Remove fee line"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setFees((p) => [...p, { name: "", amount: "" }])} className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300"><Plus className="h-3 w-3" /> Add another fee</button>
            <p className={hintCls}>Sales tax, doc fee and title & registration are always listed — enter the amounts{d.estTaxOnPrice != null ? ` (tax on the price at ${zip}'s rate ≈ ${money(d.estTaxOnPrice)})` : ""}. Sales tax is required as its own line ($0 if none). A single unlabeled lump can&apos;t be submitted.</p>
            {kind === "finance" ? (
              <label className="flex items-start gap-2 text-[11px] text-ink-light">
                <input type="checkbox" checked={noTaxEstimate} onChange={(e) => setNoTaxEstimate(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
                <span>Can&apos;t estimate tax on the monthly — the buyer sees &ldquo;tax estimated at signing&rdquo;</span>
              </label>
            ) : null}
          </section>

          <section className="space-y-2.5" data-testid="add-ons">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{kind === "finance" ? "5" : "4"} · Add-ons</h4>
            <label className="flex items-start gap-2 text-[11px] text-ink-light">
              <input type="checkbox" checked={noAddOns} onChange={(e) => { setNoAddOns(e.target.checked); if (e.target.checked) setAddOns([]); }} className="mt-0.5 h-3.5 w-3.5" data-testid="no-add-ons" />
              <span>No add-ons — $0</span>
            </label>
            {!noAddOns ? (
              <>
                {addOns.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_140px_20px] items-center gap-2">
                    <input type="text" value={it.name} onChange={(e) => setAddOns((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="e.g. Paint protection" aria-label="Add-on description" className={input} />
                    <span className="relative block">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">$</span>
                      <input type="text" inputMode="decimal" value={focused === `addon:${i}` ? it.amount : formatMoneyInput(it.amount).replace(/^\$/, "")} onFocus={() => setFocused(`addon:${i}`)} onBlur={() => setFocused(null)} onChange={(e) => setAddOns((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="0" aria-label={`${it.name || "add-on"} amount`} className={`${input} pl-6 font-mono`} />
                    </span>
                    <button type="button" onClick={() => setAddOns((p) => p.filter((_, j) => j !== i))} className="text-ink-muted hover:text-rose-400" aria-label="Remove add-on"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setAddOns((p) => [...p, { name: "", amount: "" }])} className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300"><Plus className="h-3 w-3" /> Add an add-on line</button>
              </>
            ) : null}
            <p className={hintCls}>Each add-on is its own line with its own price — never folded into the selling price or the payment. Either list them or confirm none.</p>
          </section>

          <section className="space-y-2.5" data-testid="rebates">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Rebates / incentives <span className="font-normal normal-case">(optional)</span></h4>
            {rebates.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_20px] items-center gap-2">
                <input type="text" value={it.name} onChange={(e) => setRebates((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="e.g. Loyalty cash" aria-label="Rebate description" className={input} />
                <span className="relative block">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">$</span>
                  <input type="text" inputMode="decimal" value={focused === `rebate:${i}` ? it.amount : formatMoneyInput(it.amount).replace(/^\$/, "")} onFocus={() => setFocused(`rebate:${i}`)} onBlur={() => setFocused(null)} onChange={(e) => setRebates((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="0" aria-label={`${it.name || "rebate"} amount`} className={`${input} pl-6 font-mono`} />
                </span>
                <button type="button" onClick={() => setRebates((p) => p.filter((_, j) => j !== i))} className="text-ink-muted hover:text-rose-400" aria-label="Remove rebate"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setRebates((p) => [...p, { name: "", amount: "" }])} className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300"><Plus className="h-3 w-3" /> Add a rebate line</button>
          </section>

          <section className="space-y-2.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Quote details</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={labelCls}>Quote good through <span className="text-amber-300">*</span></span>
                <input type="date" value={f.expiresAt} onChange={set("expiresAt")} className={input} />
              </label>
              <label className="space-y-1">
                <span className={labelCls}>Notes (optional)</span>
                <input type="text" value={f.notes} onChange={set("notes")} className={input} />
              </label>
            </div>
            {lockBroken ? (
              <p className="rounded-xl border border-rose-500/40 bg-rose-950/20 px-3.5 py-2.5 text-[11px] text-rose-200" data-testid="lock-mismatch">
                Term and down must match the buyer&apos;s lock ({prefs.finance.termMonths} months · ${prefs.finance.downPayment.toLocaleString()} down). A different structure isn&apos;t comparable, so it can&apos;t be submitted.
              </p>
            ) : null}
          </section>
        </div>

        <aside className="h-fit space-y-3 rounded-xl border border-border bg-background p-4 lg:sticky lg:top-4" data-testid="used-results">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{kind === "finance" ? "Payments" : "Out the door"}</h4>
          {kind === "finance" ? (
            <>
              {out("Monthly (pre-tax)", money(d.monthly, 2), true)}
              {noTaxEstimate ? out("Tax", d.monthly != null ? "estimated at signing" : null) : out("Monthly with est. tax", money(d.taxed, 2))}
              <div className="border-t border-border/60 pt-2 space-y-1">
                {out("Amount financed", money(d.amountFinanced))}
                {out("APR · term", d.apr != null && d.term != null ? `${d.apr}% · ${d.term} mo` : null)}
                {out("Cash due at signing", money(d.cashDue))}
                {d.addOnTotal ? out("Add-ons", money(d.addOnTotal)) : null}
                {d.rebateTotal ? out("Rebates", `−${money(d.rebateTotal)}`) : null}
              </div>
            </>
          ) : (
            <>
              {out("Out the door", money(d.otd, 2), true)}
              <div className="border-t border-border/60 pt-2 space-y-1">
                {out("Selling price", money(d.sellingPrice))}
                {out("Fees & taxes", d.sellingPrice != null ? money(d.dasTotal) : null)}
                {d.addOnTotal ? out("Add-ons", money(d.addOnTotal)) : null}
                {d.rebateTotal ? out("Rebates", `−${money(d.rebateTotal)}`) : null}
              </div>
            </>
          )}
          <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted tabular-nums">
            {d.items.map((x, i) => (
              <li key={i} className="flex justify-between"><span>{x.name}</span><span>{money(x.amount, 2)}</span></li>
            ))}
          </ul>
        </aside>
      </div>

      {touched && validation.errors.length ? (
        <ul className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300 space-y-0.5" data-testid="used-errors">
          {validation.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {serverError ? <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{serverError}</p> : null}
      {validation.warnings.length ? (
        <ul className="text-[10px] text-amber-200/90 space-y-0.5">
          {validation.warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={submit} disabled={busy} className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all disabled:opacity-50">
        {busy ? "Submitting…" : `Submit ${kind} quote`}
      </button>
    </div>
  );
}
