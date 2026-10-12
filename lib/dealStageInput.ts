/**
 * What a browser may ask of a Cash / Finance deal. Each side gets an explicit allow-list of actions and only the fields
 * that action reads; everything else is dropped. The numbers that matter (the OTD, the tax rate) are never accepted from
 * a browser: the deals server derives them from the quote on file.
 */
import type { StageAction, StageActionType, StageActor } from "./dealStages";

export const BUYER_STAGE_ACTIONS: readonly StageActionType[] = ["accept_otd", "add_trade", "skip_trade", "trade_counter", "trade_accept", "choose_cash", "request_finance", "finance_accept", "walk"];
export const DEALER_STAGE_ACTIONS: readonly StageActionType[] = ["trade_offer", "trade_accept_counter", "finance_quote", "walk"];

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown): number | string | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 20) : undefined);

/** A sanitized action for this actor, or null when the type isn't theirs to take. */
export function parseStageAction(raw: unknown, actor: StageActor): StageAction | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type as StageActionType;
  if (!(actor === "buyer" ? BUYER_STAGE_ACTIONS : DEALER_STAGE_ACTIONS).includes(type)) return null;
  switch (type) {
    case "trade_counter": return { type, value: num(o.value), note: text(o.note, 300) };
    case "trade_offer": return { type, value: num(o.value), basis: o.basis === "firm" ? "firm" : "preliminary" };
    case "request_finance": return { type, downPayment: num(o.downPayment) ?? 0, termMonths: num(o.termMonths) ?? null, outsideFinancing: o.outsideFinancing === true };
    case "finance_quote": return { type, apr: num(o.apr), termMonths: num(o.termMonths), lenderName: text(o.lenderName, 80) };
    case "walk": return { type, reason: text(o.reason, 300) };
    default: return { type };
  }
}
