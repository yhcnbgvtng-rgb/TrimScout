"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import { bubbleAlign, MAX_CHAT_LENGTH, unreadCount, type ThreadEntry, type ThreadViewer } from "../lib/dealThread";
import { findIdentityInfo } from "../lib/identityFilter";

/**
 * The conversation on one dealer's quote, instant-messaging style (lib/dealThread.ts builds it from what the deal already
 * stores). Desktop: a panel on the right of the deal and quote screens. Mobile: a slide-up drawer opened from a button with an
 * unread badge. Your messages sit on the right, the other side's on the left, with timestamps; counters, accepts, fee
 * overrides and trade-in values are small centered notes; the list scrolls to the newest; the compose box is at the bottom.
 * Each panel shows ONE dealer's thread. Contact details are refused on send, and never shown before the deal is final.
 */
interface ThreadData {
  viewer: ThreadViewer;
  entries: ThreadEntry[];
  canPost: boolean;
  readOnlyReason: string | null;
  finalAccepted: boolean;
  /** False until the box has the messages patch: the history still reads, sending says "not available yet". */
  messaging: boolean;
  otherParty: string;
}

const POLL_MS = 20000;
const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function readSeen(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeSeen(key: string, at: string) {
  try { window.localStorage.setItem(key, at); } catch { /* a private window just shows the badge again */ }
}

export function DealThreadPanel({
  endpoint,
  viewer,
  headers,
  seenKey,
  heading,
  headerExtra = null,
  initial = null,
}: {
  /** GET loads the thread, POST { text } sends. */
  endpoint: string;
  viewer: ThreadViewer;
  /** Guest buyers carry their tracker token here. */
  headers?: Record<string, string>;
  seenKey: string;
  heading: string;
  /** The buyer's dealer picker: one thread per dealer. */
  headerExtra?: React.ReactNode;
  /** For tests and server rendering: skips the first fetch. */
  initial?: ThreadData | null;
}) {
  const [data, setData] = useState<ThreadData | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    setSeen(readSeen(seenKey));
    return () => mq.removeEventListener("change", sync);
  }, [seenKey]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { headers: headers || {}, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the conversation.");
      setData(json as ThreadData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the conversation.");
    }
  }, [endpoint, headers]);

  useEffect(() => {
    if (initial) return;
    load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load, initial]);

  const entries = data?.entries ?? [];
  const visible = desktop || open;
  const newest = entries.length ? entries[entries.length - 1].at : null;

  // Auto-scroll to the newest whenever something arrives (or the drawer opens).
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, visible]);

  // What the viewer can see counts as read.
  useEffect(() => {
    if (visible && newest && (!seen || newest > seen)) {
      writeSeen(seenKey, newest);
      setSeen(newest);
    }
  }, [visible, newest, seen, seenKey]);

  const unread = visible ? 0 : unreadCount(entries, viewer, seen);
  const blocked = findIdentityInfo(text);
  const canSend = Boolean(data?.canPost && data.messaging) && !sending && text.trim().length > 0 && !blocked;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(headers || {}) }, body: JSON.stringify({ text: text.trim() }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not send that message.");
      setData(json as ThreadData);
      setText("");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  };

  const disabledReason = !data ? null : !data.canPost ? data.readOnlyReason : !data.messaging ? "Sending messages isn't available yet. What's already on this deal is shown here." : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-brand-500 px-4 py-3 text-xs font-extrabold text-black shadow-lg hover:bg-brand-400 lg:hidden"
        data-testid="thread-open"
        aria-label={unread ? `Open messages, ${unread} unread` : "Open messages"}
      >
        <MessageSquare className="h-4 w-4" /> Messages
        {unread > 0 ? <span className="ml-1 rounded-full bg-black px-1.5 py-0.5 text-[10px] font-black text-brand-300" data-testid="thread-unread">{unread}</span> : null}
      </button>
      {open ? <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} data-testid="thread-backdrop" /> : null}

      <aside
        className={`fixed inset-x-0 bottom-0 z-40 flex h-[78vh] flex-col rounded-t-2xl border border-border bg-surface shadow-2xl transition-transform duration-200 ${open ? "translate-y-0" : "translate-y-full"} lg:sticky lg:top-20 lg:z-0 lg:h-[calc(100vh-7rem)] lg:translate-y-0 lg:rounded-2xl lg:shadow-none`}
        data-testid="deal-thread"
        data-open={open ? "true" : "false"}
        aria-label={`Conversation with ${heading}`}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-extrabold text-white" data-testid="thread-heading">{heading}</h2>
            <p className="text-[10px] text-ink-faint">Only this conversation. Names and contact details are never shared here.</p>
            {headerExtra}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-muted hover:text-white lg:hidden" aria-label="Close messages" data-testid="thread-close"><X className="h-4 w-4" /></button>
        </header>

        <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3" data-testid="thread-list" role="log" aria-live="polite">
          {error ? <p className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">{error}</p> : null}
          {!data && !error ? <p className="text-center text-[11px] text-ink-muted">Loading the conversation…</p> : null}
          {data && entries.length === 0 ? <p className="py-6 text-center text-[11px] text-ink-muted" data-testid="thread-empty">Nothing here yet. Quotes, counters and messages show up as they happen.</p> : null}
          {entries.map((e) => {
            const align = bubbleAlign(e.side, viewer);
            if (align === "center") {
              return (
                <p key={e.id} className="px-2 text-center text-[10px] leading-snug text-ink-muted" data-testid="thread-event" data-entry={e.id}>
                  {e.text} <span className="text-ink-faint">· {fmtTime(e.at)}</span>
                </p>
              );
            }
            const mine = align === "mine";
            return (
              <div key={e.id} className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={mine ? "thread-bubble-mine" : "thread-bubble-theirs"} data-side={e.side} data-entry={e.id}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${mine ? "rounded-br-sm bg-brand-500 text-black" : "rounded-bl-sm bg-surface-elevated text-white"}`}>
                  <p className={`mb-0.5 text-[9px] font-bold uppercase tracking-wide ${mine ? "text-black/60" : "text-ink-faint"}`}>
                    {e.side === "buyer" ? (viewer === "buyer" ? "You" : "Buyer") : viewer === "dealer" ? "You" : data?.otherParty || "Dealer"}
                    {e.kind === "note" ? " · note on the deal" : ""}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{e.text}</p>
                  <p className={`mt-1 text-[9px] ${mine ? "text-black/60" : "text-ink-faint"}`}>{fmtTime(e.at)}</p>
                </div>
              </div>
            );
          })}
        </div>

        <footer className="space-y-1.5 border-t border-border/70 px-3 py-3">
          {disabledReason ? <p className="text-[10px] text-ink-muted" data-testid="thread-readonly">{disabledReason}</p> : null}
          {blocked ? <p className="text-[10px] text-amber-200" data-testid="thread-contact-warning">That looks like {blocked}. Names, phone numbers (even spelled out), emails and addresses can&apos;t be shared in messages, so this can&apos;t be sent.</p> : null}
          {sendError ? <p className="text-[10px] text-rose-300" data-testid="thread-send-error">{sendError}</p> : null}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              maxLength={MAX_CHAT_LENGTH}
              rows={2}
              disabled={Boolean(disabledReason) || !data}
              placeholder={disabledReason ? "Messaging is paused" : "Write a message…"}
              aria-label="Write a message"
              data-testid="thread-compose"
              className="min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none disabled:opacity-50"
            />
            <button type="button" onClick={send} disabled={!canSend} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-black hover:bg-brand-400 disabled:opacity-40" aria-label="Send message" data-testid="thread-send">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
