"use client";

import React, { useEffect, useState } from "react";
import { TRADE_CONDITION_LABELS, TRADE_VALUES_COPY, tradeTitle, type RfqTradeIn } from "../lib/rfqTradeIn";

const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none tabular-nums";
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** What the buyer is trading in — details, payoff, and photos (fetched behind the invite token). */
export function TradeInSummary({ token, tradeIn }: { token: string; tradeIn: RfqTradeIn }) {
  const [photos, setPhotos] = useState<string[] | null>(null);
  useEffect(() => {
    if (!tradeIn.photoCount) return;
    let live = true;
    fetch(`/api/quote-invite/trade-in?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((j) => { if (live) setPhotos(j?.tradeIn?.photos || []); })
      .catch(() => { if (live) setPhotos([]); });
    return () => { live = false; };
  }, [token, tradeIn.photoCount]);
  return (
    <div className="space-y-2 text-xs text-ink-light" data-testid="dealer-trade-in-summary">
      <p className="text-sm font-bold text-white">{tradeTitle(tradeIn)}</p>
      <p>{tradeIn.vin ? <>VIN <span className="font-mono">{tradeIn.vin}</span> · </> : null}{tradeIn.mileage.toLocaleString()} mi · {TRADE_CONDITION_LABELS[tradeIn.condition]}</p>
      <p>{tradeIn.payoff ? <>Payoff owed {usd(tradeIn.payoff)}{tradeIn.lender ? ` to ${tradeIn.lender}` : ""}</> : "No payoff reported"}</p>
      {tradeIn.note ? <p className="text-ink-muted">Buyer&apos;s note: &ldquo;{tradeIn.note}&rdquo;</p> : null}
      {photos && photos.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p} alt={`Trade-in photo ${i + 1}`} className="aspect-[4/3] w-full rounded-md border border-border object-cover" />
          ))}
        </div>
      ) : tradeIn.photoCount ? <p className="text-ink-faint">{photos ? "Photos unavailable." : `Loading ${tradeIn.photoCount} photo${tradeIn.photoCount === 1 ? "" : "s"}…`}</p> : null}
    </div>
  );
}

/** The "Trade-in allowance" input, with the copy that keeps it an estimate. */
export function TradeAllowanceInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Trade-in allowance</span>
      <span className="relative block">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">$</span>
        <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="What you'd allow for this car" aria-label="Trade-in allowance" data-testid="trade-allowance-input" className={`${input} pl-6 font-mono`} />
      </span>
      <span className="block text-[10px] text-ink-faint">{TRADE_VALUES_COPY} A separate line from the car&apos;s price — don&apos;t net it into the quote above. Leave blank to answer later.</span>
    </label>
  );
}

export async function saveTradeAllowance(token: string, raw: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = raw.replace(/[$,\s]/g, "");
  if (t === "" || !Number.isFinite(Number(t))) return { ok: false, error: "Enter the allowance as a number." };
  const res = await fetch("/api/quote-invite/trade-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, allowance: Number(t) }) });
  const json = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: json.error || "Could not save the allowance." };
}

/** Standalone panel for a desk that already sent its quote: the trade is a separate line, no re-quote. */
export function DealerTradeInPanel({ token, tradeIn }: { token: string; tradeIn: RfqTradeIn }) {
  const [value, setValue] = useState(tradeIn.allowance != null ? String(tradeIn.allowance) : "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setState("saving"); setError(null);
    const r = await saveTradeAllowance(token, value);
    if (r.ok) setState("saved"); else { setError(r.error); setState("idle"); }
  };
  return (
    <div className="space-y-3 rounded-2xl border border-sky-500/40 bg-sky-950/20 p-5" data-testid="dealer-trade-in-panel">
      <p className="text-sm font-bold text-white">The buyer added a trade-in — please quote a trade value.</p>
      <TradeInSummary token={token} tradeIn={tradeIn} />
      <TradeAllowanceInput value={value} onChange={(v) => { setValue(v); setState("idle"); }} />
      {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}
      <button type="button" onClick={save} disabled={state === "saving" || !value.trim()} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="save-trade-allowance">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved — update" : tradeIn.allowance != null ? "Update allowance" : "Send trade-in allowance"}
      </button>
      <p className="text-[10px] text-ink-faint">Non-binding. Your quote on the car stays exactly as you sent it.</p>
    </div>
  );
}
