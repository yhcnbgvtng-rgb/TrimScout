/**
 * Trade allowance with the quote, then one in-app confirm step for the winner. The rules are one module shared with the
 * deals server (scrapers/lightsail-crawler/src/tradeConfirm.js); this file types them and holds what only the app needs:
 * config from the environment, the allowance a card should rank on, and the labels. See docs/TRADE_QUOTE_CONFIRM.md.
 */
import {
  applyConfirmAction as applyAction,
  auditEntry as audit,
  awaitingBuyer as awaiting,
  bindingAllowance as binding,
  CONDITION_CHIPS,
  CONDITIONS_TEXT_KEY,
  DECLINE_CODES,
  DEFAULT_DEADLINE_HOURS,
  DEFAULT_THRESHOLD_PCT,
  deskHonestyRollup as rollup,
  effectiveStatus as effStatus,
  GUARDRAIL_MIN_TEXT,
  isSettled as settled,
  openConfirmation as open,
  quoteMetrics as metrics,
  REVISION_REASONS,
  tradeAnswerProblem as answerProblem,
} from "../../scrapers/lightsail-crawler/src/tradeConfirm.js";
import type { RfqInvite, RfqRequest } from "../rfq";
import { allowanceOf, type AllowanceValue } from "./otd";
import type { AppraisalBasis, DealerTradeAppraisal } from "./types";

export type ConfirmStatus = "pending" | "confirmed" | "revised" | "expired";
export type BuyerDecision = "accepted" | "went_back" | "walked";
export type RevisionReasonCode = keyof typeof REVISION_REASONS;

/** The spec's trade_confirmation, one per invite (rfq_invites.trade_confirmation_json). */
export interface TradeConfirmation {
  v: 1;
  inviteId: string;
  quoteId: string | null;
  status: ConfirmStatus;
  basis: AppraisalBasis;
  /** allowance_prelim: the quoted number, or the midpoint of a range. */
  allowancePrelim: number;
  range: { low: number; high: number } | null;
  payoffUsed: number;
  originalConditions: { chips: string[]; hasText: boolean };
  /** allowance_final */
  allowanceFinal: number | null;
  revisionDelta: number | null;
  revisionDropPct: number | null;
  revisionReasonCode: RevisionReasonCode | null;
  revisionReasonText: string | null;
  citedConditions: string[];
  /** Set for internal review when a big drop cites none of the desk's own conditions. */
  revisionFlagged: boolean;
  firmBreach: boolean;
  confirmedWithinDeadline: boolean | null;
  buyerDecision: BuyerDecision | null;
  buyerDecidedAt: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  deadlineAt: string;
  rangeDefaulted?: boolean;
  reopenedAt?: string;
}

export type ConfirmAction =
  | { type: "confirm"; allowance?: number | string | null }
  | { type: "revise"; allowance: number | string; reasonCode?: string; reasonText?: string | null; citedConditions?: string[] }
  | { type: "accept_revised" }
  | { type: "go_back" }
  | { type: "walk" }
  | { type: "expire" }
  | { type: "reopen" };

export type ConfirmResult = { ok: true; confirmation: TradeConfirmation } | { ok: false; code: string; error: string };

export const applyConfirmAction = applyAction as (conf: TradeConfirmation | null | undefined, action: ConfirmAction, ctx?: { now?: Date | string; thresholdPct?: number }) => ConfirmResult;
export const openConfirmation = open as (i: { inviteId: string; quoteId?: string | null; appraisal: DealerTradeAppraisal | null | undefined; quoteExpiresAt?: string | null; now?: Date | string; deadlineHours?: number }) => ConfirmResult | { ok: false; code: string; error: string };
export const effectiveStatus = effStatus as (conf: TradeConfirmation | null | undefined, now?: Date | string) => ConfirmStatus | null;
export const isSettled = settled as (conf: TradeConfirmation | null | undefined, now?: Date | string) => boolean;
export const awaitingBuyer = awaiting as (conf: TradeConfirmation | null | undefined) => boolean;
export const bindingAllowance = binding as (appraisal: DealerTradeAppraisal | null | undefined, conf: TradeConfirmation | null | undefined, now?: Date | string) => (AllowanceValue & { fromConfirmation: boolean }) | null;
export const tradeAnswerProblem = answerProblem as (i: { hasTrade: boolean; appraisal: DealerTradeAppraisal | null | undefined; quoteExpiresAt?: string | null; now?: Date | string }) => string | null;
export const quoteMetrics = metrics as (conf: TradeConfirmation | null | undefined) => { trade_allowance_prelim: number; trade_allowance_final: number | null; revision_delta: number | null; revision_reason_code: string | null; basis: AppraisalBasis; confirmed_within_deadline: boolean | null } | null;
export const auditEntry = audit as (i: { rfqId: string; inviteId: string; actor: string; action: string; from?: unknown; to?: unknown; detail?: unknown; at?: Date | string }) => { rfqId: string; inviteId: string; actor: string; action: string; from: unknown; to: unknown; detail: unknown; at: string };

export interface DeskHonestyRow {
  dealerKey: string; dealerName: string; total: number; confirmed: number; revised: number; expired: number;
  pctConfirmedAsQuoted: number; pctWithinDeadline: number; avgRevisionDelta: number | null; firmBreaches: number; flaggedForReview: number; medianTimeToConfirmMs: number | null;
}
export const deskHonestyRollup = rollup as (rows: Array<{ dealerKey?: string; dealerName: string; confirmation: TradeConfirmation | null | undefined }>, now?: Date | string) => DeskHonestyRow[];

export { CONDITION_CHIPS, CONDITIONS_TEXT_KEY, DECLINE_CODES, DEFAULT_DEADLINE_HOURS, DEFAULT_THRESHOLD_PCT, GUARDRAIL_MIN_TEXT, REVISION_REASONS };
export const CONDITION_CHIP_KEYS = Object.keys(CONDITION_CHIPS) as Array<keyof typeof CONDITION_CHIPS>;
export const chipLabel = (key: string): string => (CONDITION_CHIPS as Record<string, string>)[key] ?? key;

/**
 * Desk-honesty fields are internal only (admin metrics): buyers and dealers get the confirmation without them. The quoted/final numbers,
 * reason, deadline and the buyer's decision are theirs to see; the review flag, the firm-breach flag, the drop % and the in-time stamp are not.
 */
export function publicConfirmation(conf: TradeConfirmation | null | undefined): TradeConfirmation | null {
  if (!conf) return null;
  const { revisionFlagged: _flag, firmBreach: _breach, revisionDropPct: _drop, confirmedWithinDeadline: _inTime, ...rest } = conf;
  return { ...rest, revisionFlagged: false, firmBreach: false, revisionDropPct: null, confirmedWithinDeadline: null };
}

// ---- config -----------------------------------------------------------------
const positive = (raw: string | undefined, fallback: number): number => {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** TRADE_REVISION_THRESHOLD_PCT (default 10) and TRADE_CONFIRM_DEADLINE_HOURS (default 24). Server-side; sent to the deals box with each action. */
export function tradeConfirmConfig(env: Record<string, string | undefined> = process.env): { thresholdPct: number; deadlineHours: number } {
  return { thresholdPct: positive(env.TRADE_REVISION_THRESHOLD_PCT, DEFAULT_THRESHOLD_PCT), deadlineHours: positive(env.TRADE_CONFIRM_DEADLINE_HOURS, DEFAULT_DEADLINE_HOURS) };
}

// ---- reading a request ------------------------------------------------------
/**
 * The appraisal a card should price on. Once the confirm step is final, the final number replaces the quoted one (a single
 * number, whatever the quote was). While it is pending, or after the buyer went back from a revision, the original stands:
 * other desks' numbers, and this one's, are never rewritten by a revision the buyer has not accepted.
 */
export function appraisalForCompare(appraisal: DealerTradeAppraisal | null | undefined, conf: TradeConfirmation | null | undefined, now: Date = new Date()): DealerTradeAppraisal | null {
  if (!appraisal) return null;
  const v = bindingAllowance(appraisal, conf, now);
  if (!v?.fromConfirmation) return appraisal;
  const equity = allowanceOf({ allowanceSingle: v.mid, allowanceLow: null, allowanceHigh: null });
  return { ...appraisal, allowanceSingle: v.mid, allowanceLow: null, allowanceHigh: null, equityComputed: equity ? Math.round((v.mid - (appraisal.payoffUsed || 0)) * 100) / 100 : appraisal.equityComputed };
}

/** "Revised" chip: the desk changed the number at the confirm step (accepted, waiting on the buyer, or gone back from). */
export const isRevised = (conf: TradeConfirmation | null | undefined): boolean => Boolean(conf && conf.status === "revised");

/** The desk the buyer selected whose confirm step is still open (pending, or revised and waiting on the buyer). */
export function openConfirmationOf(rfq: Pick<RfqRequest, "status" | "invites">, now: Date = new Date()): { invite: RfqInvite; confirmation: TradeConfirmation } | null {
  if (rfq.status !== "picked") return null;
  for (const invite of rfq.invites) {
    const c = invite.tradeConfirmation;
    if (!c || c.buyerDecision === "walked") continue;
    const s = effectiveStatus(c, now);
    if (s === "pending" || (s === "revised" && !c.buyerDecision)) return { invite, confirmation: c };
  }
  return null;
}

/** Pending confirmations whose deadline has passed and are not yet written as "expired": the next touch persists them. */
export function dueExpiries(rfq: Pick<RfqRequest, "invites">, now: Date = new Date()): RfqInvite[] {
  return rfq.invites.filter((i) => i.tradeConfirmation?.status === "pending" && effectiveStatus(i.tradeConfirmation, now) === "expired");
}

export const REVISION_REASON_LIST = (Object.entries(REVISION_REASONS) as Array<[RevisionReasonCode, string]>).map(([code, label]) => ({ code, label }));
export const DECLINE_CODE_LIST = (Object.entries(DECLINE_CODES) as Array<[string, string]>).map(([code, label]) => ({ code, label }));
