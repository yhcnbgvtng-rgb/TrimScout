/**
 * Used cars don't have a factory option sheet to match against, so the
 * buyer's "must-haves" become a must-CONFIRM checklist: things the dealer
 * has to confirm (or say they can't, with a note) when they quote. Part of
 * the request the buyer and the dealer both see. Never a factory match.
 */
import { normalizeMiles } from "./usedVehicle";

export const MUST_CONFIRM_COPY = "Ask the dealer to confirm — not a factory option match.";

export type MustConfirmKey = "clean_title" | "miles_under" | "drivetrain" | "cpo_warranty" | "tag";

export interface MustConfirmItem {
  /** Stable id the dealer's acknowledgement points at. */
  id: string;
  key: MustConfirmKey;
  /** What the dealer reads: "Clean title", "Under 40,000 miles", "AWD", "CPO / remaining factory warranty", "Panoramic roof". */
  label: string;
  /** The number / text behind the label, when there is one. */
  value?: string | number | null;
}

export type DrivetrainAsk = "AWD" | "4WD" | "RWD" | "FWD";
export const DRIVETRAIN_ASKS: DrivetrainAsk[] = ["AWD", "4WD", "RWD", "FWD"];

/** What the buyer fills in on Step 1 for a used car. */
export interface MustConfirmDraft {
  cleanTitle: boolean;
  maxMiles: string;
  drivetrain: DrivetrainAsk | "";
  cpoWarranty: boolean;
  /** Free-text option tags, e.g. "panoramic roof", "tow package". */
  tags: string[];
}

export const EMPTY_MUST_CONFIRM_DRAFT: MustConfirmDraft = { cleanTitle: true, maxMiles: "", drivetrain: "", cpoWarranty: false, tags: [] };

/** Split "panoramic roof, tow package; heated seats" into clean, deduped tags (max 8, 40 chars each). */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const t = part.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length === 8) break;
  }
  return out;
}

export function buildMustConfirmList(d: MustConfirmDraft): MustConfirmItem[] {
  const items: MustConfirmItem[] = [];
  if (d.cleanTitle) items.push({ id: "clean_title", key: "clean_title", label: "Clean title" });
  const miles = normalizeMiles(d.maxMiles);
  if (miles != null && miles > 0) items.push({ id: "miles_under", key: "miles_under", label: `Under ${miles.toLocaleString()} miles`, value: miles });
  if (d.drivetrain) items.push({ id: "drivetrain", key: "drivetrain", label: d.drivetrain, value: d.drivetrain });
  if (d.cpoWarranty) items.push({ id: "cpo_warranty", key: "cpo_warranty", label: "CPO / remaining factory warranty" });
  d.tags.forEach((t, i) => items.push({ id: `tag_${i + 1}`, key: "tag", label: t, value: t }));
  return items;
}

/** Read a stored list back (from linkPastes[].mustConfirm) without trusting it. */
export function parseMustConfirmList(raw: unknown): MustConfirmItem[] {
  if (!Array.isArray(raw)) return [];
  const keys: MustConfirmKey[] = ["clean_title", "miles_under", "drivetrain", "cpo_warranty", "tag"];
  const out: MustConfirmItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const key = keys.includes(o.key as MustConfirmKey) ? (o.key as MustConfirmKey) : null;
    const id = typeof o.id === "string" && /^[a-z_0-9]{1,24}$/.test(o.id) ? o.id : null;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 60) : "";
    if (!key || !id || !label) continue;
    const value = typeof o.value === "string" || typeof o.value === "number" ? o.value : undefined;
    out.push(value === undefined ? { id, key, label } : { id, key, label, value });
    if (out.length === 12) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The dealer's side: every item confirmed, or "cannot confirm" + a note.
// ---------------------------------------------------------------------------
export interface MustConfirmAck {
  id: string;
  status: "confirmed" | "cannot_confirm";
  note?: string | null;
}

export function validateMustConfirmAcks(items: MustConfirmItem[], acks: MustConfirmAck[] | null | undefined): string[] {
  const errors: string[] = [];
  const byId = new Map((acks || []).map((a) => [a.id, a]));
  for (const item of items) {
    const a = byId.get(item.id);
    if (!a || (a.status !== "confirmed" && a.status !== "cannot_confirm")) {
      errors.push(`Confirm "${item.label}", or mark that you can't and say why.`);
      continue;
    }
    if (a.status === "cannot_confirm" && (a.note || "").trim().length < 3) errors.push(`"${item.label}" — a short note is needed when you can't confirm it.`);
  }
  return errors;
}

/** Coerce an untrusted acks array to the shape above, keeping only ids on the list. */
export function parseMustConfirmAcks(raw: unknown, items: MustConfirmItem[]): MustConfirmAck[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(items.map((i) => i.id));
  const out: MustConfirmAck[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !ids.has(o.id)) continue;
    const status = o.status === "confirmed" || o.status === "cannot_confirm" ? o.status : null;
    if (!status) continue;
    out.push({ id: o.id, status, note: typeof o.note === "string" ? o.note.trim().slice(0, 200) : null });
  }
  return out;
}
