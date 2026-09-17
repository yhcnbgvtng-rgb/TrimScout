"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import type { AdminRfq, AdminRfqInvite } from "../../api/admin/rfqs/route";
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
  if (i.desk?.source === "buyer") return { label: "Adviser (buyer-added)", tone: "text-emerald-300" };
  if (i.desk?.source === "rooftop") return i.dealerContactEmail ? { label: "Dealership sales desk", tone: "text-sky-300" } : { label: "Unassigned — no address on file; ops routes by hand", tone: "text-amber-300" };
  if (i.desk?.contactName) return { label: `Named contact · ${i.desk.contactName}${i.desk.role ? ` (${(DESK_ROLE_LABELS as Record<string, string>)[i.desk.role] || i.desk.role})` : ""}`, tone: "text-emerald-300" };
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
      setNotice((n) => ({ ...n, [rfq.id]: decision === "approved" ? `Released — sent ${released?.sent ?? 0}, unassigned ${released?.no_desk ?? 0}, parked ${released?.parked_switch_off ?? 0}, failed ${released?.failed ?? 0}` : "Rejected — the buyer sees your reason in their tracker." }));
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
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${tab === t ? "border-emerald-500 bg-emerald-500/10 text-white" : "border-border text-ink-muted hover:text-white"}`}>
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
  const decidedTone = rfq.approvalStatus === "approved" ? "bg-emerald-500/15 text-emerald-300" : rfq.approvalStatus === "rejected" ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300";
  return (
    <section id={`rfq-${rfq.id}`} className="rounded-2xl border border-border bg-surface p-4 space-y-3" data-testid="approval-rfq" data-approval={rfq.approvalStatus}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-black text-emerald-400">{rfqDealNumber(rfq)}</span>
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">{rfqQuoteTypeLabel(rfq)}</span>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${decidedTone}`}>{rfq.approvalStatus === "pending" ? "Pending review" : rfq.approvalStatus === "approved" ? "Released" : "Rejected"}</span>
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
        <Link href={`/rfq/${rfq.id}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white">
          Buyer view
        </Link>
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
            <button type="button" disabled={busy || rfq.invites.length === 0} onClick={() => onDecide("approved")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3.5 py-2 text-[11px] font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50" data-testid="approve">
              <Check className="h-3.5 w-3.5" /> Approve &amp; release
            </button>
            <button type="button" onClick={onToggleEdit} className="inline-flex items-center gap-1 rounded-lg border border-border px-3.5 py-2 text-[11px] font-bold text-ink-light hover:text-white" data-testid="edit">
              <Pencil className="h-3.5 w-3.5" /> {editing ? "Done editing" : "Edit quote sheet"}
            </button>
            <input value={rejectReason} onChange={(e) => onRejectReason(e.target.value)} placeholder="Reason the buyer will read (required to reject)" className="min-w-[260px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-ink-light placeholder-ink-faint focus:border-rose-500 focus:outline-none" data-testid="reject-reason" />
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

function EditSheet({ rfq, onChanged, onClose }: { rfq: AdminRfq; onChanged: (rfq: AdminRfq, msg?: string) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    vin: rfq.vin,
    vehicleYear: String(rfq.vehicleYear),
    vehicleMake: rfq.vehicleMake,
    vehicleModel: rfq.vehicleModel,
    vehicleTrim: rfq.vehicleTrim || "",
    buyerNote: rfq.buyerNote || "",
    tradeInExpected: rfq.tradeInExpected === true ? "yes" : rfq.tradeInExpected === false ? "no" : "",
    prefs: JSON.stringify(rfq.leasePrefs || rfq.quotePrefs || null, null, 2),
    summary: "",
  });
  const [dealer, setDealer] = useState({ dealerName: "", dealerState: "", providedEmail: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const field = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none";

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const patch: Record<string, unknown> = {};
      if (form.vin.trim().toUpperCase() !== rfq.vin) patch.vin = form.vin.trim().toUpperCase();
      if (Number(form.vehicleYear) !== rfq.vehicleYear) patch.vehicleYear = Number(form.vehicleYear);
      if (form.vehicleMake.trim() !== rfq.vehicleMake) patch.vehicleMake = form.vehicleMake.trim();
      if (form.vehicleModel.trim() !== rfq.vehicleModel) patch.vehicleModel = form.vehicleModel.trim();
      if (form.vehicleTrim.trim() !== (rfq.vehicleTrim || "")) patch.vehicleTrim = form.vehicleTrim.trim();
      if (form.buyerNote.trim() !== (rfq.buyerNote || "")) patch.buyerNote = form.buyerNote.trim() || null;
      const trade = form.tradeInExpected === "yes" ? true : form.tradeInExpected === "no" ? false : null;
      if (trade !== (rfq.tradeInExpected ?? null)) patch.tradeInExpected = trade;
      const prefsRaw = form.prefs.trim();
      const original = JSON.stringify(rfq.leasePrefs || rfq.quotePrefs || null, null, 2);
      if (prefsRaw !== original) {
        const parsed = prefsRaw ? JSON.parse(prefsRaw) : null;
        if (rfq.leasePrefs) patch.leasePrefs = parsed;
        else patch.quotePrefs = parsed;
      }
      if (Object.keys(patch).length === 0) {
        setErr("Nothing changed.");
        return;
      }
      const res = await fetch(`/api/admin/rfqs/${rfq.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...patch, summary: form.summary.trim() || undefined }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save.");
      onChanged(json.rfq as AdminRfq, "Correction saved — not released yet.");
      setForm((f) => ({ ...f, summary: "" }));
    } catch (e) {
      setErr(e instanceof Error ? (e.name === "SyntaxError" ? "Locks must be valid JSON." : e.message) : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const addDealer = async () => {
    if (!dealer.dealerName.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/rfqs/${rfq.id}/invites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dealer) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add the dealer.");
      onChanged(json.rfq as AdminRfq, `Added ${dealer.dealerName.trim()} (${json.routing}).`);
      setDealer({ dealerName: "", dealerState: "", providedEmail: "" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the dealer.");
    } finally {
      setBusy(false);
    }
  };

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
        <textarea value={form.prefs} onChange={set("prefs")} placeholder="Quote locks (JSON)" rows={5} className={`${field} font-mono sm:col-span-5`} />
        <input value={form.summary} onChange={set("summary")} placeholder="Summary the buyer will see (e.g. 'trim corrected to XLE')" className={`${field} sm:col-span-4`} />
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-sky-400 px-3 py-1.5 text-[11px] font-black text-black hover:bg-sky-300 disabled:opacity-50" data-testid="save-edit">
          Save correction
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input value={dealer.dealerName} onChange={(e) => setDealer((d) => ({ ...d, dealerName: e.target.value }))} placeholder="Add dealer — name (as in the directory)" className={`${field} sm:col-span-2`} />
        <input value={dealer.dealerState} onChange={(e) => setDealer((d) => ({ ...d, dealerState: e.target.value }))} placeholder="State" className={field} maxLength={2} />
        <input value={dealer.providedEmail} onChange={(e) => setDealer((d) => ({ ...d, providedEmail: e.target.value }))} placeholder="Sales adviser email (optional)" className={field} />
        <button type="button" onClick={addDealer} disabled={busy || !dealer.dealerName.trim()} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="add-dealer">
          Add dealer
        </button>
      </div>
      {err ? <p className="text-[11px] text-rose-300">{err}</p> : null}
      <button type="button" onClick={onClose} className="text-[11px] font-bold text-ink-muted hover:text-white">Close editor</button>
    </div>
  );
}
