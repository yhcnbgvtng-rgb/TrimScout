"use client";

// Buyer search picks + viewed marks (rules in lib/buyerPicks.ts, load-time decisions in lib/buyerPickSession.ts).
//   - picks: the ticked vehicles (max 3), kept in memory ACROSS searches. "Save picks" persists them.
//   - saved picks expire 7 days after they were saved, and a saved pick whose car is no longer listed is dropped on load.
//   - × on a pick and "Clear picks" take effect on the SAVED picks immediately (no extra Save): that is how a buyer unsaves.
//   - viewed: results the buyer opened. Written through (debounced) as they happen.
// Where it lives — the same rules either way: a guest -> localStorage (this browser, no login wall); a signed-in buyer -> the
// account via /api/buyer/search-state, mirrored in localStorage under their user id so an unavailable box never loses it.
// Nothing here opens a quote or sends anything.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { EMPTY_STATE, MAX_PICKS, dropGone, markViewed as addViewed, parseStored, pickNotice, removeKey, sanitizeState, stampSaved, togglePick, type BuyerSearchState, type PickListing, type PickedVehicle } from "@/lib/buyerPicks";
import { reconcileLoaded } from "@/lib/buyerPickSession";

const GUEST_KEY = "trimscout.buyerSearch.guest.v1";
const userKey = (id: string) => `trimscout.buyerSearch.u.${id}.v1`;
const VIEWED_DEBOUNCE_MS = 800;

function read(store: Storage | null, key: string): BuyerSearchState {
  try { return parseStored(store?.getItem(key) ?? null); } catch { return { ...EMPTY_STATE }; }
}
function write(store: Storage | null, key: string, state: BuyerSearchState) {
  try { store?.setItem(key, JSON.stringify(state)); } catch { /* private mode / quota: the in-memory state still works */ }
}
const sameKeys = (a: PickedVehicle[], b: PickedVehicle[]) => a.length === b.length && a.every((p) => b.some((q) => q.key === p.key));
const ls = () => (typeof window === "undefined" ? null : window.localStorage);

/** Guests used to live in sessionStorage (this tab only); move that copy to localStorage once so it can last its 7 days. */
function migrateGuest() {
  try {
    const session = typeof window === "undefined" ? null : window.sessionStorage;
    const old = session?.getItem(GUEST_KEY);
    if (old && !ls()?.getItem(GUEST_KEY)) ls()?.setItem(GUEST_KEY, old);
    if (old) session?.removeItem(GUEST_KEY);
  } catch { /* storage blocked */ }
}

/** Is each saved pick's car still listed? Any failure is "unknown" for every pick, and unknown picks are kept. */
async function checkListed(picks: PickedVehicle[]): Promise<Record<string, PickListing>> {
  if (picks.length === 0) return {};
  try {
    const res = await fetch("/api/buyer/pick-status", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ picks: picks.map((p) => ({ vin: p.vin, dealerId: p.dealerId, dealerName: p.dealerName })) }) });
    if (!res.ok) return {};
    const json = (await res.json()) as { status?: Record<string, PickListing> };
    return json.status ?? {};
  } catch { return {}; }
}

export type SaveStatus = "idle" | "saving" | "saved" | "saved-local" | "cleared" | "error";

export function useBuyerSearchState() {
  const { data: session, status } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const [ready, setReady] = useState(false);
  const [picks, setPicks] = useState<PickedVehicle[]>([]);
  const [savedPicks, setSavedPicks] = useState<PickedVehicle[]>([]);
  const [viewed, setViewed] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [limitNotice, setLimitNotice] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const viewedRef = useRef<string[]>([]);
  const savedRef = useRef<PickedVehicle[]>([]);
  const editedAtRef = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storeFor = () => (userId ? { store: ls(), key: userKey(userId) } : { store: ls(), key: GUEST_KEY });

  /** Write the SAVED picks everywhere they live, right now. Local always; the account too for a signed-in buyer. Returns whether the account accepted it. */
  const persistSaved = useCallback(async (next: PickedVehicle[], { touch = true } = {}): Promise<boolean> => {
    if (touch) editedAtRef.current = Date.now();
    const { store, key } = storeFor();
    write(store, key, { picks: next, viewed: viewedRef.current, picksEditedAt: editedAtRef.current });
    if (!userId) return true;
    try {
      const res = await fetch("/api/buyer/search-state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ picks: next }) });
      return res.ok;
    } catch { return false; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Load once the session is known.
  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    if (!userId) migrateGuest();
    const { store, key } = storeFor();
    const local = read(store, key);
    editedAtRef.current = local.picksEditedAt ?? null;

    const finish = async (server: BuyerSearchState | null) => {
      const now = Date.now();
      const r = reconcileLoaded({ local, server, now });
      // Drop cars that are no longer listed. A failed check keeps every pick.
      const listing = await checkListed(r.state.picks);
      if (cancelled) return;
      const { live, gone } = dropGone(r.state.picks, listing);
      const changed = gone.length > 0 || r.expired.length > 0;
      setSavedPicks(live); savedRef.current = live; setPicks(live);
      setViewed(r.state.viewed); viewedRef.current = r.state.viewed;
      setNotice(pickNotice({ gone: gone.length, expired: r.expired.length }));
      setReady(true);
      // Persist the cleaned list (and the stamps given to older saved picks) so the 7 days start once and dropped picks stay dropped.
      if (changed) editedAtRef.current = now;
      write(store, key, { picks: live, viewed: r.state.viewed, picksEditedAt: editedAtRef.current });
      if (userId && (r.pushToAccount || changed)) void persistSaved(live, { touch: false });
    };

    // Show the local copy straight away so the bar is not empty while the checks run.
    setSavedPicks(local.picks); savedRef.current = local.picks; setPicks(local.picks); setViewed(local.viewed); viewedRef.current = local.viewed; setReady(true);
    if (!userId) { void finish(null); return () => { cancelled = true; }; }
    fetch("/api/buyer/search-state", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled) void finish(json ? sanitizeState(json) : null); })
      .catch(() => { if (!cancelled) void finish(null); }); // box unavailable: the local copy still gets expiry + the listing check
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, userId]);

  const persistViewed = useCallback((next: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { store, key } = storeFor();
      write(store, key, { picks: savedRef.current, viewed: next, picksEditedAt: editedAtRef.current });
      if (userId) void fetch("/api/buyer/search-state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ viewed: next }) }).catch(() => {});
    }, VIEWED_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const markViewed = useCallback((key: string) => {
    const next = addViewed(viewedRef.current, key);
    if (next === viewedRef.current) return;
    viewedRef.current = next;
    setViewed(next);
    persistViewed(next);
  }, [persistViewed]);

  const togglePicked = useCallback((v: PickedVehicle) => {
    setPicks((cur) => {
      const r = togglePick(cur, v);
      setLimitNotice(r.outcome === "blocked");
      return r.picks;
    });
    setNotice(null);
    setSaveStatus("idle");
  }, []);

  const save = useCallback(async () => {
    const toSave = stampSaved(picks, Date.now());
    setLimitNotice(false); setNotice(null);
    setPicks(toSave); setSavedPicks(toSave); savedRef.current = toSave;
    if (!userId) { await persistSaved(toSave); setSaveStatus("saved"); return; }
    setSaveStatus("saving");
    setSaveStatus((await persistSaved(toSave)) ? "saved" : "saved-local");
  }, [picks, userId, persistSaved]);

  /** Clear all picks in one step — the ticked ones AND the saved ones — for a guest and a signed-in buyer alike. No confirmation. */
  const clearPicks = useCallback(async () => {
    setPicks([]); setSavedPicks([]); savedRef.current = [];
    setLimitNotice(false); setNotice(null);
    setSaveStatus("cleared");
    await persistSaved([]);
  }, [persistSaved]);

  /** × on one pick: gone from the bar AND from the saved picks (this browser and the account), immediately. */
  const removePick = useCallback(async (key: string) => {
    setPicks((cur) => removeKey(cur, key));
    setLimitNotice(false); setNotice(null);
    const nextSaved = removeKey(savedRef.current, key);
    if (nextSaved.length !== savedRef.current.length) {
      savedRef.current = nextSaved; setSavedPicks(nextSaved);
      setSaveStatus("idle");
      await persistSaved(nextSaved);
    } else setSaveStatus("idle");
  }, [persistSaved]);

  return { ready, signedIn: Boolean(userId), picks, viewed, saveStatus, limitNotice, notice, dirty: !sameKeys(picks, savedPicks), atLimit: picks.length >= MAX_PICKS, hasAnyPicks: picks.length > 0 || savedPicks.length > 0, togglePicked, markViewed, save, clearPicks, removePick };
}
