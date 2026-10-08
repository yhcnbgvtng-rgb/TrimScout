/**
 * Trade drafts, photo registration and the hand-off from draft to quote request. Storage is injected so the
 * rules (who may touch a draft, what counts as a stored photo, "six required photos or no request") are tested
 * against an in-memory fake. Routes stay thin and add auth + rate limits.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { serverSecret } from "../serverSecret";
import { MAX_STORED_PHOTO_BYTES, draftKey, photoKey, userDraftKey, type TradeStorage } from "./storage";
import { MIN_SHORT_EDGE } from "./photoQuality";
import { isPhotoSlot, isRequiredSlot, type PhotoSlot, type TradeInRecord, type TradePhoto } from "./types";
import { parseTradeFields, validatePhotoSet, type TradeErrors } from "./validate";

export interface TradeDraft {
  id: string;
  userId: string | null;
  /** Untrusted in-progress form values; fully validated only at submit. */
  fields: Record<string, unknown>;
  photos: TradePhoto[];
  createdAt: string;
  updatedAt: string;
  /** Set once the request is sent; the draft then stops accepting edits. */
  consumedRfqId: string | null;
}

export class TradeError extends Error {
  status: number; errors?: TradeErrors;
  constructor(message: string, status = 400, errors?: TradeErrors) { super(message); this.status = status; this.errors = errors; }
}

// ---- draft capability token ------------------------------------------------
export const draftToken = (draftId: string): string => createHmac("sha256", serverSecret("LIGHTSAIL_API_KEY")).update(`trade-draft:${draftId}`).digest("hex");
export function verifyDraftToken(draftId: string, token: unknown): boolean {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token) || !serverSecret("LIGHTSAIL_API_KEY")) return false;
  return timingSafeEqual(Buffer.from(draftToken(draftId), "hex"), Buffer.from(token, "hex"));
}
const isDraftId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/.test(s);

// ---- drafts -----------------------------------------------------------------
export async function createDraft(storage: TradeStorage, userId: string | null, now: Date = new Date()): Promise<TradeDraft> {
  const draft: TradeDraft = { id: randomUUID(), userId, fields: {}, photos: [], createdAt: now.toISOString(), updatedAt: now.toISOString(), consumedRfqId: null };
  await storage.putJson(draftKey(draft.id), draft);
  if (userId) await storage.putJson(userDraftKey(userId), { draftId: draft.id });
  return draft;
}

export async function loadDraft(storage: TradeStorage, draftId: string, token: unknown): Promise<TradeDraft> {
  if (!isDraftId(draftId) || !verifyDraftToken(draftId, token)) throw new TradeError("This draft link isn't valid.", 403);
  const draft = await storage.getJson<TradeDraft>(draftKey(draftId));
  if (!draft) throw new TradeError("Draft not found.", 404);
  return draft;
}

/** The signed-in buyer's latest unsent draft, so they can pick up on any device. */
export async function latestDraftFor(storage: TradeStorage, userId: string): Promise<{ draft: TradeDraft; token: string } | null> {
  const ptr = await storage.getJson<{ draftId: string }>(userDraftKey(userId));
  if (!ptr || !isDraftId(ptr.draftId)) return null;
  const draft = await storage.getJson<TradeDraft>(draftKey(ptr.draftId));
  if (!draft || draft.userId !== userId || draft.consumedRfqId) return null;
  return { draft, token: draftToken(draft.id) };
}

const MAX_FIELDS_JSON = 20_000;
export async function saveDraftFields(storage: TradeStorage, draft: TradeDraft, fields: unknown, now: Date = new Date()): Promise<TradeDraft> {
  if (draft.consumedRfqId) throw new TradeError("This trade-in was already sent with a request.", 409);
  if (!fields || typeof fields !== "object" || Array.isArray(fields) || JSON.stringify(fields).length > MAX_FIELDS_JSON) throw new TradeError("Invalid trade-in details.", 400);
  const next = { ...draft, fields: fields as Record<string, unknown>, updatedAt: now.toISOString() };
  await storage.putJson(draftKey(draft.id), next);
  return next;
}

// ---- photos ------------------------------------------------------------------
export type PhotoScope = { kind: "draft" | "rfq"; id: string };

export function requireSlot(slot: unknown): PhotoSlot {
  if (!isPhotoSlot(slot)) throw new TradeError("Unknown photo slot.", 400);
  return slot;
}

export async function presignPhotoUpload(storage: TradeStorage, scope: PhotoScope, slot: unknown): Promise<{ key: string; uploadUrl: string; contentType: "image/jpeg" }> {
  const s = requireSlot(slot);
  const key = photoKey(scope.id, s);
  return { key, uploadUrl: await storage.signedPutUrl(key, "image/jpeg"), contentType: "image/jpeg" };
}

/** After the browser's PUT: confirm the object is really there, small enough, and a JPEG; then describe it. */
export async function confirmPhoto(storage: TradeStorage, scope: PhotoScope, slot: unknown, meta: { width?: unknown; height?: unknown; capturedAt?: unknown }, now: Date = new Date()): Promise<TradePhoto> {
  const s = requireSlot(slot);
  const key = photoKey(scope.id, s);
  const head = await storage.head(key);
  if (!head) throw new TradeError("That photo didn't finish uploading. Try again.", 409);
  if (head.size > MAX_STORED_PHOTO_BYTES) { await storage.remove(key); throw new TradeError("That photo is too large.", 413); }
  if (head.contentType && !/^image\/jpeg$/i.test(head.contentType)) { await storage.remove(key); throw new TradeError("Photos are stored as JPEG.", 415); }
  const width = Number(meta.width), height = Number(meta.height);
  if (!(Number.isInteger(width) && Number.isInteger(height) && Math.min(width, height) >= MIN_SHORT_EDGE && Math.max(width, height) <= 4096)) {
    await storage.remove(key);
    throw new TradeError(`Photos need at least ${MIN_SHORT_EDGE}px on the short side.`, 422);
  }
  const captured = typeof meta.capturedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(meta.capturedAt) ? meta.capturedAt.slice(0, 19) : null;
  return { slot: s, required: isRequiredSlot(s), storageKey: key, width, height, capturedAt: captured, uploadedAt: now.toISOString() };
}

export async function recordDraftPhoto(storage: TradeStorage, draft: TradeDraft, photo: TradePhoto, now: Date = new Date()): Promise<TradeDraft> {
  if (draft.consumedRfqId) throw new TradeError("This trade-in was already sent with a request.", 409);
  const next = { ...draft, photos: [...draft.photos.filter((p) => p.slot !== photo.slot), photo], updatedAt: now.toISOString() };
  await storage.putJson(draftKey(draft.id), next);
  return next;
}

export async function removeDraftPhoto(storage: TradeStorage, draft: TradeDraft, slot: unknown, now: Date = new Date()): Promise<TradeDraft> {
  const s = requireSlot(slot);
  if (draft.consumedRfqId) throw new TradeError("This trade-in was already sent with a request.", 409);
  await storage.remove(photoKey(draft.id, s)).catch(() => undefined);
  const next = { ...draft, photos: draft.photos.filter((p) => p.slot !== s), updatedAt: now.toISOString() };
  await storage.putJson(draftKey(draft.id), next);
  return next;
}

// ---- draft → quote request ----------------------------------------------------
/**
 * Everything that must be true before a request with a trade-in may be created. Throws TradeError (400) with
 * field errors, or (422) when a required photo is missing or isn't actually in storage. Never mutates.
 */
export async function validateDraftForSubmit(storage: TradeStorage, draftId: string, token: unknown, userId: string | null): Promise<{ draft: TradeDraft; record: TradeInRecord }> {
  const draft = await loadDraft(storage, draftId, token);
  if (draft.consumedRfqId) throw new TradeError("This trade-in was already sent with a request.", 409);
  if (draft.userId && userId && draft.userId !== userId) throw new TradeError("This draft belongs to another account.", 403);
  const parsed = parseTradeFields(draft.fields);
  if (!parsed.ok) throw new TradeError("Finish the trade-in details before sending.", 400, parsed.errors);
  const set = validatePhotoSet(draft.photos);
  if (!set.ok) throw new TradeError(set.error || "Add all 6 required photos.", 422);
  for (const p of draft.photos) {
    const head = await storage.head(p.storageKey);
    if (!head) throw new TradeError(`The ${p.slot.replace("_", " ")} photo isn't in storage. Re-upload it.`, 422);
  }
  const now = new Date().toISOString();
  return { draft, record: { ...parsed.fields, photos: draft.photos, createdAt: now, updatedAt: now } };
}

/** After the request exists: copy the photos to trade/{rfqId}/…, mark the draft consumed, return the final record. */
export async function adoptDraftIntoRfq(storage: TradeStorage, draft: TradeDraft, record: TradeInRecord, rfqId: string): Promise<TradeInRecord> {
  const photos: TradePhoto[] = [];
  for (const p of record.photos) {
    const to = photoKey(rfqId, p.slot);
    await storage.copy(p.storageKey, to);
    photos.push({ ...p, storageKey: to });
  }
  await storage.putJson(draftKey(draft.id), { ...draft, consumedRfqId: rfqId, updatedAt: new Date().toISOString() });
  return { ...record, photos };
}

/** Replace or add one photo on a SENT request (buyer, until a quote is picked). Returns the new photo list. */
export function withPhoto(photos: TradePhoto[], photo: TradePhoto): TradePhoto[] {
  return [...photos.filter((p) => p.slot !== photo.slot), photo];
}
export function withoutOptionalPhoto(photos: TradePhoto[], slot: PhotoSlot): TradePhoto[] {
  if (isRequiredSlot(slot)) throw new TradeError("The six required photos can be replaced but not removed.", 400);
  return photos.filter((p) => p.slot !== slot);
}

/**
 * The quote-request create path: toggle off (or no `tradeIn` in the body) → null, no storage is touched and no
 * trade data goes anywhere. Toggle on → the draft must validate completely, six required photos included.
 */
export async function prepareTradeForRfq(storage: TradeStorage, body: { tradeIn?: unknown } | null | undefined, userId: string | null): Promise<{ draft: TradeDraft; record: TradeInRecord } | null> {
  const t = body?.tradeIn;
  if (!t || typeof t !== "object") return null;
  const o = t as { enabled?: unknown; draftId?: unknown; token?: unknown };
  if (o.enabled === false) return null;
  if (typeof o.draftId !== "string") throw new TradeError("Finish the trade-in step (or turn it off) before sending.", 400);
  return validateDraftForSubmit(storage, o.draftId, o.token, userId);
}
