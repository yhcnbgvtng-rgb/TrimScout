"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calculator, ChevronDown, ChevronUp, ExternalLink, Plus, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import type { AdminRfq } from "../../api/admin/rfqs/route";
import { DESK_ROLE_LABELS, inviteStage } from "../../../lib/quotePackage";
import {
  pendingApprovalInvites,
  relativeTime,
  rfqDealNumber,
  rfqNeedsApproval,
  rfqQuoteTypeLabel,
  rfqTrackerStatus,
  rfqTrackerStatusLabel,
  rfqVehicleSummary,
  rfqVehicles,
} from "../../../lib/rfqTracker";
import { dueAtSigningTotal, LEASE_MILES, LEASE_TERMS, type LeaseMiles, type LeaseTerm } from "../../../lib/leaseQuote";
import { RFQ_DECLINE_REASON_LABELS, type RfqDeclineReason } from "../../../lib/rfq";

/**
 * The master desk: every quote request, every buyer, every invited dealer —
 * plus, per invite, the dealer's own calculator page so an admin can reply
 * as that desk. Opening a calculator is a real dealer view (marks viewed,
 * locks the buyer's lease sheet), so each button says so.
 *
 * The admin approval checkpoint lives here too: every invite an admin
 * hasn't approved yet sits "queued" — nothing has reached a dealer. An
 * admin reviews the request (vehicles, lease/quote prefs, which desks),
 * can edit the dealer list or the lease terms, then approves (sends the
 * still-queued invites) or rejects them one at a time.
 */
type Filter = "all" | "pending" | "awaiting" | "quotes_in" | "closed";

const VALID_DECLINE_REASONS: RfqDeclineReason[] = ["soft_lead", "wrong_car", "options_mismatch", "other"];

interface LeaseEditState {
  termMonths: string;
  milesPerYear: string;
  zip: string;
  timeline: string;
}

interface AddDealerState {
  dealerName: string;
  dealerState: string;
  dealerContactEmail: string;
}

export default function QuoteRequestsClient() {
  const [rfqs, setRfqs] = useState<AdminRfq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  // Per-RFQ UI state for the approval checkpoint. Keyed by rfq.id; cleared
  // for a request once an action against it succeeds and the list reloads.
  const [checkedInvites, setCheckedInvites] = useState<Record<string, Set<string>>>({});
  const [declineReasonByInvite, setDeclineReasonByInvite] = useState<Record<string, RfqDeclineReason>>({});
  const [busyRfq, setBusyRfq] = useState<Record<string, boolean>>({});
  const [busyInvite, setBusyInvite] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});
  const [leaseEditOpen, setLeaseEditOpen] = useState<Record<string, boolean>>({});
  const [leaseEdits, setLeaseEdits] = useState<Record<string, LeaseEditState>>({});
  const [addDealerOpen, setAddDealerOpen] = useState<Record<string, boolean>>({});
  const [addDealerForm, setAddDealerForm] = useState<Record<string, AddDealerState>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rfqs?limit=300");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load quote requests.");
      setRfqs(json.rfqs as AdminRfq[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load quote requests.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rfqs || []).filter((r) => {
      const st = rfqTrackerStatus(r as never);
      if (filter === "pending" && !rfqNeedsApproval(r)) return false;
      if (filter === "awaiting" && st !== "awaiting") return false;
      if (filter === "quotes_in" && st !== "quotes_in") return false;
      if (filter === "closed" && !st.startsWith("closed")) return false;
      if (!needle) return true;
      const hay = [rfqDealNumber(r), r.buyerUserId, r.vin, rfqVehicleSummary(r), ...r.invites.map((i) => `${i.dealerName} ${i.desk?.contactName || ""} ${i.dealerContactEmail || ""}`)].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [rfqs, filter, q]);

  const counts = useMemo(() => {
    const c = { all: 0, pending: 0, awaiting: 0, quotes_in: 0, closed: 0 };
    for (const r of rfqs || []) {
      c.all++;
      if (rfqNeedsApproval(r)) c.pending++;
      const st = rfqTrackerStatus(r as never);
      if (st === "awaiting") c.awaiting++;
      else if (st === "quotes_in") c.quotes_in++;
      else c.closed++;
    }
    return c;
  }, [rfqs]);

  const checkedFor = (rfq: AdminRfq): Set<string> => {
    const existing = checkedInvites[rfq.id];
    if (existing) return existing;
    return new Set(pendingApprovalInvites(rfq).map((i) => i.id));
  };
  const toggleChecked = (rfq: AdminRfq, inviteId: string) => {
    const next = new Set(checkedFor(rfq));
    if (next.has(inviteId)) next.delete(inviteId);
    else next.add(inviteId);
    setCheckedInvites((prev) => ({ ...prev, [rfq.id]: next }));
  };

  const clearRfqUiState = (rfqId: string) => {
    setCheckedInvites((prev) => { const n = { ...prev }; delete n[rfqId]; return n; });
    setAddDealerOpen((prev) => ({ ...prev, [rfqId]: false }));
    setLeaseEditOpen((prev) => ({ ...prev, [rfqId]: false }));
  };

  const approve = async (rfq: AdminRfq) => {
    const inviteIds = Array.from(checkedFor(rfq));
    if (inviteIds.length === 0) return;
    setBusyRfq((prev) => ({ ...prev, [rfq.id]: true }));
    setActionError((prev) => ({ ...prev, [rfq.id]: "" }));
    try {
      const res = await fetch(`/api/admin/rfqs/${rfq.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not approve this request.");
      const failed = (json.results || []).filter((r: { sent: boolean }) => !r.sent);
      if (failed.length > 0) {
        setActionError((prev) => ({ ...prev, [rfq.id]: `${failed.length} of ${inviteIds.length} could not be sent: ${failed.map((f: { error?: string }) => f.error).filter(Boolean).join("; ")}` }));
      }
      clearRfqUiState(rfq.id);
      await load();
    } catch (e) {
      setActionError((prev) => ({ ...prev, [rfq.id]: e instanceof Error ? e.message : "Could not approve this request." }));
    } finally {
      setBusyRfq((prev) => ({ ...prev, [rfq.id]: false }));
    }
  };

  const reject = async (rfq: AdminRfq, inviteId: string) => {
    const reason = declineReasonByInvite[inviteId] || "other";
    setBusyInvite((prev) => ({ ...prev, [inviteId]: true }));
    setActionError((prev) => ({ ...prev, [rfq.id]: "" }));
    try {
      const res = await fetch(`/api/admin/rfqs/${rfq.id}/invites/${inviteId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declineReason: reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not reject this invite.");
      await load();
    } catch (e) {
      setActionError((prev) => ({ ...prev, [rfq.id]: e instanceof Error ? e.message : "Could not reject this invite." }));
    } finally {
      setBusyInvite((prev) => ({ ...prev, [inviteId]: false }));
    }
  };

  const openLeaseEdit = (rfq: AdminRfq) => {
    if (!rfq.leasePrefs) return;
    setLeaseEdits((prev) => ({
      ...prev,
      [rfq.id]: {
        termMonths: String(rfq.leasePrefs!.termMonths),
        milesPerYear: String(rfq.leasePrefs!.milesPerYear),
        zip: rfq.leasePrefs!.zip || "",
        timeline: rfq.leasePrefs!.timeline || "",
      },
    }));
    setLeaseEditOpen((prev) => ({ ...prev, [rfq.id]: true }));
  };

  const saveLeasePrefs = async (rfq: AdminRfq) => {
    const edit = leaseEdits[rfq.id];
    if (!edit) return;
    setBusyRfq((prev) => ({ ...prev, [rfq.id]: true }));
    setActionError((prev) => ({ ...prev, [rfq.id]: "" }));
    try {
      const res = await fetch(`/api/admin/rfqs/${rfq.id}/lease-prefs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leasePrefs: {
            termMonths: Number(edit.termMonths),
            milesPerYear: Number(edit.milesPerYear),
            zip: edit.zip,
            timeline: edit.timeline || null,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save these lease terms.");
      setLeaseEditOpen((prev) => ({ ...prev, [rfq.id]: false }));
      await load();
    } catch (e) {
      setActionError((prev) => ({ ...prev, [rfq.id]: e instanceof Error ? e.message : "Could not save these lease terms." }));
    } finally {
      setBusyRfq((prev) => ({ ...prev, [rfq.id]: false }));
    }
  };

  const addDealer = async (rfq: AdminRfq) => {
    const form = addDealerForm[rfq.id];
    if (!form?.dealerName.trim()) return;
    setBusyRfq((prev) => ({ ...prev, [rfq.id]: true }));
    setActionError((prev) => ({ ...prev, [rfq.id]: "" }));
    try {
      const res = await fetch(`/api/admin/rfqs/${rfq.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerName: form.dealerName.trim(),
          dealerState: form.dealerState.trim(),
          dealerContactEmail: form.dealerContactEmail.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add this dealer.");
      setAddDealerOpen((prev) => ({ ...prev, [rfq.id]: false }));
      setAddDealerForm((prev) => ({ ...prev, [rfq.id]: { dealerName: "", dealerState: "", dealerContactEmail: "" } }));
      clearRfqUiState(rfq.id);
      await load();
    } catch (e) {
      setActionError((prev) => ({ ...prev, [rfq.id]: e instanceof Error ? e.message : "Could not add this dealer." }));
    } finally {
      setBusyRfq((prev) => ({ ...prev, [rfq.id]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="inline-flex items-center gap-1 text-xs font-bold text-ink-muted hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> Admin
            </Link>
            <h1 className="text-sm font-black text-white">All quote requests</h1>
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <p className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
          <strong>Master desk.</strong> Every buyer&apos;s request and every invited dealer. An invite sits <strong>queued</strong> until it&apos;s approved here — nothing reaches a dealer contact before that. <em>Quote as dealer</em> opens that desk&apos;s own calculator page — a real dealer view: it marks the invite viewed and locks the buyer&apos;s lease sheet, exactly as if the dealer had opened their email.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {(["pending", "all", "awaiting", "quotes_in", "closed"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${filter === f ? "border-emerald-500 bg-emerald-500/10 text-white" : "border-border text-ink-muted hover:text-white"}`}
            >
              {f === "all" ? "All" : f === "pending" ? "Pending approval" : f === "awaiting" ? "Awaiting quotes" : f === "quotes_in" ? "Quotes in" : "Closed"} · {counts[f]}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] text-ink-muted">
            <Search className="h-3.5 w-3.5" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Deal #, buyer, VIN, dealer, contact…" className="w-64 bg-transparent text-white placeholder-ink-faint focus:outline-none" />
          </label>
        </div>

        {error ? <p className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</p> : null}
        {rfqs === null && !error ? <p className="text-xs text-ink-muted">Loading…</p> : null}
        {rfqs && shown.length === 0 ? <p className="text-xs text-ink-muted">Nothing matches.</p> : null}

        <div className="space-y-3">
          {shown.map((r) => {
            const st = rfqTrackerStatus(r as never);
            const tone = st === "quotes_in" ? "bg-emerald-500/15 text-emerald-300" : st === "awaiting" ? "bg-amber-500/15 text-amber-300" : "bg-border text-ink-muted";
            const pending = pendingApprovalInvites(r);
            const checked = checkedFor(r);
            const rfqError = actionError[r.id];
            const detailOpen = detailsOpen[r.id] ?? false;
            const vehicles = rfqVehicles(r);
            return (
              <section key={r.id} className="rounded-2xl border border-border bg-surface p-4 space-y-3" data-testid="admin-rfq">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-black text-emerald-400">{rfqDealNumber(r)}</span>
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">{rfqQuoteTypeLabel(r)}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone}`}>{rfqTrackerStatusLabel(r as never)}</span>
                      {pending.length > 0 ? (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                          {pending.length} pending approval
                        </span>
                      ) : null}
                      {r.leaseSheetLockedAt ? <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-muted">Sheet locked</span> : null}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-white">{rfqVehicleSummary(r)}</p>
                    <p className="text-[11px] text-ink-muted">
                      buyer <span className="font-mono">{r.buyerUserId}</span> · VIN <span className="font-mono">{r.vin}</span> · {relativeTime(r.createdAt)} · rfq #{r.id}
                      {r.leasePrefs ? ` · ${r.leasePrefs.termMonths} mo · ${r.leasePrefs.milesPerYear.toLocaleString()} mi/yr${r.leasePrefs.zip ? ` · ZIP ${r.leasePrefs.zip}` : ""}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailsOpen((prev) => ({ ...prev, [r.id]: !detailOpen }))}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white"
                    >
                      Details {detailOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                    <Link href={`/rfq/${r.id}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white">
                      Buyer view <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>

                {detailOpen ? (
                  <div className="space-y-2 rounded-xl border border-border bg-background p-3 text-[11px] text-ink-muted">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Vehicles</span>
                      <ul className="mt-1 space-y-0.5">
                        {vehicles.map((v) => (
                          <li key={v.vin}>
                            {[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")} <span className="font-mono">{v.vin}</span>
                            {v.dealerName ? ` · ${v.dealerName}${v.dealerState ? `, ${v.dealerState}` : ""}` : ""}
                            {v.condition !== "new" ? ` · ${v.condition.toUpperCase()}` : ""}
                            {v.factoryVerified ? " · factory verified" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {r.quotePrefs ? (
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{r.quotePrefs.quoteType === "finance" ? "Finance" : "Cash"} locks</span>
                        <p className="mt-1">
                          {r.quotePrefs.quoteType === "finance"
                            ? `${r.quotePrefs.finance.termMonths} mo · $${r.quotePrefs.finance.downPayment.toLocaleString()} down · credit ${r.quotePrefs.finance.creditBand} · ZIP ${r.quotePrefs.finance.zip}`
                            : `ZIP ${r.quotePrefs.cash.zip}`}
                          {(r.quotePrefs.quoteType === "finance" ? r.quotePrefs.finance.timeline : r.quotePrefs.cash.timeline) ? ` · ${r.quotePrefs.quoteType === "finance" ? r.quotePrefs.finance.timeline : r.quotePrefs.cash.timeline}` : ""}
                        </p>
                      </div>
                    ) : null}
                    {r.buyerNote ? (
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Buyer note</span>
                        <p className="mt-1 italic">&ldquo;{r.buyerNote}&rdquo;</p>
                      </div>
                    ) : null}
                    <p className="text-ink-faint">
                      Vehicle details (VIN/year/make/model/trim) and finance/cash locks can&apos;t be edited here yet — the box has no update endpoint for them after the request is created.
                    </p>
                  </div>
                ) : null}

                {r.leasePrefs ? (
                  <div className="rounded-xl border border-border bg-background p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Lease terms</span>
                      {!leaseEditOpen[r.id] ? (
                        <button
                          type="button"
                          disabled={Boolean(r.leaseSheetLockedAt) || r.status !== "collecting"}
                          onClick={() => openLeaseEdit(r)}
                          className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 disabled:cursor-not-allowed disabled:text-ink-faint"
                          title={r.leaseSheetLockedAt ? "Locked — a dealer has already viewed this request." : undefined}
                        >
                          Edit
                        </button>
                      ) : (
                        <button type="button" onClick={() => setLeaseEditOpen((prev) => ({ ...prev, [r.id]: false }))} className="text-[11px] font-bold text-ink-muted hover:text-white">
                          Cancel
                        </button>
                      )}
                    </div>
                    {leaseEditOpen[r.id] ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <label className="space-y-1">
                          <span className="text-[9px] font-bold uppercase text-ink-faint">Term</span>
                          <select
                            value={leaseEdits[r.id]?.termMonths || ""}
                            onChange={(e) => setLeaseEdits((prev) => ({ ...prev, [r.id]: { ...prev[r.id], termMonths: e.target.value } }))}
                            className="w-full rounded-lg border border-border bg-surface py-1.5 px-2 text-xs text-white"
                          >
                            {LEASE_TERMS.map((t: LeaseTerm) => (
                              <option key={t} value={t}>{t} mo</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[9px] font-bold uppercase text-ink-faint">Miles/yr</span>
                          <select
                            value={leaseEdits[r.id]?.milesPerYear || ""}
                            onChange={(e) => setLeaseEdits((prev) => ({ ...prev, [r.id]: { ...prev[r.id], milesPerYear: e.target.value } }))}
                            className="w-full rounded-lg border border-border bg-surface py-1.5 px-2 text-xs text-white"
                          >
                            {LEASE_MILES.map((m: LeaseMiles) => (
                              <option key={m} value={m}>{m.toLocaleString()}</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[9px] font-bold uppercase text-ink-faint">ZIP</span>
                          <input
                            value={leaseEdits[r.id]?.zip || ""}
                            onChange={(e) => setLeaseEdits((prev) => ({ ...prev, [r.id]: { ...prev[r.id], zip: e.target.value.replace(/\D/g, "").slice(0, 5) } }))}
                            className="w-full rounded-lg border border-border bg-surface py-1.5 px-2 text-xs text-white"
                          />
                        </label>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => saveLeasePrefs(r)}
                            disabled={Boolean(busyRfq[r.id])}
                            className="w-full rounded-lg bg-emerald-500 py-1.5 text-[11px] font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <ul className="divide-y divide-border/60 rounded-xl border border-border bg-background">
                  {r.invites.length === 0 ? <li className="px-3 py-2 text-[11px] text-ink-faint">No dealers invited.</li> : null}
                  {r.invites.map((i) => {
                    const stage = inviteStage(i as never);
                    const lease = i.quote?.lease;
                    const needsApproval = stage === "queued";
                    return (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div className="flex min-w-0 items-start gap-2">
                          {needsApproval ? (
                            <input
                              type="checkbox"
                              checked={checked.has(i.id)}
                              onChange={() => toggleChecked(r, i.id)}
                              className="mt-1 h-3.5 w-3.5 rounded border-border"
                              aria-label={`Send to ${i.dealerName} on approval`}
                            />
                          ) : null}
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold text-white">
                              {i.dealerName}
                              <span className={`ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${needsApproval ? "bg-amber-500/15 text-amber-300" : "bg-border text-ink-muted"}`}>{stage}</span>
                            </div>
                            <div className="text-[10px] text-ink-muted">
                              {i.desk?.contactName || "—"}
                              {i.desk?.role ? ` · ${(DESK_ROLE_LABELS as Record<string, string>)[i.desk.role] || i.desk.role}` : ""}
                              {i.dealerContactEmail ? <span className="font-mono"> · {i.dealerContactEmail}</span> : null}
                              {i.viewedAt ? ` · viewed ${new Date(i.viewedAt).toLocaleString()}` : i.sentAt ? ` · sent ${new Date(i.sentAt).toLocaleString()}` : ""}
                            </div>
                            {lease ? (
                              <div className="text-[10px] text-emerald-300">
                                Quoted ${lease.monthlyPaymentPreTax.toLocaleString()}/mo · DAS ${dueAtSigningTotal(lease.dueAtSigning).toLocaleString()} · {lease.termMonths} mo / {lease.milesPerYear.toLocaleString()} mi
                                {lease.counter?.counterOffer ? " · counter" : ""}
                              </div>
                            ) : i.quote ? (
                              <div className="text-[10px] text-emerald-300">Quoted ${i.quote.price.toLocaleString()}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {needsApproval ? (
                            <>
                              <select
                                value={declineReasonByInvite[i.id] || "other"}
                                onChange={(e) => setDeclineReasonByInvite((prev) => ({ ...prev, [i.id]: e.target.value as RfqDeclineReason }))}
                                className="rounded-lg border border-border bg-surface py-1.5 px-2 text-[10px] text-ink-light"
                              >
                                {VALID_DECLINE_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>{RFQ_DECLINE_REASON_LABELS[reason]}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => reject(r, i.id)}
                                disabled={Boolean(busyInvite[i.id])}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2.5 py-1.5 text-[11px] font-bold text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                              >
                                <X className="h-3 w-3" /> Reject
                              </button>
                            </>
                          ) : null}
                          {i.calculatorUrl && i.status === "invited" ? (
                            <a
                              href={i.calculatorUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="Opens this desk's calculator page. Counts as a dealer view: marks the invite viewed and locks the buyer's lease sheet."
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-emerald-400"
                            >
                              <Calculator className="h-3.5 w-3.5" /> Quote as dealer
                            </a>
                          ) : i.calculatorUrl ? (
                            <a href={i.calculatorUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white">
                              Dealer page <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {addDealerOpen[r.id] ? (
                  <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-background p-3">
                    <label className="space-y-1">
                      <span className="text-[9px] font-bold uppercase text-ink-faint">Dealer name</span>
                      <input
                        value={addDealerForm[r.id]?.dealerName || ""}
                        onChange={(e) => setAddDealerForm((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || { dealerName: "", dealerState: "", dealerContactEmail: "" }), dealerName: e.target.value } }))}
                        className="w-56 rounded-lg border border-border bg-surface py-1.5 px-2 text-xs text-white"
                        placeholder="e.g. Bachrodt BMW"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[9px] font-bold uppercase text-ink-faint">State</span>
                      <input
                        value={addDealerForm[r.id]?.dealerState || ""}
                        onChange={(e) => setAddDealerForm((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || { dealerName: "", dealerState: "", dealerContactEmail: "" }), dealerState: e.target.value.toUpperCase().slice(0, 2) } }))}
                        className="w-16 rounded-lg border border-border bg-surface py-1.5 px-2 text-xs text-white"
                        placeholder="NJ"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[9px] font-bold uppercase text-ink-faint">Contact email (only if not in the directory)</span>
                      <input
                        value={addDealerForm[r.id]?.dealerContactEmail || ""}
                        onChange={(e) => setAddDealerForm((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || { dealerName: "", dealerState: "", dealerContactEmail: "" }), dealerContactEmail: e.target.value } }))}
                        className="w-56 rounded-lg border border-border bg-surface py-1.5 px-2 text-xs text-white"
                        placeholder="firstname.lastname@dealer.com"
                      />
                    </label>
                    <button type="button" onClick={() => addDealer(r)} disabled={Boolean(busyRfq[r.id])} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50">
                      Add
                    </button>
                    <button type="button" onClick={() => setAddDealerOpen((prev) => ({ ...prev, [r.id]: false }))} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white">
                      Cancel
                    </button>
                  </div>
                ) : null}

                {rfqError ? <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-2.5 py-1.5 text-[10px] text-rose-300">{rfqError}</p> : null}

                <div className="flex flex-wrap items-center gap-2">
                  {!addDealerOpen[r.id] ? (
                    <button
                      type="button"
                      onClick={() => setAddDealerOpen((prev) => ({ ...prev, [r.id]: true }))}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white"
                    >
                      <Plus className="h-3 w-3" /> Add dealer
                    </button>
                  ) : null}
                  {pending.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => approve(r)}
                      disabled={Boolean(busyRfq[r.id]) || checked.size === 0}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-[11px] font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {busyRfq[r.id] ? "Approving…" : `Approve & send (${checked.size})`}
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
