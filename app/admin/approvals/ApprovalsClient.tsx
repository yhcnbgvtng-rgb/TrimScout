"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import type { AdminRfq, AdminRfqInvite } from "../../api/admin/rfqs/route";
import { CREDIT_BANDS, EDITOR_QUOTE_TYPES, EDITOR_TIMELINES, FINANCE_TERMS, LEASE_MILES, LEASE_TERMS, prefsPatch, prefsToForm, type PrefsForm } from "../../../lib/adminQuotePrefs";
import { DESK_ROLE_LABELS } from "../../../lib/quotePackage";
import { relativeTime, rfqDealNumber, rfqQuoteTypeLabel, rfqVehicleSummary } from "../../../lib/rfqTracker";

/**
 * The approval desk. Every quote request waits here after the buyer submits;
 * nothing reaches a dealer until an admin releases it. Per request: the whole
 * quote sheet, Approve & release, Reject with a reason the buyer reads, or
 * Edit anything on the sheet first (edits save without releasing).
 */
type Tab = "pending" | "decided";

/** How the invite will be delivered, from what the box stored about its desk. */
export function inviteRoutingLabel(i: Pick<AdminRfqInvite, "desk" | "dealerContactEmail">): { label: string; tone: string } {
  if (i.desk?.source === "buyer") return { label: "Adviser (buyer-added)", tone: "text-brand-300" };
  if (i.desk?.source === "rooftop") return i.dealerContactEmail ? { label: "Dealership sales desk", tone: "text-sky-300" } : { label: "Unassigned — no address on file; ops routes by hand", tone: "text-amber-300" };
  if (i.desk?.contactName) return { label: `Named contact · ${i.desk.contactName}${i.desk.role ? ` (${(DESK_ROLE_LABELS as Record<string, string>)[i.desk.role] || i.desk.role})` : ""}`, tone: "text-brand-300" };
  return { label: "No desk", tone: "text-amber-300" };
}

function buildStateOf(rfq: AdminRfq): string {
  const paste = (rfq.linkPastes || [])[0] as Record<string, unknown> | undefined;
  const conf = paste?.buildConfidence;
  if (conf === "verified_factory") return "Factory build verified";
  if (conf === "dealer_listing_only") return "Factory build not published — VIN decode only";
  return rfq.packageKind === "match" ? "Factory match" : "—";
}

function locksOf(rfq: AdminRfq): string[] {
  const out: string[] = [];
  if (rfq.leasePrefs) {
    out.push(`${rfq.leasePrefs.termMonths} mo`, `${rfq.leasePrefs.milesPerYear.toLocaleString()} mi/yr`, `ZIP ${rfq.leasePrefs.zip}`);
    if (rfq.leasePrefs.creditBand) out.push(`credit ${rfq.leasePrefs.creditBand}`);
    if (rfq.leasePrefs.dueAtSigningIntent) out.push(`DAS ${rfq.leasePrefs.dueAtSigningIntent}`);
  } else if (rfq.quotePrefs?.quoteType === "finance") {
    const f = rfq.quotePrefs.finance as unknown as Record<string, unknown>;
    out.push(`${f.termMonths} mo`, `down $${Number(f.downPayment || 0).toLocaleString()}`, `credit ${f.creditBand}`, `ZIP ${f.zip}`);
  } else if (rfq.quotePrefs?.quoteType === "cash") {
    const c = rfq.quotePrefs.cash as unknown as Record<string, unknown>;
    out.push(`ZIP ${c.zip}`);
  }
  return out;
}

export default function ApprovalsClient() {
  const [tab, setTab] = useState<Tab>("pending");
  const [pending, setPending] = useState<AdminRfq[] | null>(null);
  const [all, setAll] = useState<AdminRfq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, a] = await Promise.all([fetch("/api/admin/rfqs?approval=pending&limit=300"), fetch("/api/admin/rfqs?limit=300")]);
      const pj = await p.json().catch(() => ({}));
      const aj = await a.json().catch(() => ({}));
      if (!p.ok) throw new Error(pj.error || "Could not load pending requests.");
      setPending(pj.rfqs as AdminRfq[]);
      if (a.ok) setAll(aj.rfqs as AdminRfq[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load pending requests.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const decided = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return (all || []).filter((r) => (r.approvalStatus === "approved" || r.approvalStatus === "rejected") && r.approvalDecidedAt && Date.parse(r.approvalDecidedAt) > cutoff).sort((a, b) => Date.parse(b.approvalDecidedAt || "") - Date.parse(a.approvalDecidedAt || ""));
  }, [all]);

  const replace = (rfq: AdminRfq) => {
    setPending((prev) => (prev || []).map((r) => (r.id === rfq.id ? rfq : r)).filter((r) => r.approvalStatus === "pending"));
    setAll((prev) => (prev ? prev.map((r) => (r.id === rfq.id ? rfq : r)) : prev));
    if (rfq.approvalStatus !== "pending") setAll((prev) => (prev && !prev.some((r) => r.id === rfq.id) ? [rfq, ...prev] : prev));
  };

  const decide = async (rfq: AdminRfq, decision: "approved" | "rejected") => {
    const reason = (rejecting[rfq.id] || "").trim();
    if (decision === "rejected" && !reason) return;
    setBusy(rfq.id);
    try {
      const res = await fetch(`/api/admin/rfqs/${rfq.id}/approval`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not record the decision.");
      const released = json.released as Record<string, number> | null;
      setNotice((n) => ({ ...n, [rfq.id]: decision === "approved" ? `Released — redirected to the safe inbox ${released?.sent ?? 0} (not delivered to dealers), unassigned ${released?.no_desk ?? 0}, parked ${released?.parked_switch_off ?? 0}, opted out ${released?.opted_out ?? 0}, failed ${released?.failed ?? 0}` : "Rejected — the buyer sees your reason in their tracker." }));
      replace(json.rfq as AdminRfq);
      setRejecting((r) => ({ ...r, [rfq.id]: "" }));
    } catch (e) {
      setNotice((n) => ({ ...n, [rfq.id]: e instanceof Error ? e.message : "Could not record the decision." }));
    } finally {
      setBusy(null);
    }
  };

  const shown = tab === "pending" ? pending || [] : decided;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="inline-flex items-center gap-1 text-xs font-bold text-ink-muted hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> Admin
            </Link>
            <h1 className="text-sm font-black text-white">Pending approvals</h1>
            {pending ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-black" data-testid="pending-count">{pending.length}</span> : null}
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <p className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
          <strong>Every quote request waits here.</strong> Nothing goes to a dealer until you release it. Correct anything on the quote sheet first if you need to — edits save without releasing. A rejection needs a reason; the buyer reads it and can fix and resubmit.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {(["pending", "decided"] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${tab === t ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-muted hover:text-white"}`}>
              {t === "pending" ? `Pending · ${pending?.length ?? "…"}` : `Decided (30 days) · ${decided.length}`}
            </button>
          ))}
        </div>

        {error ? <p className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</p> : null}
        {pending === null && !error ? <p className="text-xs text-ink-muted">Loading…</p> : null}
        {pending && shown.length === 0 ? <p className="text-xs text-ink-muted">{tab === "pending" ? "Nothing waiting. New requests appear here the moment a buyer submits." : "No decisions in the last 30 days."}</p> : null}

        <div className="space-y-3">
          {shown.map((r) => (
            <RequestCard
              key={r.id}
              rfq={r}
              busy={busy === r.id}
              notice={notice[r.id]}
              rejectReason={rejecting[r.id] || ""}
              onRejectReason={(v) => setRejecting((x) => ({ ...x, [r.id]: v }))}
              editing={Boolean(editing[r.id])}
              onToggleEdit={() => setEditing((x) => ({ ...x, [r.id]: !x[r.id] }))}
              onDecide={(d) => decide(r, d)}
              onChanged={(rfq, msg) => {
                replace(rfq);
                if (msg) setNotice((n) => ({ ...n, [rfq.id]: msg }));
              }}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

function RequestCard({
  rfq,
  busy,
  notice,
  rejectReason,
  onRejectReason,
  editing,
  onToggleEdit,
  onDecide,
  onChanged,
}: {
  rfq: AdminRfq;
  busy: boolean;
  notice?: string;
  rejectReason: string;
  onRejectReason: (v: string) => void;
  editing: boolean;
  onToggleEdit: () => void;
  onDecide: (d: "approved" | "rejected") => void;
  onChanged: (rfq: AdminRfq, msg?: string) => void;
}) {
  const isPending = rfq.approvalStatus === "pending";
  const previewable = rfq.invites.filter((i) => i.calculatorUrl);
  const [previewId, setPreviewId] = useState<string>("");
  const previewInvite = previewable.find((i) => String(i.id) === previewId) || previewable[0];
  const dealerPreviewUrl = previewInvite?.calculatorUrl ? `${previewInvite.calculatorUrl}&preview=1` : null;
  const closedByBuyer = rfq.status === "walked" || rfq.status === "picked";
  const decidedTone = rfq.approvalStatus === "approved" ? "bg-positive-500/15 text-positive-300" : rfq.approvalStatus === "rejected" ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300";
  return (
    <section id={`rfq-${rfq.id}`} className="rounded-2xl border border-border bg-surface p-4 space-y-3" data-testid="approval-rfq" data-approval={rfq.approvalStatus}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-black text-brand-400">{rfqDealNumber(rfq)}</span>
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">{rfqQuoteTypeLabel(rfq)}</span>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${decidedTone}`}>{rfq.approvalStatus === "pending" ? "Pending review" : rfq.approvalStatus === "approved" ? "Released" : "Rejected"}</span>
            {closedByBuyer ? <span className="rounded bg-zinc-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-300" data-testid="closed-badge">{rfq.status === "walked" ? "Buyer walked away" : "Buyer picked a quote"}</span> : null}
            <span className="text-[10px] text-ink-faint">submitted {relativeTime(rfq.createdAt)}{rfq.approvalDecidedAt ? ` · decided ${relativeTime(rfq.approvalDecidedAt)} by ${rfq.approvalDecidedBy || "admin"}` : ""}</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-white">{rfqVehicleSummary(rfq)}</p>
          <p className="text-[11px] text-ink-muted">
            VIN <span className="font-mono">{rfq.vin}</span> · buyer <span className="font-mono">{rfq.buyerUserId}</span> · rfq #{rfq.id} · {buildStateOf(rfq)}
          </p>
          <p className="text-[11px] text-ink-muted">
            Locks: {locksOf(rfq).join(" · ") || "—"} · trade-in {rfq.tradeInExpected === true ? "yes" : rfq.tradeInExpected === false ? "no" : "—"}
          </p>
          {rfq.buyerNote ? <p className="mt-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-ink-light">Buyer note: {rfq.buyerNote}</p> : null}
          {rfq.rejectionReason ? <p className="mt-1 text-[11px] text-rose-300">Reason given: {rfq.rejectionReason}</p> : null}
          {rfq.adminEdits && rfq.adminEdits.length > 0 ? (
            <p className="mt-1 text-[10px] text-sky-200/90">Corrections: {rfq.adminEdits.map((e) => `${e.summary} (${e.by || "admin"}, ${relativeTime(e.at)})`).join(" · ")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2">
          <Link href={`/rfq/${rfq.id}`} className="inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white">
            Buyer view
          </Link>
          {previewable.length > 1 ? (
            <select value={String(previewInvite?.id ?? "")} onChange={(e) => setPreviewId(e.target.value)} aria-label="Dealer to preview" className="max-w-[180px] rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] text-ink-light focus:border-emerald-500 focus:outline-none" data-testid="dealer-view-select">
              {previewable.map((i) => (
                <option key={i.id} value={String(i.id)}>{i.dealerName}</option>
              ))}
            </select>
          ) : null}
          {dealerPreviewUrl ? (
            <a href={dealerPreviewUrl} target="_blank" rel="noreferrer" title={`Read-only: what ${previewInvite?.dealerName || "the dealer"} sees. Not recorded as a dealer view.`} className="inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white" data-testid="dealer-view">
              Dealer view
            </a>
          ) : null}
        </div>
      </div>

      <ul className="divide-y divide-border/60 rounded-xl border border-border bg-background" data-testid="approval-dealers">
        {rfq.invites.length === 0 ? <li className="px-3 py-2 text-[11px] text-amber-300">No dealers on this request — add one before releasing.</li> : null}
        {rfq.invites.map((i) => {
          const routing = inviteRoutingLabel(i);
          return (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-white">{i.dealerName}</div>
                <div className={`text-[10px] ${routing.tone}`}>
                  {routing.label}
                  {i.dealerContactEmail ? <span className="font-mono text-ink-muted"> · {i.dealerContactEmail}</span> : null}
                  {i.sentAt ? <span className="text-ink-muted"> · sent {new Date(i.sentAt).toLocaleString()}</span> : null}
                </div>
              </div>
              {isPending && editing ? <RemoveDealer rfq={rfq} invite={i} onChanged={onChanged} /> : null}
            </li>
          );
        })}
      </ul>

      {isPending && editing ? <EditSheet rfq={rfq} onChanged={onChanged} onClose={onToggleEdit} /> : null}

      {isPending ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || rfq.invites.length === 0 || closedByBuyer} title={closedByBuyer ? "The buyer already closed this request — it can only be rejected." : undefined} onClick={() => onDecide("approved")} className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3.5 py-2 text-[11px] font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="approve">
              <Check className="h-3.5 w-3.5" /> Approve &amp; release
            </button>
            <button type="button" onClick={onToggleEdit} className="inline-flex items-center gap-1 rounded-lg border border-border px-3.5 py-2 text-[11px] font-bold text-ink-light hover:text-white" data-testid="edit">
              <Pencil className="h-3.5 w-3.5" /> {editing ? "Done editing" : "Edit quote sheet"}
            </button>
            <input value={rejectReason} onChange={(e) => onRejectReason(e.target.value)} placeholder={closedByBuyer ? "Reason (e.g. Buyer walked away)" : "Reason the buyer will read (required to reject)"} className="min-w-[260px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-ink-light placeholder-ink-faint focus:border-rose-500 focus:outline-none" data-testid="reject-reason" />
            <button type="button" disabled={busy || !rejectReason.trim()} onClick={() => onDecide("rejected")} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/60 px-3.5 py-2 text-[11px] font-bold text-rose-300 hover:bg-rose-950/40 disabled:opacity-50" data-testid="reject">
              <X className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
          {notice ? <p className="text-[11px] text-ink-light" data-testid="approval-notice">{notice}</p> : null}
        </div>
      ) : notice ? (
        <p className="text-[11px] text-ink-light" data-testid="approval-notice">{notice}</p>
      ) : null}
    </section>
  );
}

function RemoveDealer({ rfq, invite, onChanged }: { rfq: AdminRfq; invite: AdminRfqInvite; onChanged: (rfq: AdminRfq, msg?: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await fetch(`/api/admin/rfqs/${rfq.id}/invites/${invite.id}`, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        setBusy(false);
        if (res.ok) onChanged(json.rfq as AdminRfq, `Removed ${invite.dealerName}.`);
        else onChanged(rfq, json.error || "Could not remove the dealer.");
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-500/50 px-2.5 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
    >
      <Trash2 className="h-3 w-3" /> Remove
    </button>
  );
}

type DealerHit = { id: string; dealerName: string; city: string | null; state: string | null; email: string; emailOptOut: boolean };

export function EditSheet({ rfq, onChanged, onClose }: { rfq: AdminRfq; onChanged: (rfq: AdminRfq, msg?: string) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    vin: rfq.vin,
    vehicleYear: String(rfq.vehicleYear),
    vehicleMake: rfq.vehicleMake,
    vehicleModel: rfq.vehicleModel,
    vehicleTrim: rfq.vehicleTrim || "",
    buyerNote: rfq.buyerNote || "",
    tradeInExpected: rfq.tradeInExpected === true ? "yes" : rfq.tradeInExpected === false ? "no" : "",
    summary: "",
  });
  const stored = { leasePrefs: rfq.leasePrefs || null, quotePrefs: rfq.quotePrefs || null };
  const [prefs, setPrefs] = useState<PrefsForm>(() => prefsToForm(stored));
  const [showJson, setShowJson] = useState(false);
  const [dealer, setDealer] = useState({ dealerName: "", dealerState: "", providedEmail: "" });
  const [hits, setHits] = useState<DealerHit[]>([]);
  const [picked, setPicked] = useState<DealerHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setP = (k: keyof PrefsForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setPrefs((p) => ({ ...p, [k]: e.target.value }));
  const field = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-ink-light placeholder-ink-faint focus:border-brand-500 focus:outline-none";
  const label = "block space-y-1 text-[10px] font-bold text-ink-muted";

  const searchDealers = async (q: string) => {
    setDealer((d) => ({ ...d, dealerName: q }));
    setPicked(null);
    if (q.trim().length < 2) return setHits([]);
    try {
      const res = await fetch("/api/admin/dealer-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }) });
      const json = await res.json().catch(() => ({}));
      setHits(Array.isArray(json.matches) ? json.matches : []);
    } catch {
      setHits([]);
    }
  };
  const pickDealer = (h: DealerHit) => {
    setPicked(h);
    setHits([]);
    setErr(null);
    setDealer({ dealerName: h.dealerName, dealerState: h.state || "", providedEmail: h.email });
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const patch: Record<string, unknown> = {};
      const changed: string[] = [];
      const put = (key: string, value: unknown, labelText: string) => {
        patch[key] = value;
        changed.push(labelText);
      };
      if (form.vin.trim().toUpperCase() !== rfq.vin) put("vin", form.vin.trim().toUpperCase(), "VIN");
      if (Number(form.vehicleYear) !== rfq.vehicleYear) put("vehicleYear", Number(form.vehicleYear), "year");
      if (form.vehicleMake.trim() !== rfq.vehicleMake) put("vehicleMake", form.vehicleMake.trim(), "make");
      if (form.vehicleModel.trim() !== rfq.vehicleModel) put("vehicleModel", form.vehicleModel.trim(), "model");
      if (form.vehicleTrim.trim() !== (rfq.vehicleTrim || "")) put("vehicleTrim", form.vehicleTrim.trim(), "trim");
      if (form.buyerNote.trim() !== (rfq.buyerNote || "")) put("buyerNote", form.buyerNote.trim() || null, "buyer note");
      const trade = form.tradeInExpected === "yes" ? true : form.tradeInExpected === "no" ? false : null;
      if (trade !== (rfq.tradeInExpected ?? null)) put("tradeInExpected", trade, "trade-in");
      const pp = prefsPatch(prefs, stored);
      if (!pp.ok) {
        setErr(pp.errors.join(" "));
        return;
      }
      if (Object.keys(pp.patch).length) {
        Object.assign(patch, pp.patch);
        changed.push("quote preferences");
      }
      if (Object.keys(patch).length === 0) {
        setNote("Nothing was saved — no field differs from what's already on the quote sheet.");
        return;
      }
      const res = await fetch(`/api/admin/rfqs/${rfq.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...patch, summary: form.summary.trim() || undefined }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save.");
      onChanged(json.rfq as AdminRfq, `Saved ${changed.join(", ")}. Not released to dealers yet.`);
      setForm((f) => ({ ...f, summary: "" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const addDealer = async () => {
    setErr(null);
    setNote(null);
    const missing: string[] = [];
    if (!dealer.dealerName.trim()) missing.push("dealer name");
    if (!/^[A-Za-z]{2}$/.test(dealer.dealerState.trim())) missing.push("2-letter state");
    if (missing.length) return setErr(`Add dealer needs a ${missing.join(" and a ")}.`);
    const email = dealer.providedEmail.trim();
    if (email && !/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email)) return setErr("That email address doesn't look valid.");
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/rfqs/${rfq.id}/invites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dealer) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add the dealer.");
      onChanged(json.rfq as AdminRfq, `Added ${dealer.dealerName.trim()} (${json.routing}).`);
      setDealer({ dealerName: "", dealerState: "", providedEmail: "" });
      setPicked(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the dealer.");
    } finally {
      setBusy(false);
    }
  };

  const isLease = prefs.type === "lease";
  const isFinance = prefs.type === "finance";
  return (
    <div className="space-y-3 rounded-xl border border-sky-500/40 bg-sky-950/20 p-3" data-testid="edit-sheet">
      <p className="text-[11px] font-bold text-sky-200">Correct the quote sheet — saves without releasing. The buyer sees your summary as &quot;Corrected by TrimScout&quot;.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input value={form.vin} onChange={set("vin")} placeholder="VIN" className={`${field} font-mono uppercase sm:col-span-2`} maxLength={17} />
        <input value={form.vehicleYear} onChange={set("vehicleYear")} placeholder="Year" className={field} />
        <input value={form.vehicleMake} onChange={set("vehicleMake")} placeholder="Make" className={field} />
        <input value={form.vehicleModel} onChange={set("vehicleModel")} placeholder="Model" className={field} />
        <input value={form.vehicleTrim} onChange={set("vehicleTrim")} placeholder="Trim" className={`${field} sm:col-span-2`} />
        <select value={form.tradeInExpected} onChange={set("tradeInExpected")} className={field}>
          <option value="">Trade-in: —</option>
          <option value="yes">Trade-in: yes</option>
          <option value="no">Trade-in: no</option>
        </select>
        <textarea value={form.buyerNote} onChange={set("buyerNote")} placeholder="Buyer note to dealers" rows={2} className={`${field} sm:col-span-5`} />
      </div>
      <fieldset className="space-y-2 rounded-lg border border-border/60 p-2" data-testid="prefs-fields">
        <legend className="px-1 text-[10px] font-black uppercase tracking-wide text-ink-muted">Quote preferences</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <label className={label}>
            Quote type
            <select value={prefs.type} onChange={setP("type")} className={field} data-testid="quote-type">
              <option value="">None</option>
              {EDITOR_QUOTE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          {prefs.type ? (
            <>
              <label className={label}>
                ZIP
                <input value={prefs.zip} onChange={setP("zip")} inputMode="numeric" maxLength={5} placeholder="07836" className={field} />
              </label>
              <label className={label}>
                Timeline
                <select value={prefs.timeline} onChange={setP("timeline")} className={field}>
                  {EDITOR_TIMELINES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {isLease || isFinance ? (
            <label className={label}>
              Term
              <select value={prefs.termMonths} onChange={setP("termMonths")} className={field}>
                <option value="">Pick…</option>
                {(isLease ? LEASE_TERMS : FINANCE_TERMS).map((t) => (
                  <option key={t} value={t}>{t} months</option>
                ))}
              </select>
            </label>
          ) : null}
          {isLease ? (
            <label className={label}>
              Miles per year
              <select value={prefs.milesPerYear} onChange={setP("milesPerYear")} className={field}>
                <option value="">Pick…</option>
                {LEASE_MILES.map((m) => (
                  <option key={m} value={m}>{m.toLocaleString("en-US")}</option>
                ))}
              </select>
            </label>
          ) : null}
          {isFinance ? (
            <label className={label}>
              Down payment ($)
              <input value={prefs.downPayment} onChange={setP("downPayment")} inputMode="numeric" placeholder="0" className={field} />
            </label>
          ) : null}
          {isLease || isFinance ? (
            <label className={label}>
              Credit band
              <select value={prefs.creditBand} onChange={setP("creditBand")} className={field}>
                <option value="">{isLease ? "Not set" : "Pick…"}</option>
                {CREDIT_BANDS.map((b) => (
                  <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>
                ))}
              </select>
            </label>
          ) : null}
          {isLease ? (
            <label className={`${label} sm:col-span-2`}>
              Due at signing
              <select value={prefs.dueAtSigningIntent} onChange={setP("dueAtSigningIntent")} className={field}>
                <option value="">Not set</option>
                <option value="first_month_only">First month + fees only</option>
                <option value="cash_down">Putting money down</option>
              </select>
            </label>
          ) : null}
        </div>
        <button type="button" onClick={() => setShowJson((v) => !v)} className="text-[10px] font-bold text-ink-muted hover:text-white" data-testid="advanced-toggle">
          {showJson ? "Hide advanced" : "Advanced"}
        </button>
        {showJson ? (
          <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-background p-2 font-mono text-[10px] text-ink-muted" data-testid="advanced-json">{JSON.stringify(stored.leasePrefs || stored.quotePrefs || null, null, 2)}</pre>
        ) : null}
      </fieldset>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input value={form.summary} onChange={set("summary")} placeholder="Summary the buyer will see (e.g. 'trim corrected to XLE')" className={`${field} sm:col-span-4`} />
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-sky-400 px-3 py-1.5 text-[11px] font-black text-black hover:bg-sky-300 disabled:opacity-50" data-testid="save-edit">
          Save correction
        </button>
      </div>
      <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="add-dealer-row">
        <div className="relative sm:col-span-2">
          <input value={dealer.dealerName} onChange={(e) => searchDealers(e.target.value)} placeholder="Add dealer — search the directory" className={field} autoComplete="off" data-testid="dealer-name" />
          {hits.length ? (
            <ul className="absolute left-0 right-0 z-10 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-background shadow-lg" data-testid="dealer-hits">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => pickDealer(h)} className="block w-full px-2.5 py-1.5 text-left text-[11px] text-ink-light hover:bg-sky-950/60">
                    <span className="font-bold">{h.dealerName}</span>
                    <span className="text-ink-muted"> · {[h.city, h.state].filter(Boolean).join(", ")}{h.emailOptOut ? " · opted out" : h.email ? "" : " · no email on file"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <input value={dealer.dealerState} onChange={(e) => setDealer((d) => ({ ...d, dealerState: e.target.value.toUpperCase() }))} placeholder="State" className={field} maxLength={2} data-testid="dealer-state" />
        <input value={dealer.providedEmail} onChange={(e) => setDealer((d) => ({ ...d, providedEmail: e.target.value }))} placeholder={picked && !picked.email ? "No email on file — add one" : "Sales email"} className={field} data-testid="dealer-email" />
        <button type="button" onClick={addDealer} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="add-dealer">
          Add dealer
        </button>
      </div>
      {err ? <p className="text-[11px] text-rose-300" data-testid="edit-error">{err}</p> : null}
      {note ? <p className="text-[11px] text-amber-200" data-testid="edit-note">{note}</p> : null}
      <button type="button" onClick={onClose} className="text-[11px] font-bold text-ink-muted hover:text-white">Close editor</button>
    </div>
  );
}
