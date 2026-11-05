"use client";

import { counterPriceChanged, TAX_PROMPT_COPY, type CounterSheet } from "../lib/counterSheet";
import { TaxUpdatePrompt } from "./TaxUpdatePrompt";
import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  validateLeaseQuote, finalizeLeaseQuote, vinProblem, normalizeVin, endOfMonthDate, pricedAtLowerTier,
  LEASE_MILES, LEASE_TERMS, LEASE_DAS_INTENT_LABELS, LEASE_TAX_METHODS, LEASE_TAX_METHOD_LABELS, CAPTIVE_LENDERS, CREDIT_TIERS,
  VEHICLE_STATUSES, VEHICLE_STATUS_LABELS, LINE_TIMINGS, LINE_TIMING_LABELS, INCENTIVE_ELIGIBILITY_TYPES, INCENTIVE_ELIGIBILITY_LABELS,
  INCENTIVE_ATTESTATION_COPY, PRICED_AT_LOWER_TIER_LABEL, RESIDUAL_ENTERED_DIRECTLY_NOTE, GOOD_THROUGH_MAX_DAYS,
  type LeaseQuote, type LeaseRequestPrefs, type LineItem, type LineTiming, type FeeCategory, type IncentiveEligibility, type LeaseTaxMethod, type VehicleStatus,
} from "../lib/leaseQuote";
import { feeTaxableDefault, leaseTaxMethodDefault } from "../lib/leaseDefaults";
import { CREDIT_BAND_LABELS } from "../lib/creditBand";
import {
  aprFromMf,
  calcNetCap,
  computeLeaseTax,
  dasTotal,
  dueAtSigningFrom,
  formatMoneyFactorInput,
  formatMoneyInput,
  formatPercentInput,
  monthlyPreTax,
  monthlyWithTax,
  num,
  residualAmountFrom,
  totalLeaseCost,
} from "../lib/leaseMath";
import { getZipCoordinates } from "../lib/otdCalculator";
import type { TradeQuoteForm } from "./trade/useDealerTrade";
import { MoneyInput } from "./MoneyInput";

/**
 * The dealer's lease calculator — the only way a quote gets in. Laid out the
 * way a lease worksheet is built: vehicle → lender & credit tier → MSRP /
 * selling price / incentives → fees (dealer vs government) → add-ons → net
 * cap cost (calculated; an override needs a reason) → term / miles → residual
 * (% of MSRP, dollars autofilled) → money factor (APR shown) → tax method →
 * deposit & end-of-lease costs → good-through, notes. Inputs format as money /
 * percent while typing and store numbers; every computed figure stays blank
 * until its inputs exist. Validation is lib/leaseQuote.ts, shared with the
 * server, so what blocks here blocks there. Standard lease arithmetic
 * (lib/leaseMath.ts); no third-party branding or copy.
 */
type Draft = {
  vin: string;
  stockNumber: string;
  vehicleStatus: VehicleStatus | "";
  etaDate: string;
  lenderChoice: string; // a captive's name, "__bank" or "__other"
  lenderName: string; // typed name for bank / other
  creditTierAssumed: string;
  msrp: string;
  sellingPrice: string;
  capCost: string; // net cap cost override only; blank = calculated
  netCapReason: string;
  termMonths: string;
  milesPerYear: string;
  residualPercent: string;
  residualAmount: string; // override only; blank = derived from MSRP × %
  moneyFactor: string;
  capReduction: string;
  acquisitionFee: string;
  taxRatePercent: string;
  taxMethod: LeaseTaxMethod | "";
  taxMethodOther: string;
  taxesAtSigning: string;
  securityDeposit: string;
  dispositionFee: string;
  excessMileagePerMile: string;
  expiresAt: string;
  notes: string;
  counterNote: string;
};
type FeeKind = "doc" | "title" | "registration" | "other";
type FeeRow = { name: string; amount: string; taxable: boolean; timing: LineTiming; kind: FeeKind };
type IncentiveRow = { name: string; amount: string; eligibilityType: IncentiveEligibility | ""; proof: string };
type AddOnRow = { name: string; amount: string; taxable: boolean; removable: "" | "yes" | "no"; timing: LineTiming };

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => isoDate(new Date());
const plusDaysISO = (n: number) => isoDate(new Date(Date.now() + n * 86_400_000));

const money = (n: number | null, digits = 0) => (n == null ? null : `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);

const carryOverDate = (iso: string | null | undefined): string => {
  // A counter keeps the dealer's original "good through" date unless it already lapsed.
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) return "";
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

export function LeaseCalculatorForm({
  token,
  vin,
  stockNumber,
  prefs,
  initial = null,
  counterSheet = null,
  trade = null,
  onSubmitted,
}: {
  token: string;
  vin: string;
  stockNumber: string | null;
  prefs: LeaseRequestPrefs;
  /** The trade allowance that rides with this quote (set when the buyer included a trade-in): the quote can't be sent without it. */
  trade?: TradeQuoteForm | null;
  /** A prior quote to prefill from (the dealer revising after a buyer counter). */
  initial?: LeaseQuote | null;
  /** The buyer's counter being answered — a price change makes the dealer update or confirm sales tax first. */
  counterSheet?: CounterSheet | null;
  onSubmitted: (result: { warnings: string[]; dueAtSigningTotal: number }) => void;
}) {
  const zipLoc = prefs.zip ? getZipCoordinates(prefs.zip) : null;
  const zipRate = zipLoc ? zipLoc.taxRate : null;
  const zipState = zipLoc ? zipLoc.state : null;
  // Revising after a buyer counter: start from the last quote's numbers
  // (cap cost as the selling price, residual / MF / fees / lines as they were).
  const str = (n: number | null | undefined) => (n == null || !Number.isFinite(n) || n === 0 ? "" : String(n));
  function seedFees(category: FeeCategory): FeeRow[] {
    const rows: FeeRow[] =
      category === "dealer"
        ? [{ name: "Doc fee", amount: "", taxable: feeTaxableDefault(zipState, "doc"), timing: "signing", kind: "doc" }]
        : [
            { name: "Title fee", amount: "", taxable: feeTaxableDefault(zipState, "title"), timing: "signing", kind: "title" },
            { name: "Registration fee", amount: "", taxable: feeTaxableDefault(zipState, "registration"), timing: "signing", kind: "registration" },
          ];
    const prior = [...(initial?.dueAtSigning.otherFees || []).map((x) => ({ ...x, timing: x.timing ?? ("signing" as LineTiming) })), ...(initial?.rolledFees || []).map((x) => ({ ...x, timing: "rolled" as LineTiming }))].filter((x) => (x.category ?? "dealer") === category);
    for (const x of prior) {
      const slot = rows.find((r) => r.kind !== "other" && !r.amount && (r.kind === "doc" ? /^doc(umentation)? fee$/i.test(x.name) : r.kind === "title" ? /title/i.test(x.name) && !/regis/i.test(x.name) : /regis/i.test(x.name)));
      if (slot) Object.assign(slot, { amount: String(x.amount), taxable: x.taxable ?? slot.taxable, timing: x.timing });
      else rows.push({ name: x.name, amount: String(x.amount), taxable: x.taxable ?? feeTaxableDefault(zipState, "other"), timing: x.timing, kind: "other" });
    }
    return rows;
  }
  const [f, setF] = useState<Draft>({
    vin: normalizeVin(vin),
    stockNumber: stockNumber || "",
    vehicleStatus: initial?.vehicleStatus ?? "",
    etaDate: initial?.etaDate ?? "",
    lenderChoice: initial?.lenderType === "captive" && (CAPTIVE_LENDERS as readonly string[]).includes(initial.lenderName ?? "") ? initial.lenderName! : initial?.lenderType === "bank" ? "__bank" : initial?.lenderType ? "__other" : "",
    lenderName: initial?.lenderType === "captive" ? "" : initial?.lenderName ?? "",
    creditTierAssumed: initial?.creditTierAssumed ?? "",
    msrp: str(initial?.msrpForResidual),
    // A revision starts from the last selling price; a pre-v2 quote only stored the cap cost.
    sellingPrice: str(initial?.sellingPrice ?? initial?.capCost),
    capCost: "",
    netCapReason: "",
    termMonths: String(prefs.termMonths),
    milesPerYear: String(prefs.milesPerYear),
    residualPercent: str(initial?.residualPercent),
    residualAmount: str(initial?.residualAmount),
    moneyFactor: str(initial?.moneyFactor),
    capReduction: str(initial?.capReduction),
    acquisitionFee: str(initial?.dueAtSigning.acquisitionFee),
    // Three decimals: NJ is 6.625%, and rounding it to 6.63% would misstate the monthly.
    taxRatePercent: zipRate != null ? String(Math.round(zipRate * 100000) / 1000) : "",
    taxMethod: initial?.taxMethod ?? leaseTaxMethodDefault(zipState),
    taxMethodOther: initial?.taxMethodOther ?? "",
    taxesAtSigning: str(initial?.dueAtSigning.taxes),
    securityDeposit: initial?.securityDeposit != null ? String(initial.securityDeposit) : "",
    dispositionFee: initial?.dispositionFee != null ? String(initial.dispositionFee) : "",
    excessMileagePerMile: initial?.excessMileagePerMile != null ? String(initial.excessMileagePerMile) : "",
    // Lease programs reset monthly, so the default is the last day of this month (a counter keeps its original date).
    expiresAt: carryOverDate(initial?.expiresAt) || endOfMonthDate(),
    notes: initial?.notes || "",
    counterNote: "",
  });
  // A standing first line for the manufacturer lease incentive (amount blank, not removable).
  const [incentives, setIncentives] = useState<IncentiveRow[]>(() => {
    const seeded: IncentiveRow[] = (initial?.incentives || []).map((i) => ({ name: i.name, amount: String(i.amount), eligibilityType: i.eligibilityType ?? "", proof: i.eligibilityProof ?? "" }));
    return seeded.some((i) => i.name === "Lease cash / rebate") ? seeded : [{ name: "Lease cash / rebate", amount: "", eligibilityType: "", proof: "" }, ...seeded];
  });
  const [incentiveAttested, setIncentiveAttested] = useState(Boolean(initial?.incentiveAttested));
  // Fees are two lists. The doc fee (dealer) and the title and registration fees (government) are always rows —
  // amount blank until typed, never removable. "Taxable" starts from the state table, else doc fee = taxable and the rest = not.
  const [dealerFees, setDealerFees] = useState<FeeRow[]>(() => seedFees("dealer"));
  const [govFees, setGovFees] = useState<FeeRow[]>(() => seedFees("government"));
  const [addOns, setAddOns] = useState<AddOnRow[]>(() => (initial?.addOns || []).map((a) => ({ name: a.name, amount: String(a.amount), taxable: a.taxable ?? true, removable: a.removable == null ? "" : a.removable ? "yes" : "no", timing: a.timing ?? "signing" })));
  const [capitalizeAcq, setCapitalizeAcq] = useState(Boolean(initial?.acquisitionFeeRolled));
  const [counterOffer, setCounterOffer] = useState(false);
  const [noTaxEstimate, setNoTaxEstimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  // Which formatted fields are being edited right now (show raw while typing).
  const [focused, setFocused] = useState<keyof Draft | null>(null);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const feeLines = (list: FeeRow[], category: FeeCategory): LineItem[] =>
    list.map((r) => ({ name: r.name.trim(), amount: num(r.amount) ?? NaN, category, taxable: r.taxable, timing: r.timing })).filter((i) => i.name && Number.isFinite(i.amount));
  const sumOf = (list: Array<{ amount: number }>) => list.reduce((t, i) => t + i.amount, 0);

  // --- the worksheet, all nullable -------------------------------------
  const d = useMemo(() => {
    const msrp = num(f.msrp);
    const sellingPrice = num(f.sellingPrice);
    const inc: LineItem[] = incentives
      .map((i) => ({ name: i.name.trim(), amount: num(i.amount) ?? NaN, ...(i.eligibilityType ? { eligibilityType: i.eligibilityType } : {}), ...(i.proof.trim() ? { eligibilityProof: i.proof.trim() } : {}) }))
      .filter((i) => i.name && Number.isFinite(i.amount));
    const incentivesTotal = sumOf(inc);
    const pricedIncentives = inc.some((i) => i.amount > 0);
    const fees = [...feeLines(dealerFees, "dealer"), ...feeLines(govFees, "government")];
    const feesSigning = fees.filter((x) => x.timing === "signing");
    const feesRolled = fees.filter((x) => x.timing === "rolled");
    const addOnLines: LineItem[] = addOns
      .map((a) => ({ name: a.name.trim(), amount: num(a.amount) ?? NaN, taxable: a.taxable, timing: a.timing, ...(a.removable ? { removable: a.removable === "yes" } : {}) }))
      .filter((a) => a.name && Number.isFinite(a.amount));
    const acquisitionFee = num(f.acquisitionFee);
    const acquisitionRolled = capitalizeAcq ? (acquisitionFee ?? 0) : 0;
    const capReduction = num(f.capReduction);
    const calcNet = calcNetCap({
      sellingPrice,
      incentivesTotal,
      rolledFeesTotal: sumOf(feesRolled),
      rolledAddOnsTotal: sumOf(addOnLines.filter((a) => a.timing === "rolled")),
      acquisitionRolled,
      capReduction,
    });
    const netCapEntered = num(f.capCost);
    const netCap = netCapEntered ?? calcNet;
    const netCapOverridden = netCapEntered != null && calcNet != null && Math.abs(netCapEntered - calcNet) > 0.5;
    // Stored cap cost stays the gross figure (before the cap reduction) — the trade math and counter sheet read it that way.
    const capCost = netCap != null && netCap > 0 ? Math.round((netCap + (capReduction ?? 0)) * 100) / 100 : null;
    const term = num(f.termMonths);
    const miles = num(f.milesPerYear);
    const residualPercent = num(f.residualPercent);
    const residualFromMsrp = residualAmountFrom(msrp, residualPercent);
    const residualAmount = num(f.residualAmount) ?? residualFromMsrp;
    const mf = num(f.moneyFactor);
    const taxRate = noTaxEstimate ? null : num(f.taxRatePercent) != null ? num(f.taxRatePercent)! / 100 : null;
    const monthly = monthlyPreTax({ netCap: netCap != null && netCap > 0 ? netCap : null, residualAmount, moneyFactor: mf, termMonths: term });
    // The selected tax method decides what is taxed monthly and what is taxed up front.
    const taxableAtSigning = sumOf(feesSigning.filter((x) => x.taxable)) + sumOf(addOnLines.filter((a) => a.timing === "signing" && a.taxable));
    const tax = computeLeaseTax({ method: f.taxMethod || null, taxRate, monthly, termMonths: term, grossCapCost: capCost, capReduction, taxableAtSigning, taxesOverride: num(f.taxesAtSigning) });
    const taxed = noTaxEstimate ? null : tax.monthlyTaxed;
    const securityDeposit = num(f.securityDeposit);
    const das = dueAtSigningFrom({
      monthly,
      monthlyTaxed: taxed,
      acquisitionFee: capitalizeAcq ? 0 : acquisitionFee,
      capReduction,
      taxesOverride: tax.taxesAtSigning,
      taxRate,
      otherFees: feesSigning,
      securityDeposit,
      addOnsDue: addOnLines.filter((a) => a.timing === "signing"),
    });
    const total = totalLeaseCost(taxed ?? monthly, term, das, num(f.dispositionFee) ?? 0);
    const residualDrift = num(f.residualAmount) != null && residualFromMsrp != null && Math.abs(num(f.residualAmount)! - residualFromMsrp) > 1;
    return {
      msrp, sellingPrice, incentivesTotal, pricedIncentives, calcNet, netCapOverridden, capCost, term, miles, residualPercent, residualFromMsrp, residualAmount, mf, apr: aprFromMf(mf), capReduction, taxRate,
      netCap, monthly, taxed, das, dasTotal: dasTotal(das), total, residualDrift, incentives: inc, feesSigning, feesRolled, addOnLines, acquisitionRolled, securityDeposit,
    };
  }, [f, incentives, dealerFees, govFees, addOns, capitalizeAcq, noTaxEstimate]);

  const lenderType = f.lenderChoice === "" ? undefined : f.lenderChoice === "__bank" ? ("bank" as const) : f.lenderChoice === "__other" ? ("other" as const) : ("captive" as const);
  const quote: Partial<LeaseQuote> = {
    capCost: d.capCost ?? undefined,
    sellingPrice: d.sellingPrice ?? undefined,
    msrpForResidual: d.msrp ?? undefined,
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
    incentiveAttested: d.pricedIncentives && incentiveAttested,
    addOns: d.addOnLines,
    rolledFees: d.feesRolled,
    acquisitionFeeRolled: d.acquisitionRolled || undefined,
    expiresAt: f.expiresAt ? new Date(f.expiresAt + "T23:59:59").toISOString() : "",
    notes: f.notes.trim() || null,
    counter: { counterOffer, note: f.counterNote },
    lenderType,
    lenderName: lenderType === "captive" ? f.lenderChoice : f.lenderName.trim(),
    creditTierAssumed: f.creditTierAssumed,
    taxMethod: f.taxMethod || undefined,
    taxMethodOther: f.taxMethod === "other" ? f.taxMethodOther.trim() : null,
    vehicleStatus: f.vehicleStatus || undefined,
    etaDate: f.vehicleStatus && f.vehicleStatus !== "in_stock" ? f.etaDate : null,
    securityDeposit: d.securityDeposit ?? undefined,
    dispositionFee: num(f.dispositionFee) ?? undefined,
    excessMileagePerMile: num(f.excessMileagePerMile) ?? undefined,
    netCapOverrideReason: d.netCapOverridden ? f.netCapReason.trim() : null,
  };
  // Run the server's finishing step here too, so the form shows the same warnings and total the buyer will get.
  const finalQuote = useMemo(() => finalizeLeaseQuote({ ...quote, dueAtSigning: quote.dueAtSigning ? { ...quote.dueAtSigning } : undefined }), [quote]);
  const vinError = vinProblem(f.vin);
  const validation = useMemo(() => validateLeaseQuote(finalQuote, prefs, { vin: f.vin, stockNumber: f.stockNumber }), [finalQuote, prefs, f.vin, f.stockNumber]);
  const warnings = [...validation.warnings, ...(d.residualDrift ? [`Residual amount ${money(d.residualAmount)} doesn't match ${d.residualPercent}% of MSRP (${money(d.residualFromMsrp)}) — double-check which one is right.`] : [])];
  const lowerTier = pricedAtLowerTier(f.creditTierAssumed, prefs.creditBand);
  const [taxConfirmed, setTaxConfirmed] = useState(false);
  const taxPending = counterPriceChanged(counterSheet) && !taxConfirmed && f.taxesAtSigning === str(initial?.dueAtSigning.taxes);
  const errors = [...validation.errors, ...(taxPending ? [TAX_PROMPT_COPY] : [])];
  const differs = Number(f.termMonths) !== prefs.termMonths || Number(f.milesPerYear) !== prefs.milesPerYear;

  const submit = async () => {
    setTouched(true);
    setServerError(null);
    if (errors.length) return;
    setBusy(true);
    try {
      let tradeBody: Record<string, unknown> | null = null;
      if (trade?.hasTrade) {
        const c = trade.check(quote.expiresAt || null);
        if (!c.ok) { setServerError(c.errors.join(" ")); return; }
        tradeBody = c.trade;
      }
      const res = await fetch("/api/quote-invite/lease-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, vin: f.vin, stockNumber: f.stockNumber, quote, ...(tradeBody ? { trade: tradeBody } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        trade?.onReject(json);
        setServerError(Array.isArray(json.errors) && json.errors.length ? json.errors.join(" ") : json.error || "Could not submit the quote.");
        return;
      }
      onSubmitted({ warnings: json.warnings || [], dueAtSigningTotal: json.dueAtSigningTotal || d.dasTotal || 0 });
    } finally {
      setBusy(false);
    }
  };

  // --- render helpers (plain functions: nested components would remount and drop focus) ---
  const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none tabular-nums";
  const labelCls = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";
  const hintCls = "block text-[10px] text-ink-faint";
  const req = <span className="text-amber-300">*</span>;
  type Fmt = "money" | "percent" | "mf" | "text";
  const fmt = (kind: Fmt, raw: string) => (kind === "money" ? formatMoneyInput(raw) : kind === "percent" ? formatPercentInput(raw) : kind === "mf" ? formatMoneyFactorInput(raw) : raw);
  const field = (o: { k: keyof Draft; title: string; kind?: Fmt; hint?: React.ReactNode; placeholder?: string; required?: boolean; mono?: boolean; testId?: string }) => {
    const kind = o.kind || "money";
    const editing = focused === o.k;
    return (
      <label className="space-y-1">
        <span className={labelCls}>
          {o.title} {o.required ? req : null}
        </span>
        {kind === "money" ? (
          <MoneyInput allowCents value={f[o.k]} onValueChange={(v) => setF((s) => ({ ...s, [o.k]: v }))} placeholder={o.placeholder ?? ""} data-testid={o.testId} className={`${input} font-mono`} />
        ) : (
          <input
            type="text"
            inputMode={kind === "text" ? "text" : "decimal"}
            value={editing || kind === "text" ? f[o.k] : fmt(kind, f[o.k])}
            onFocus={() => setFocused(o.k)}
            onBlur={() => setFocused(null)}
            onChange={set(o.k)}
            placeholder={o.placeholder ?? ""}
            data-testid={o.testId}
            className={`${input} ${o.mono || kind !== "text" ? "font-mono" : ""}`}
          />
        )}
        {o.hint ? <span className={hintCls}>{o.hint}</span> : null}
      </label>
    );
  };
  const selectField = (o: { k: keyof Draft; title: string; options: Array<[string, string]>; placeholder: string; required?: boolean; hint?: React.ReactNode; testId?: string }) => (
    <label className="space-y-1">
      <span className={labelCls}>{o.title} {o.required ? req : null}</span>
      <select value={f[o.k]} onChange={set(o.k)} className={input} data-testid={o.testId}>
        <option value="">{o.placeholder}</option>
        {o.options.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
      </select>
      {o.hint ? <span className={hintCls}>{o.hint}</span> : null}
    </label>
  );
  const moneyBox = (value: string, onChange: (v: string) => void, label: string) => (
    <span className="relative block">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">$</span>
      <MoneyInput allowCents value={value} onValueChange={onChange} placeholder="0" aria-label={label} className={`${input} pl-6 font-mono`} />
    </span>
  );
  const removeBtn = (onClick: () => void, label: string) => (
    <button type="button" onClick={onClick} className="text-ink-muted hover:text-rose-400" aria-label={label}>
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
  const addBtn = (onClick: () => void, label: string) => (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-[11px] font-bold text-brand-400 hover:text-brand-300">
      <Plus className="h-3 w-3" /> {label}
    </button>
  );
  const timingSelect = (value: LineTiming, onChange: (t: LineTiming) => void, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value as LineTiming)} aria-label={label} className={`${input} !w-auto py-1`}>
      {LINE_TIMINGS.map((t) => (<option key={t} value={t}>{LINE_TIMING_LABELS[t]}</option>))}
    </select>
  );
  const taxableBox = (checked: boolean, onChange: (v: boolean) => void, label: string) => (
    <label className="flex items-center gap-1.5 text-[11px] text-ink-light">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="h-3.5 w-3.5" /> Taxable
    </label>
  );
  const rowBox = "space-y-1.5 rounded-lg border border-border/60 bg-background/40 p-2";
  // One fee list (dealer or government): a description + amount, then Taxable and when it is paid.
  const feeList = (o: { title: string; testId: string; rows: FeeRow[]; setRows: React.Dispatch<React.SetStateAction<FeeRow[]>>; placeholder: string; addLabel: string; hint: string; category: FeeCategory }) => {
    const sub = sumOf(feeLines(o.rows, o.category));
    const upd = (i: number, patch: Partial<FeeRow>) => o.setRows((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    return (
      <div className="space-y-1.5" data-testid={o.testId}>
        <div className="flex items-baseline justify-between"><span className={labelCls}>{o.title}</span><span className="text-[10px] tabular-nums text-ink-muted">Subtotal {money(sub, 2)}</span></div>
        {o.rows.map((r, i) => (
          <div key={i} className={rowBox}>
            <div className="grid grid-cols-[1fr_140px_20px] items-center gap-2">
              <input type="text" value={r.name} readOnly={r.kind !== "other"} onChange={(e) => upd(i, { name: e.target.value })} placeholder={o.placeholder} aria-label={`${o.title} description`} className={`${input} ${r.kind !== "other" ? "text-ink-light" : ""}`} />
              {moneyBox(r.amount, (v) => upd(i, { amount: v }), `${r.name || o.title} amount`)}
              {r.kind !== "other" ? <span /> : removeBtn(() => o.setRows((p) => p.filter((_, j) => j !== i)), `Remove ${o.title.toLowerCase()} line`)}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {taxableBox(r.taxable, (v) => upd(i, { taxable: v }), `${r.name || "Fee"} taxable`)}
              {timingSelect(r.timing, (t) => upd(i, { timing: t }), `${r.name || "Fee"} timing`)}
            </div>
          </div>
        ))}
        {addBtn(() => o.setRows((p) => [...p, { name: "", amount: "", taxable: feeTaxableDefault(zipState, "other"), timing: "signing", kind: "other" }]), o.addLabel)}
        <span className={hintCls}>{o.hint}</span>
      </div>
    );
  };
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
  const feeDas = (cat: FeeCategory) => (d.das?.otherFees || []).filter((x) => (x.category ?? "dealer") === cat);

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5" data-testid="dealer-lease-calculator">
      {/* buyer prefs banner */}
      <div className="rounded-xl border border-border/70 bg-surface-elevated px-3.5 py-3 text-xs text-ink-light" data-testid="buyer-prefs-banner">
        Buyer locked <strong className="text-white">{prefs.termMonths} months · {prefs.milesPerYear.toLocaleString()} mi/yr</strong>
        {prefs.creditBand ? <> · <strong className="text-white">{CREDIT_BAND_LABELS[prefs.creditBand].toLowerCase()} credit</strong> (their own estimate — no pull)</> : null}
        {prefs.dueAtSigningIntent ? <> · up front: {LEASE_DAS_INTENT_LABELS[prefs.dueAtSigningIntent].toLowerCase()}</> : null}
        {prefs.zip ? <> · ZIP {prefs.zip} (tax context)</> : null}. Match that, or mark a counter below.
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          {/* 1 — vehicle */}
          {section(
            "1 · Vehicle",
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className={labelCls}>VIN {req}</span>
                  <input
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={17}
                    value={f.vin}
                    onChange={(e) => setF((s) => ({ ...s, vin: normalizeVin(e.target.value.replace(/\s/g, "")) }))}
                    aria-invalid={Boolean(vinError)}
                    data-testid="vin-input"
                    className={`${input} font-mono ${vinError && (f.vin || touched) ? "border-rose-500/60" : ""}`}
                  />
                  {vinError && (f.vin || touched) ? <span className="block text-[10px] text-rose-300" data-testid="vin-error">{vinError}</span> : <span className={hintCls}>17 characters; no I, O or Q.</span>}
                </label>
                {field({ k: "stockNumber", title: "Stock #", kind: "text", mono: true })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {selectField({ k: "vehicleStatus", title: "Vehicle status", required: true, placeholder: "Select…", options: VEHICLE_STATUSES.map((v) => [v, VEHICLE_STATUS_LABELS[v]] as [string, string]), testId: "vehicle-status" })}
                {f.vehicleStatus && f.vehicleStatus !== "in_stock" ? (
                  <label className="space-y-1">
                    <span className={labelCls}>ETA date {req}</span>
                    <input type="date" value={f.etaDate} min={todayISO()} onChange={set("etaDate")} className={input} data-testid="eta-date" />
                  </label>
                ) : null}
              </div>
            </>
          )}

          {/* 2 — lender and credit tier */}
          {section(
            "2 · Lender & credit tier",
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={labelCls}>Lender {req}</span>
                <select value={f.lenderChoice} onChange={set("lenderChoice")} className={input} data-testid="lender-select">
                  <option value="">Select…</option>
                  <optgroup label="Manufacturer captive">
                    {CAPTIVE_LENDERS.map((n) => (<option key={n} value={n}>{n}</option>))}
                  </optgroup>
                  <option value="__bank">Bank / credit union</option>
                  <option value="__other">Other</option>
                </select>
                {f.lenderChoice === "__bank" || f.lenderChoice === "__other" ? (
                  <input type="text" value={f.lenderName} onChange={set("lenderName")} maxLength={80} placeholder={f.lenderChoice === "__bank" ? "Bank or credit union name" : "Lender name"} aria-label="Lender name" className={input} data-testid="lender-name" />
                ) : null}
              </label>
              <label className="space-y-1">
                <span className={labelCls}>Credit tier assumed for the money factor {req}</span>
                <select value={f.creditTierAssumed} onChange={set("creditTierAssumed")} className={input} data-testid="credit-tier">
                  <option value="">Select…</option>
                  {CREDIT_TIERS.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
                <span className={hintCls}>{prefs.creditBand ? `Buyer estimated: ${CREDIT_BAND_LABELS[prefs.creditBand].toLowerCase()}` : "The buyer did not state a credit band."}</span>
                {lowerTier ? <span className="block text-[10px] font-bold text-amber-300" data-testid="lower-tier-warning">The buyer will see “{PRICED_AT_LOWER_TIER_LABEL}”.</span> : null}
              </label>
            </div>
          )}

          {/* 3 — MSRP → selling price → incentives */}
          {section(
            "3 · Price & incentives",
            <>
              <div className="grid grid-cols-2 gap-3">
                {field({ k: "msrp", title: "MSRP used for residual", required: true, testId: "msrp-input", hint: "Some lenders use an adjusted MSRP. Enter the figure your residual is based on." })}
                {field({ k: "sellingPrice", title: "Selling price", required: true, hint: d.msrp != null && d.sellingPrice != null && d.msrp > 0 ? `${money(d.msrp - d.sellingPrice)} (${Math.round(((d.msrp - d.sellingPrice) / d.msrp) * 1000) / 10}%) off MSRP` : "Before incentives." })}
              </div>
              <div className="space-y-1.5" data-testid="incentive-list">
                <span className={labelCls}>Incentives / rebates</span>
                {incentives.map((it, i) => {
                  const fixed = i === 0 && it.name === "Lease cash / rebate";
                  const upd = (patch: Partial<IncentiveRow>) => setIncentives((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <div key={i} className={rowBox}>
                      <div className="grid grid-cols-[1fr_140px_20px] items-center gap-2">
                        <input type="text" value={it.name} readOnly={fixed} onChange={(e) => upd({ name: e.target.value })} placeholder="Describe the incentive, e.g. Loyalty or Conquest" aria-label="Incentive description" className={`${input} ${fixed ? "text-ink-light" : ""}`} />
                        {moneyBox(it.amount, (v) => upd({ amount: v }), `${it.name || "Incentive"} amount`)}
                        {fixed ? <span /> : removeBtn(() => setIncentives((p) => p.filter((_, j) => j !== i)), "Remove incentive line")}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={it.eligibilityType} onChange={(e) => upd({ eligibilityType: e.target.value as IncentiveEligibility | "" })} aria-label={`${it.name || "Incentive"} eligibility`} className={input}>
                          <option value="">Who is it open to?</option>
                          {INCENTIVE_ELIGIBILITY_TYPES.map((t) => (<option key={t} value={t}>{INCENTIVE_ELIGIBILITY_LABELS[t]}</option>))}
                        </select>
                        <input type="text" value={it.proof} maxLength={120} onChange={(e) => upd({ proof: e.target.value })} placeholder="Proof needed, e.g. current Ford lease" aria-label={`${it.name || "Incentive"} proof needed`} className={input} />
                      </div>
                    </div>
                  );
                })}
                {addBtn(() => setIncentives((p) => [...p, { name: "", amount: "", eligibilityType: "", proof: "" }]), "Add another incentive")}
                <span className={hintCls}>Lease cash is always listed — enter the amount, or leave it blank if there is none. The buyer sees each incentive as dealer-claimed.</span>
              </div>
              {d.pricedIncentives ? (
                <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-100" data-testid="incentive-attestation">
                  <input type="checkbox" checked={incentiveAttested} onChange={(e) => setIncentiveAttested(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
                  <span>{INCENTIVE_ATTESTATION_COPY} {req}</span>
                </label>
              ) : null}
            </>
          )}

          {/* 4 — fees */}
          {section(
            "4 · Fees",
            <>
              <div className="grid grid-cols-2 gap-3">
                {field({ k: "acquisitionFee", title: "Acquisition fee" })}
                <label className="flex items-start gap-2 pt-5 text-[11px] text-ink-light">
                  <input type="checkbox" checked={capitalizeAcq} onChange={(e) => setCapitalizeAcq(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
                  <span>Roll the acquisition fee into the cap cost (otherwise it&apos;s due at signing)</span>
                </label>
              </div>
              {feeList({ title: "Dealer fees", testId: "dealer-fees", rows: dealerFees, setRows: setDealerFees, placeholder: "Describe the fee, e.g. Electronic filing", addLabel: "Add a dealer fee", category: "dealer", hint: "Doc fee is always listed — enter the amount. Every other fee needs a description; a single unlabeled lump can't be submitted." })}
              {feeList({ title: "Government fees (pass-through)", testId: "government-fees", rows: govFees, setRows: setGovFees, placeholder: "Describe the fee, e.g. Plate transfer", addLabel: "Add a government fee", category: "government", hint: "Title and registration are always listed. Government fees are passed through at cost." })}
            </>
          )}

          {/* 5 — add-ons */}
          {section(
            "5 · Add-ons",
            <div className="space-y-1.5" data-testid="add-on-list">
              {addOns.map((a, i) => {
                const upd = (patch: Partial<AddOnRow>) => setAddOns((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className={rowBox}>
                    <div className="grid grid-cols-[1fr_140px_20px] items-center gap-2">
                      <input type="text" value={a.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Describe the add-on, e.g. Wheel & tire protection" aria-label="Add-on description" className={input} />
                      {moneyBox(a.amount, (v) => upd({ amount: v }), `${a.name || "Add-on"} amount`)}
                      {removeBtn(() => setAddOns((p) => p.filter((_, j) => j !== i)), "Remove add-on line")}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {taxableBox(a.taxable, (v) => upd({ taxable: v }), `${a.name || "Add-on"} taxable`)}
                      <select value={a.removable} onChange={(e) => upd({ removable: e.target.value as "" | "yes" | "no" })} aria-label={`${a.name || "Add-on"} removable at the buyer's request`} className={`${input} !w-auto py-1`}>
                        <option value="">Removable at buyer&apos;s request?</option>
                        <option value="yes">Removable: Yes</option>
                        <option value="no">Removable: No</option>
                      </select>
                      {timingSelect(a.timing, (t) => upd({ timing: t }), `${a.name || "Add-on"} timing`)}
                    </div>
                  </div>
                );
              })}
              {addBtn(() => setAddOns((p) => [...p, { name: "", amount: "", taxable: true, removable: "", timing: "signing" }]), "Add add-on")}
              <span className={hintCls}>Optional. The buyer sees each line. Rolled-in add-ons are included in the net cap cost.</span>
            </div>
          )}

          {/* 6 — net cap cost */}
          {section(
            "6 · Cap cost",
            <>
              <div className="grid grid-cols-2 gap-3">
                {field({
                  k: "capCost",
                  title: "Net cap cost",
                  placeholder: d.calcNet != null ? formatMoneyInput(d.calcNet) : "",
                  testId: "net-cap-input",
                  hint: (
                    <>
                      = selling price + rolled-in fees and add-ons{capitalizeAcq ? " + acquisition fee" : ""} − incentives − cap reduction
                      {d.calcNet != null && !f.capCost ? ` → ${money(d.calcNet)}` : ""}. Type to override.
                    </>
                  ),
                })}
                {field({ k: "capReduction", title: "Cap cost reduction", hint: "Cash down applied to the cap cost; also a due-at-signing line." })}
              </div>
              {d.netCapOverridden ? (
                <label className="space-y-1" data-testid="net-cap-reason">
                  <span className={labelCls}>Why does the net cap cost differ from the calculated {money(d.calcNet)}? {req}</span>
                  <input type="text" value={f.netCapReason} maxLength={200} onChange={set("netCapReason")} placeholder="Short reason, e.g. lender-required adjustment" className={input} />
                  <span className={hintCls}>The buyer sees “Adjusted by dealer: {f.netCapReason.trim() || "your reason"}”.</span>
                </label>
              ) : null}
            </>
          )}

          {/* 7 — term / miles */}
          {section(
            "7 · Term & miles",
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

          {/* 8 — residual, money factor */}
          {section(
            "8 · Residual & money factor",
            <div className="grid grid-cols-2 gap-3">
              {field({ k: "residualPercent", title: "Residual %", kind: "percent", required: true, hint: "Of the MSRP used for residual." })}
              {field({
                k: "residualAmount",
                title: "Residual amount",
                required: true,
                placeholder: d.residualFromMsrp != null ? formatMoneyInput(d.residualFromMsrp) : "",
                hint: d.residualFromMsrp != null ? (f.residualAmount ? `MSRP × ${d.residualPercent}% = ${money(d.residualFromMsrp)} — you overrode it.` : `= MSRP × ${d.residualPercent}%. Type to override.`) : "Enter MSRP above and it fills in, or type it.",
              })}
              {d.residualDrift ? <p className="col-span-2 text-[10px] text-amber-200" data-testid="residual-direct-note">Doesn&apos;t match MSRP × residual % — the buyer will see “{RESIDUAL_ENTERED_DIRECTLY_NOTE}”.</p> : null}
              {field({ k: "moneyFactor", title: "Money factor", kind: "mf", required: true, hint: d.apr != null ? `≈ ${d.apr}% APR` : "e.g. 0.00250", placeholder: "0.00000" })}
            </div>
          )}

          {/* 9 — tax */}
          {section(
            "9 · Tax",
            <>
              {counterPriceChanged(counterSheet) ? <TaxUpdatePrompt pending={taxPending} confirmed={taxConfirmed} onConfirm={setTaxConfirmed} /> : null}
              <div className="grid grid-cols-2 gap-3">
                {selectField({
                  k: "taxMethod", title: "Tax method", required: true, placeholder: "Select…", testId: "tax-method",
                  options: LEASE_TAX_METHODS.map((m) => [m, LEASE_TAX_METHOD_LABELS[m]] as [string, string]),
                  hint: "Applied to “Monthly with est. tax” and “Due at signing”.",
                })}
                {f.taxMethod === "other" ? (
                  <label className="space-y-1">
                    <span className={labelCls}>Describe the tax method {req}</span>
                    <input type="text" value={f.taxMethodOther} maxLength={200} onChange={set("taxMethodOther")} className={input} data-testid="tax-method-other" />
                  </label>
                ) : <span />}
                {field({ k: "taxRatePercent", title: "Sales tax rate", kind: "percent", hint: prefs.zip ? `Estimated for ZIP ${prefs.zip} — edit if you use another rate.` : "Blank = tax estimated at signing." })}
                {field({ k: "taxesAtSigning", title: "Taxes due at signing", hint: "Calculated from the tax method; type your figure to override." })}
              </div>
              <label className="flex items-start gap-2 text-[11px] text-ink-light">
                <input type="checkbox" checked={noTaxEstimate} onChange={(e) => setNoTaxEstimate(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
                <span>Can&apos;t estimate tax — the buyer sees &ldquo;tax estimated at signing&rdquo;</span>
              </label>
            </>
          )}

          {/* 10 — deposit and end-of-lease costs */}
          {section(
            "10 · Deposit & end-of-lease costs",
            <div className="grid grid-cols-3 gap-3">
              {field({ k: "securityDeposit", title: "Security deposit", required: true, placeholder: "0", testId: "security-deposit", hint: "$0 is fine. Shown in due at signing; refunded, so not in total lease cost." })}
              {field({ k: "dispositionFee", title: "Disposition fee", required: true, placeholder: "0", testId: "disposition-fee", hint: "End-of-lease cost. $0 is fine." })}
              {field({ k: "excessMileagePerMile", title: "Excess mileage charge", required: true, placeholder: "e.g. 0.25", testId: "excess-mileage", hint: "End-of-lease cost, $ per mile. $0 is fine." })}
            </div>
          )}

          {/* 11 — good through, notes, counter */}
          {section(
            "11 · Good-through date & notes",
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className={labelCls}>
                    Quote good through {req} {initial && f.expiresAt ? <span className="font-normal normal-case text-ink-faint">(carried over — change only if needed)</span> : null}
                  </span>
                  <input type="date" value={f.expiresAt} min={todayISO()} max={plusDaysISO(GOOD_THROUGH_MAX_DAYS)} onChange={set("expiresAt")} className={input} data-testid="good-through" />
                  <span className={hintCls}>Today or later, up to {GOOD_THROUGH_MAX_DAYS} days out. Defaults to the end of the month (lease programs reset monthly).</span>
                </label>
                <label className="space-y-1">
                  <span className={labelCls}>Notes (optional)</span>
                  <textarea value={f.notes} onChange={set("notes")} maxLength={1000} rows={3} className={`${input} resize-y`} data-testid="notes" />
                  <span className={hintCls}>{f.notes.length}/1000</span>
                </label>
              </div>
              {differs ? (
                <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/20 px-3.5 py-3" data-testid="counter-box">
                  <label className="flex items-start gap-2 text-xs text-amber-100">
                    <input type="checkbox" checked={counterOffer} onChange={(e) => setCounterOffer(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
                    <span>
                      This is a <strong>counter-offer</strong> — the term or miles differ from what the buyer asked for ({prefs.termMonths} mo / {prefs.milesPerYear.toLocaleString()} mi). The buyer will see it flagged.
                    </span>
                  </label>
                  <input
                    type="text"
                    value={f.counterNote}
                    onChange={set("counterNote")}
                    placeholder="Why — e.g. 39 mo carries a better residual this month"
                    maxLength={300}
                    className={input}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* results, live */}
        <aside className="h-fit space-y-3 rounded-xl border border-border bg-background p-4 lg:sticky lg:top-4" data-testid="dealer-lease-results">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Payments</h4>
          {out("Monthly (pre-tax)", money(d.monthly, 2), { strong: true })}
          {noTaxEstimate ? out("Tax", d.monthly != null ? "estimated at signing" : null) : out("Monthly with est. tax", money(d.taxed, 2))}
          <div className="border-t border-border/60 pt-2">
            {out("Due at signing", money(d.dasTotal, 2), { strong: true })}
            {d.das ? (
              <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted tabular-nums" data-testid="das-breakdown">
                <li className="flex justify-between"><span>First month</span><span>{money(d.das.firstMonth, 2)}</span></li>
                {capitalizeAcq ? null : <li className="flex justify-between"><span>Acquisition fee</span><span>{money(d.das.acquisitionFee, 2)}</span></li>}
                <li className="flex justify-between"><span>Cap cost reduction</span><span>{money(d.das.capReduction, 2)}</span></li>
                <li className="flex justify-between"><span>Dealer fees</span><span>{money(sumOf(feeDas("dealer")), 2)}</span></li>
                {feeDas("dealer").map((x, i) => (<li key={`d${i}`} className="flex justify-between pl-2"><span>{x.name}</span><span>{money(x.amount, 2)}</span></li>))}
                <li className="flex justify-between"><span>Government fees</span><span>{money(sumOf(feeDas("government")), 2)}</span></li>
                {feeDas("government").map((x, i) => (<li key={`g${i}`} className="flex justify-between pl-2"><span>{x.name}</span><span>{money(x.amount, 2)}</span></li>))}
                <li className="flex justify-between"><span>Refundable security deposit</span><span>{d.das.securityDeposit != null ? money(d.das.securityDeposit, 2) : "—"}</span></li>
                <li className="flex justify-between"><span>Taxes due at signing</span><span>{noTaxEstimate && !f.taxesAtSigning ? "at signing" : money(d.das.taxes, 2)}</span></li>
                <li className="flex justify-between"><span>Add-ons due at signing</span><span>{money(sumOf(d.das.addOnsDue || []), 2)}</span></li>
              </ul>
            ) : (
              <p className="mt-1 text-[10px] text-ink-faint">Itemized once selling price, residual, money factor and term are in.</p>
            )}
          </div>
          <div className="border-t border-border/60 pt-2 space-y-1">
            {out("Total lease cost", money(d.total, 2), { strong: true })}
            <p className="text-[10px] text-ink-faint">Payments × term + due at signing − first month − refundable deposit + disposition fee.</p>
          </div>
          <div className="border-t border-border/60 pt-2 space-y-1">
            {out("Gross cap cost", money(d.capCost))}
            {out("Net cap cost (financed)", money(d.netCap))}
            {out("Residual", d.residualAmount != null ? `${money(d.residualAmount)}${d.residualPercent != null ? ` (${d.residualPercent}%)` : ""}` : null)}
            {out("Money factor", d.mf != null ? `${formatMoneyFactorInput(d.mf)}${d.apr != null ? ` ≈ ${d.apr}% APR` : ""}` : null)}
          </div>
        </aside>
      </div>

      {touched && errors.length ? (
        <ul className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300 space-y-0.5" data-testid="calc-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {serverError ? <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{serverError}</p> : null}
      {warnings.length ? (
        <ul className="text-[10px] text-amber-200/90 space-y-0.5">
          {Array.from(new Set(warnings)).map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}

      {trade?.slot}
      {trade?.hasTrade && !trade.ready ? <p className="text-[11px] text-amber-200" data-testid="trade-required-hint">Add your trade allowance (or choose &ldquo;Can&apos;t quote this trade&rdquo;) to send this quote. The trade is part of the price.</p> : null}
      <button type="button" onClick={submit} disabled={busy || Boolean(trade?.hasTrade && !trade.ready)} className="w-full rounded-xl bg-brand-500 py-2.5 text-xs font-extrabold text-black hover:bg-brand-400 transition-all disabled:opacity-50" data-testid="submit-quote">
        {busy ? "Submitting…" : "Submit lease quote"}
      </button>
    </div>
  );
}
