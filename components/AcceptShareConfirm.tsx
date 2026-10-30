"use client";

import React, { useMemo, useState } from "react";
import { acceptShareBody, ACCEPT_CONTINUE_BUTTON, GUEST_CONTACT_LINE, ACCEPT_SHARE_BUTTON, ACCEPT_SHARE_CANCEL, createAcceptGate, sharedFields, type AcceptMode, type ShareContact } from "../lib/acceptShare";

/** The confirm dialog: a bottom sheet on phones, a centred card from sm up. Presentational; the gate decides what runs. */
export function AcceptShareDialog({ dealerName, contact, onConfirm, onCancel, busy = false, mode = "final" }: { mode?: AcceptMode; dealerName: string; contact: ShareContact | null | undefined; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  const fields = sharedFields(contact);
  const guest = fields.every((f) => f.masked === null);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="presentation" data-testid="accept-share-overlay">
      <div role="alertdialog" aria-modal="true" aria-labelledby="accept-share-title" aria-describedby="accept-share-body" className="w-full max-w-md space-y-3 rounded-t-2xl border border-border bg-surface p-5 sm:rounded-2xl" data-testid="accept-share-dialog">
        <h2 id="accept-share-title" className="text-sm font-bold text-white">Share your info with {dealerName}?</h2>
        <p id="accept-share-body" className="text-xs text-ink-light" data-testid="accept-share-body">{acceptShareBody(dealerName, mode)}</p>
        {guest ? <p className="rounded-lg border border-border/70 p-3 text-[11px] text-ink-light" data-testid="accept-share-guest">{GUEST_CONTACT_LINE}</p> : <dl className="space-y-1 rounded-lg border border-border/70 p-3 text-[11px]" data-testid="accept-share-fields">
          {fields.map((f) => (
            <div key={f.key} className="flex justify-between gap-3" data-testid={`accept-share-${f.key}`}>
              <dt className="text-ink-faint">{f.label}</dt>
              <dd className="text-right font-bold text-white">{f.masked ?? "Not on file"}</dd>
            </div>
          ))}
        </dl>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-4 py-2.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="accept-share-cancel">{ACCEPT_SHARE_CANCEL}</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="rounded-lg bg-brand-500 px-4 py-2.5 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="accept-share-confirm">{mode === "early" ? ACCEPT_CONTINUE_BUTTON : ACCEPT_SHARE_BUTTON}</button>
        </div>
      </div>
    </div>
  );
}

/** Wire any acceptance through the dialog: `request(dealer, fn)` opens it; `fn` runs only on "Accept and share my info". */
export function useAcceptShare(contact: ShareContact | null | undefined) {
  const [, bump] = useState(0);
  const gate = useMemo(() => createAcceptGate<void>(() => bump((n) => n + 1)), []);
  const pending = gate.pending();
  const dialog = pending ? <AcceptShareDialog mode={pending.mode} dealerName={pending.dealerName} contact={contact} onConfirm={() => { void gate.confirm(); }} onCancel={gate.cancel} /> : null;
  return { request: gate.request, dialog };
}
