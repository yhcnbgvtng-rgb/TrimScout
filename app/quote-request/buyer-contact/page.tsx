"use client";

export const dynamic = "force-dynamic";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SiteFooter } from "../../../components/SiteFooter";

// Where the winning dealer lands from the "View buyer contact info" button in the "Your offer was accepted" email. The link is a
// signed, expiring, single-dealer token (lib/contactRevealToken.ts). Opening the page shows only the vehicle; pressing
// "Reveal buyer contact info" is what shows the buyer's name, email and phone, and that press is logged on the deal.
type Summary = { vehicle: string; vin: string; acceptedOtd: number | null; netAfterTrade: number | null; expiresAt: number };
type Contact = { name: string | null; email: string; phone: string | null; zip: string | null };
const usd = (n: number | null) => (n == null ? "As quoted" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

function Body() {
  const token = useSearchParams().get("t") || "";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(token ? null : "This link isn't valid.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/quote-invite/reveal-contact?t=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.summary) setSummary(j.summary);
        else setError(j.error || "This link isn't valid.");
      })
      .catch(() => setError("We couldn't load this page. Try again in a minute."));
  }, [token]);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/quote-invite/reveal-contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token }), cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.contact) setContact(j.contact);
      else setError(j.error || "We couldn't open the contact info just now.");
    } catch {
      setError("We couldn't open the contact info just now. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/scoutmark.png" alt="TrimScout" className="h-8 w-8 rounded-lg" />
            <span className="font-extrabold text-lg tracking-tight text-white">Trim<span className="text-brand-400">Scout</span></span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10" data-testid="reveal-page">
        <h1 className="text-xl font-extrabold text-white">Your offer was accepted</h1>
        {summary ? (
          <dl className="mt-4 space-y-1 rounded-xl border border-border/70 bg-surface/50 p-4 text-sm" data-testid="reveal-summary">
            <div className="flex justify-between gap-3"><dt className="text-ink-faint">Vehicle</dt><dd className="font-bold text-white">{summary.vehicle}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-faint">VIN</dt><dd className="font-bold text-white">{summary.vin}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-faint">Accepted out-the-door price</dt><dd className="font-bold text-white">{usd(summary.acceptedOtd)}</dd></div>
            {summary.netAfterTrade != null && <div className="flex justify-between gap-3"><dt className="text-ink-faint">Net after trade-in</dt><dd className="font-bold text-white">{usd(summary.netAfterTrade)}</dd></div>}
          </dl>
        ) : null}
        {summary && !contact ? (
          <button type="button" disabled={busy} onClick={reveal} className="mt-5 w-full rounded-xl bg-brand-400 px-4 py-3 text-sm font-extrabold text-black disabled:opacity-60" data-testid="reveal-button">
            {busy ? "Opening…" : "Reveal buyer contact info"}
          </button>
        ) : null}
        {contact ? (
          <dl className="mt-5 space-y-1 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm" data-testid="buyer-contact">
            <div className="flex justify-between gap-3"><dt className="text-ink-faint">Name</dt><dd className="font-bold text-white">{contact.name ?? "Not provided"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-faint">Email</dt><dd className="break-all font-bold text-white">{contact.email}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-faint">Phone</dt><dd className="font-bold text-white">{contact.phone ?? "Not provided"}</dd></div>
          </dl>
        ) : null}
        {contact ? <p className="mt-3 text-xs text-ink-faint">Use these details only to complete this purchase. The buyer sees that you viewed them.</p> : null}
        {error ? <p className="mt-5 text-sm text-rose-300" role="alert" data-testid="reveal-error">{error}</p> : null}
      </main>
      <SiteFooter />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  );
}
