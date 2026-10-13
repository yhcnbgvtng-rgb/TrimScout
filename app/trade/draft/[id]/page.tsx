"use client";

export const dynamic = "force-dynamic";

import React, { Suspense, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { TradeInStep, type TradeStepState } from "../../../../components/trade/TradeInStep";

// The phone side of the trade-in: the same draft opened by its own link (the token is the credential, no login), with the
// full step on one page: details, the guided photo slots (camera first), the optional note. Continue says what is missing.
function PhoneTradeIn() {
  const { id } = useParams<{ id: string }>();
  const k = useSearchParams().get("k") || "";
  const [step, setStep] = useState<TradeStepState>({ ready: false, draftId: null, token: null, firstError: null });
  const [attempted, setAttempted] = useState(false);
  const [done, setDone] = useState(false);
  const onContinue = () => { setAttempted(true); if (step.ready) setDone(true); };
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <h1 className="text-lg font-extrabold text-white">Trade-in</h1>
      <TradeInStep enabled onToggle={() => undefined} hideToggle attempted={attempted} onState={(s) => { setStep(s); if (!s.ready) setDone(false); }} draftRef={{ id, token: k }} />
      {done ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-sm text-emerald-200" role="status" data-testid="phone-ready">Your trade-in is complete and saved. Go back to your quote request to send it; it will pick up this draft.</p>
      ) : (
        <div className="space-y-2">
          {attempted && step.firstError ? <p className="text-xs font-semibold text-amber-300" role="alert" data-testid="phone-continue-reason">{step.firstError}</p> : null}
          <button type="button" onClick={onContinue} className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-extrabold text-black hover:bg-brand-400" data-testid="phone-continue">Continue</button>
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Loading…</p>}><PhoneTradeIn /></Suspense>;
}
