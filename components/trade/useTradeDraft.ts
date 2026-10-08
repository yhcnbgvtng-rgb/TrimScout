"use client";
/**
 * The buyer's trade-in draft: fields + photos autosaved to the server (S3) so they can leave and come back on any
 * device. The draft id + token are remembered in this browser, the signed-in buyer's latest draft is looked up
 * server-side, and the phone hand-off page opens the same draft by link. Photos are processed in the browser
 * (HEIC→JPEG, ≤2048px, EXIF stripped, quality-checked) and PUT straight to S3 with a presigned URL.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { processPhoto } from "../../lib/trade/photoPipeline";
import type { PhotoSlot, TradePhoto } from "../../lib/trade/types";

export type Fields = Record<string, unknown>;
export interface SignedPhoto { slot: PhotoSlot; url: string }
const STORE_KEY = "trimscout.tradeDraft.v1";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
  return json as T;
}

export function useTradeDraft(enabled: boolean, opts: { draftId?: string; token?: string; poll?: boolean } = {}) {
  const [ref, setRef] = useState<{ id: string; token: string } | null>(opts.draftId && opts.token ? { id: opts.draftId, token: opts.token } : null);
  const [fields, setFieldsState] = useState<Fields>({});
  const [photos, setPhotos] = useState<TradePhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<PhotoSlot | null>(null);
  const [slotError, setSlotError] = useState<{ slot: PhotoSlot; message: string } | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  const applyServer = useCallback((d: { fields?: Fields; photos?: TradePhoto[]; sent?: boolean }, signed?: SignedPhoto[], withFields = true) => {
    if (withFields && d.fields && Object.keys(d.fields).length) setFieldsState(d.fields);
    if (d.photos) setPhotos(d.photos);
    if (d.sent) setSent(true);
    if (signed) setUrls((u) => ({ ...u, ...Object.fromEntries(signed.map((s) => [s.slot, s.url])) }));
  }, []);

  // Find or create the draft once the toggle is on.
  useEffect(() => {
    if (!enabled || hydrated.current) return;
    hydrated.current = true;
    (async () => {
      setLoading(true);
      try {
        let known = ref;
        if (!known) {
          try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); if (s?.id && s?.token) known = s; } catch { /* private mode */ }
        }
        if (known) {
          try {
            const r = await api<{ draft: { id: string; fields: Fields; photos: TradePhoto[]; sent: boolean }; signed: SignedPhoto[] }>(`/api/trade/draft/${known.id}?k=${known.token}`);
            if (!r.draft.sent) { setRef(known); applyServer(r.draft, r.signed); return; }
          } catch { /* stale: fall through to a fresh one */ }
        }
        const latest = await api<{ draft: { id: string; fields: Fields; photos: TradePhoto[] } | null; token?: string }>("/api/trade/draft");
        if (latest.draft && latest.token) {
          const r = await api<{ draft: { id: string; fields: Fields; photos: TradePhoto[]; sent: boolean }; signed: SignedPhoto[] }>(`/api/trade/draft/${latest.draft.id}?k=${latest.token}`);
          setRef({ id: latest.draft.id, token: latest.token }); applyServer(r.draft, r.signed); return;
        }
        const made = await api<{ draftId: string; token: string }>("/api/trade/draft", { method: "POST", body: "{}" });
        setRef({ id: made.draftId, token: made.token });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't start the trade-in draft.");
      } finally { setLoading(false); }
    })();
  }, [enabled, ref, applyServer]);

  useEffect(() => {
    if (ref) { try { localStorage.setItem(STORE_KEY, JSON.stringify(ref)); } catch { /* optional */ } }
  }, [ref]);

  // Autosave the form (debounced).
  const setFields = useCallback((update: (f: Fields) => Fields) => {
    setFieldsState((prev) => {
      const next = update(prev);
      if (ref) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        setSaving("saving");
        saveTimer.current = setTimeout(() => {
          api(`/api/trade/draft/${ref.id}?k=${ref.token}`, { method: "PUT", body: JSON.stringify({ fields: next }) })
            .then(() => setSaving("saved")).catch(() => setSaving("idle"));
        }, 800);
      }
      return next;
    });
  }, [ref]);

  // Pick up photos added on the phone.
  useEffect(() => {
    if (!enabled || !ref || !opts.poll) return;
    const t = setInterval(() => {
      api<{ draft: { photos: TradePhoto[]; sent: boolean }; signed: SignedPhoto[] }>(`/api/trade/draft/${ref.id}?k=${ref.token}`)
        .then((r) => applyServer(r.draft, r.signed, false)).catch(() => undefined);
    }, 6000);
    return () => clearInterval(t);
  }, [enabled, ref, opts.poll, applyServer]);

  const uploadPhoto = useCallback(async (slot: PhotoSlot, file: File): Promise<boolean> => {
    if (!ref) return false;
    setSlotError(null); setBusySlot(slot);
    try {
      const out = await processPhoto(file);
      if (!out.ok) { setSlotError({ slot, message: out.message }); return false; }
      const base = `/api/trade/draft/${ref.id}/photos?k=${ref.token}`;
      const signed = await api<{ uploadUrl: string }>(base, { method: "POST", body: JSON.stringify({ op: "sign", slot }) });
      const put = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: out.blob });
      if (!put.ok) throw new Error("The upload didn't go through. Check your connection and retry.");
      const done = await api<{ photos: TradePhoto[]; signed: SignedPhoto[] }>(base, { method: "POST", body: JSON.stringify({ op: "confirm", slot, width: out.width, height: out.height, capturedAt: out.capturedAt }) });
      setPhotos(done.photos);
      setUrls((u) => ({ ...u, [slot]: URL.createObjectURL(out.blob) }));
      return true;
    } catch (e) {
      setSlotError({ slot, message: e instanceof Error ? e.message : "Couldn't upload that photo." });
      return false;
    } finally { setBusySlot(null); }
  }, [ref]);

  const removePhoto = useCallback(async (slot: PhotoSlot) => {
    if (!ref) return;
    try {
      const r = await api<{ photos: TradePhoto[] }>(`/api/trade/draft/${ref.id}/photos?k=${ref.token}`, { method: "POST", body: JSON.stringify({ op: "remove", slot }) });
      setPhotos(r.photos); setUrls((u) => { const { [slot]: _gone, ...rest } = u; return rest; });
    } catch (e) { setSlotError({ slot, message: e instanceof Error ? e.message : "Couldn't remove that photo." }); }
  }, [ref]);

  return { ref, fields, setFields, photos, urls, sent, loading, error, busySlot, slotError, saving, uploadPhoto, removePhoto };
}
