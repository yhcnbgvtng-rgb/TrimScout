"use client";

import React, { useMemo, useState } from "react";
import { acceptShareBody, ACCEPT_CONTINUE_BUTTON, ACCEPT_SHARE_BUTTON, ACCEPT_SHARE_CANCEL, createAcceptGate, draftFromContact, submitContactDraft, validateContactDraft, type AcceptMode, type ContactDraft, type ContactErrors, type ShareContact } from "../lib/acceptShare";

const FIELDS: { key: keyof ContactDraft; label: string; type: string; autoComplete: string; inputMode?: "tel" | "email" }[] = [
  { key: "name", label: "Name", type: "text", autoComplete: "name" },
  { key: "phone", label: "Phone", type: "tel", autoComplete: "tel", inputMode: "tel" },
  { key: "email", label: "Email", type: "email", autoComplete: "email", inputMode: "email" },
];

/** The confirm dialog: a bottom sheet on phones, a centred card from sm up. Name, phone and email are editable (prefilled from
 *  `contact`) and all three are required: Continue / Accept stays disabled until they are valid. Nothing is sent from here; the
 *  edited values go to `onConfirm`, and the gate decides what runs. */
export function AcceptShareDialog({ dealerName, contact, onConfirm, onCancel, busy = false, mode = "final" }: { mode?: AcceptMode; dealerName: string; contact: ShareContact | null | undefined; onConfirm: (contact: ShareContact) => void; onCancel: () => void; busy?: boolean }) {
  const [draft, setDraft] = useState<ContactDraft>(() => draftFromContact(contact));
  const [touched, setTouched] = useState<Partial<Record<keyof ContactDraft, boolean>>>({});
  const errors: ContactErrors = validateContactDraft(draft);
  const valid = Object.keys(errors).length === 0;
  const submit = () => {
    const blocked = submitContactDraft(draft, onConfirm);
    if (Object.keys(blocked).length) setTouched({ name: true, phone: true, email: true });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="presentation" data-testid="accept-share-overlay">
      <form noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }} role="alertdialog" aria-modal="true" aria-labelledby="accept-share-title" aria-describedby="accept-share-body" className="w-full max-w-md space-y-3 rounded-t-2xl border border-border bg-surface p-5 sm:rounded-2xl" data-testid="accept-share-dialog">
        <h2 id="accept-share-title" className="text-sm font-bold text-white">Share your info with {dealerName}?</h2>
        <p id="accept-share-body" className="text-xs text-ink-light" data-testid="accept-share-body">{acceptShareBody(dealerName, mode)}</p>
        <div className="space-y-2 rounded-lg border border-border/70 p-3" data-testid="accept-share-fields">
          {FIELDS.map((f) => {
            const err = touched[f.key] ? errors[f.key] : undefined;
            return (
              <div key={f.key} data-testid={`accept-share-${f.key}`}>
                <label htmlFor={`accept-share-input-${f.key}`} className="block text-[11px] text-ink-faint">{f.label} <span aria-hidden="true">*</span></label>
                <input id={`accept-share-input-${f.key}`} name={f.key} type={f.type} inputMode={f.inputMode} autoComplete={f.autoComplete} required aria-required="true" aria-invalid={err ? true : undefined} aria-describedby={err ? `accept-share-error-${f.key}` : undefined} value={draft[f.key]} disabled={busy}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))}
                  className="mt-0.5 w-full rounded-md border border-border bg-black/30 px-2.5 py-2 text-xs font-bold text-white" data-testid={`accept-share-input-${f.key}`} />
                {err ? <p id={`accept-share-error-${f.key}`} role="alert" className="mt-0.5 text-[11px] text-red-400" data-testid={`accept-share-error-${f.key}`}>{err}</p> : null}
              </div>
            );
          })}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-4 py-2.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="accept-share-cancel">{ACCEPT_SHARE_CANCEL}</button>
          <button type="submit" disabled={busy || !valid} className="rounded-lg bg-brand-500 px-4 py-2.5 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="accept-share-confirm">{mode === "early" ? ACCEPT_CONTINUE_BUTTON : ACCEPT_SHARE_BUTTON}</button>
        </div>
      </form>
    </div>
  );
}

/** Wire any acceptance through the dialog: `request(dealer, fn)` opens it; `fn` runs only on "Accept and share my info". */
export function useAcceptShare(contact: ShareContact | null | undefined) {
  const [, bump] = useState(0);
  const gate = useMemo(() => createAcceptGate<void>(() => bump((n) => n + 1)), []);
  // What the buyer typed on Continue: held here only (nothing is sent), prefilled into the final step and sent with accept_final.
  const [edited, setEdited] = useState<ShareContact | null>(null);
  const pending = gate.pending();
  const dialog = pending ? <AcceptShareDialog key={`${pending.dealerName}:${pending.mode}`} mode={pending.mode} dealerName={pending.dealerName} contact={edited ?? contact} onConfirm={(c) => { setEdited(c); void gate.confirm(c); }} onCancel={gate.cancel} /> : null;
  return { request: gate.request, dialog };
}
