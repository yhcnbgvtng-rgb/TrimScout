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
  msrp,
  onSubmitted,
}: {
  token: string;
  vin: string;
  stockNumber: string | null;
  prefs: QuotePrefs;
  condition?: "new" | "used" | "cpo";
  buyerMiles: number | null;
  /** Sticker MSRP when known — prefills the sheet's MSRP field for the percent line. */
  msrp?: number | null;
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
    msrp: msrp && msrp > 0 ? String(msrp) : "",
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
    // The equation's own lines: sales tax is the standing first line; every other fee is "mandatory fees".
    const taxTotal = dueAtSigningSum(items.filter((i) => /tax/i.test(i.name)));
    const mandatoryTotal = dasTotal - taxTotal;
    const docFee = dueAtSigningSum(items.filter((i) => /\bdoc/i.test(i.name)));
    // Price + add-ons + doc fee as a share of MSRP — the number that shows a "discount" eaten back by dealer charges.
    const msrpNum = num(f.msrp);
    const dealerAsk = sellingPrice != null ? Math.round((sellingPrice + addOnTotal + docFee) * 100) / 100 : null;
    const pctOfMsrp = dealerAsk != null && msrpNum != null && msrpNum > 0 ? Math.round((dealerAsk / msrpNum) * 1000) / 10 : null;
    return { sellingPrice, items, addOnLines, rebateLines, dasTotal, addOnTotal, rebateTotal, taxTotal, mandatoryTotal, docFee, msrp: msrpNum, dealerAsk, pctOfMsrp, down, trade, apr, term, amountFinanced, monthly, taxed, estTaxOnPrice, cashDue, otd };
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
  const opBadge = (op: "+" | "−" | "=") => (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[11px] font-black ${op === "=" ? "bg-emerald-500 text-black" : op === "−" ? "bg-rose-500/20 text-rose-300" : "bg-border text-white"}`}>{op}</span>
  );
  /** One block of the vertical equation: sign badge, title, then its inputs. */
  const eqBlock = (op: "+" | "−" | "=", title: string, testid: string, body: React.ReactNode, note?: React.ReactNode) => (
    <section className={`space-y-2.5 rounded-xl border px-3.5 py-3 ${op === "=" ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/60 bg-background"}`} data-testid={testid} data-op={op}>
      <div className="flex items-center gap-2.5">
        {opBadge(op)}
        <h4 className={`text-[11px] font-bold ${op === "=" ? "text-white" : "text-ink-light"}`}>{title}</h4>
        {note ? <span className="ml-auto text-[10px] text-ink-faint">{note}</span> : null}
      </div>
      {body}
    </section>
  );
  const feeRow = (it: Item, i: number, list: Item[], setList: React.Dispatch<React.SetStateAction<Item[]>>, key: string, standing: boolean, placeholder = "0") => (
    <div key={i} className="grid grid-cols-[1fr_140px_20px] items-center gap-2">
      <input type="text" value={it.name} readOnly={standing} onChange={(e) => setList((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Describe the line" aria-label={`${key} description`} className={input} />
      <span className="relative block">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">$</span>
        <input type="text" inputMode="decimal" value={focused === `${key}:${i}` ? it.amount : formatMoneyInput(it.amount).replace(/^\$/, "")} onFocus={() => setFocused(`${key}:${i}`)} onBlur={() => setFocused(null)} onChange={(e) => setList((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder={placeholder} aria-label={`${it.name || key} amount`} className={`${input} pl-6 font-mono`} />
      </span>
      {standing ? <span /> : <button type="button" onClick={() => setList((p) => p.filter((_, j) => j !== i))} className="text-ink-muted hover:text-rose-400" aria-label={`Remove ${key} line`}><Trash2 className="h-3.5 w-3.5" /></button>}
    </div>
  );
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

          {kind === "cash" ? (
            <div className="space-y-2" data-testid="cash-equation">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">Out-the-door pricing — the same equation the buyer sees</p>
              {eqBlock("+", "Selling price", "eq-selling-price", (
                <div className="grid grid-cols-2 gap-3">
                  {field({ k: "sellingPrice", title: "Selling price", required: true, hint: "Before fees and taxes." })}
                  {field({ k: "msrp", title: "MSRP", hint: msrp && msrp > 0 ? "From the factory sticker." : "From the sticker — for the % of MSRP line." })}
                </div>
              ))}
              {eqBlock("+", "Add-ons", "add-ons", (
                <>
                  <label className="flex items-start gap-2 text-[11px] text-ink-light">
                    <input type="checkbox" checked={noAddOns} onChange={(e) => { setNoAddOns(e.target.checked); if (e.target.checked) setAddOns([]); }} className="mt-0.5 h-3.5 w-3.5" data-testid="no-add-ons" />
                    <span>No add-ons — $0</span>
                  </label>
                  {!noAddOns ? (
                    <>
                      {addOns.map((it, i) => feeRow(it, i, addOns, setAddOns, "add-on", false))}
                      <button type="button" onClick={() => setAddOns((p) => [...p, { name: "", amount: "" }])} className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300"><Plus className="h-3 w-3" /> Add an add-on line</button>
                    </>
                  ) : null}
                </>
              ), "$0 or each one listed")}
              {eqBlock("+", "Mandatory fees", "eq-mandatory-fees", (
                <>
                  {fees.map((it, i) => (i === 0 ? null : feeRow(it, i, fees, setFees, "fee", i < STANDING_FEES)))}
                  <button type="button" onClick={() => setFees((p) => [...p, { name: "", amount: "" }])} className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300"><Plus className="h-3 w-3" /> Add another fee</button>
                </>
              ), "doc, title & registration, each named")}
              {eqBlock("+", "Sales tax", "eq-sales-tax", (
                <>
                  {feeRow(fees[0], 0, fees, setFees, "fee", true, d.estTaxOnPrice != null ? String(d.estTaxOnPrice) : "0")}
                  <p className={hintCls}>For the buyer&apos;s ZIP {zip}{d.estTaxOnPrice != null ? ` — tax on the price at that rate ≈ ${money(d.estTaxOnPrice)}` : ""}. Required as its own line ($0 if none applies).</p>
                </>
              ), `for ZIP ${zip}`)}
              {eqBlock("−", "Rebates / credits", "rebates", (
                <>
                  {rebates.map((it, i) => feeRow(it, i, rebates, setRebates, "rebate", false))}
                  <button type="button" onClick={() => setRebates((p) => [...p, { name: "", amount: "" }])} className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300"><Plus className="h-3 w-3" /> Add a rebate line</button>
                </>
              ), "each named")}
              {eqBlock("=", "Out the door", "eq-out-the-door", (
                <p className="text-lg font-extrabold tabular-nums text-white">{money(d.otd, 2) ?? <span className="text-ink-faint">—</span>}</p>
              ), "what the buyer compares")}
            </div>
          ) : (
            <>
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

            </>
          )}

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
                {out("Add-ons", d.sellingPrice != null ? money(d.addOnTotal) : null)}
                {out("Mandatory fees", d.sellingPrice != null ? money(d.mandatoryTotal) : null)}
                {out("Sales tax", d.sellingPrice != null ? money(d.taxTotal) : null)}
                {d.rebateTotal ? out("Rebates / credits", `−${money(d.rebateTotal)}`) : null}
              </div>
              <div className="border-t border-border/60 pt-2 space-y-1" data-testid="pct-of-msrp">
                {out("Price + add-ons + doc fee", money(d.dealerAsk))}
                {out("as % of MSRP", d.pctOfMsrp != null ? `${d.pctOfMsrp}%${d.msrp ? ` of ${money(d.msrp)}` : ""}` : d.dealerAsk != null ? "enter MSRP above" : null, d.pctOfMsrp != null)}
              </div>
            </>
          )}
          {kind === "finance" ? (
            <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted tabular-nums">
              {d.items.map((x, i) => (
                <li key={i} className="flex justify-between"><span>{x.name}</span><span>{money(x.amount, 2)}</span></li>
              ))}
            </ul>
          ) : null}
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
