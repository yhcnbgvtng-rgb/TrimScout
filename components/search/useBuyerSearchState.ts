"use client";

// Buyer search picks + viewed marks (rules in lib/buyerPicks.ts).
//   - picks: the ticked vehicles (max 3), kept in memory ACROSS searches. "Save" persists them.
//   - viewed: results the buyer opened. Written through (debounced) as they happen.
// Where it lives: a guest -> sessionStorage (this tab's session only, no login wall); a signed-in buyer -> the box via
// /api/buyer/search-state, mirrored in localStorage under their user id so a failed/unavailable box never loses it.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { EMPTY_STATE, MAX_PICKS, markViewed as addViewed, parseStored, sanitizeState, togglePick, type BuyerSearchState, type PickedVehicle } from "@/lib/buyerPicks";

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

export type SaveStatus = "idle" | "saving" | "saved" | "saved-local" | "error";

export function useBuyerSearchState() {
  const { data: session, status } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const [ready, setReady] = useState(false);
  const [picks, setPicks] = useState<PickedVehicle[]>([]);
  const [savedPicks, setSavedPicks] = useState<PickedVehicle[]>([]);
  const [viewed, setViewed] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [limitNotice, setLimitNotice] = useState(false);
  const viewedRef = useRef<string[]>([]);
  const savedRef = useRef<PickedVehicle[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storeFor = () => (userId ? { store: typeof window === "undefined" ? null : window.localStorage, key: userKey(userId) } : { store: typeof window === "undefined" ? null : window.sessionStorage, key: GUEST_KEY });

  // Load once the session is known.
  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    const { store, key } = storeFor();
    const local = read(store, key);
    const apply = (s: BuyerSearchState) => { if (cancelled) return; setSavedPicks(s.picks); savedRef.current = s.picks; setPicks(s.picks); setViewed(s.viewed); viewedRef.current = s.viewed; setReady(true); };
    apply(local);
    if (!userId) return;
    fetch("/api/buyer/search-state", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json || cancelled) return;
        const server = sanitizeState(json);
        const merged: BuyerSearchState = { picks: server.picks.length ? server.picks : local.picks, viewed: Array.from(new Set([...server.viewed, ...local.viewed])) };
        write(store, key, merged);
        apply(merged);
      })
      .catch(() => { /* box unavailable: keep the local copy */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, userId]);

  const persistViewed = useCallback((next: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { store, key } = storeFor();
      write(store, key, { picks: savedRef.current, viewed: next });
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
    setSaveStatus("idle");
  }, []);

  const save = useCallback(async () => {
    const toSave = picks;
    setLimitNotice(false);
    const { store, key } = storeFor();
    write(store, key, { picks: toSave, viewed: viewedRef.current });
    setSavedPicks(toSave); savedRef.current = toSave;
    if (!userId) { setSaveStatus("saved"); return; }
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/buyer/search-state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ picks: toSave }) });
      setSaveStatus(res.ok ? "saved" : "saved-local");
    } catch { setSaveStatus("saved-local"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, userId]);

  const clearPicks = useCallback(() => { setPicks([]); setLimitNotice(false); setSaveStatus("idle"); }, []);
  const removePick = useCallback((key: string) => { setPicks((cur) => cur.filter((p) => p.key !== key)); setLimitNotice(false); setSaveStatus("idle"); }, []);

  return { ready, signedIn: Boolean(userId), picks, viewed, saveStatus, limitNotice, dirty: !sameKeys(picks, savedPicks), atLimit: picks.length >= MAX_PICKS, togglePicked, markViewed, save, clearPicks, removePick };
}
