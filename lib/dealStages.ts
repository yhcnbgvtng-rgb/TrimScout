/**
 * The Cash / Finance deal stages as the app sees them. The rules are one module shared with the deals server
 * (scrapers/lightsail-crawler/src/dealStages.js): out-the-door price -> trade-in (only with a trade) -> payment
 * (pay cash, or the dealer quotes financing). Each stage locks before the next opens; either side may walk at any
 * stage; nothing binds anyone. Copy rule: "a request, not a bid".
 */
import {
  applyStageAction as applyAction,
  currentStage,
  FINANCE_TERM_OPTIONS,
  initialStageState as initialState,
  MAX_APR,
  monthlyPayment,
  stageProgress as progress,
  TRADE_TAX_CREDIT_STATES,
} from "../scrapers/lightsail-crawler/src/dealStages.js";
import type { RfqInvite, RfqRequest } from "./rfq";

export type StageId = "otd" | "trade" | "payment";
export type DealStageName = StageId | "closed" | "walked";
export type StageActor = "buyer" | "dealer";

export interface TradeOffer { value: number; at: string; basis: "preliminary" | "firm"; revised: boolean }
export interface FinanceQuoteStage { apr: number; termMonths: number; monthly: number; amountFinanced: number; downPayment: number; trueOtd: number; lenderName: string | null; at: string }
export interface DealStageState {
  v: 1;
  path: "cash_finance";
  stage: DealStageName;
  tradeInExpected: boolean;
  otd: { status: "open" | "locked"; amount: number | null; lockedAt: string | null; lockedBy: StageActor | null };
  trade: {
    status: "pending" | "open" | "locked" | "skipped";
    offer: TradeOffer | null;
    counter: { value: number; at: string; note: string | null } | null;
    counterUsed: boolean;
    counterAnswered?: boolean;
    value: number | null;
    taxSavings: number | null;
    taxCreditState?: boolean;
    lockedAt: string | null;
  };
  payment: {
    status: "pending" | "open" | "closed";
    method: "cash" | "finance" | null;
    outsideFinancing: boolean;
    downPayment: number | null;
    preferredTermMonths?: number | null;
    financeRequestedAt: string | null;
    financeQuote: FinanceQuoteStage | null;
    closedAt: string | null;
  };
  trueOtd: number | null;
  walk: { by: StageActor; atStage: DealStageName; at: string; reason: string | null } | null;
  log: Array<Record<string, unknown>>;
}

export type StageActionType =
  | "accept_otd" | "add_trade" | "skip_trade" | "trade_offer" | "trade_counter" | "trade_accept" | "trade_accept_counter"
  | "choose_cash" | "request_finance" | "finance_quote" | "finance_accept" | "walk";
export interface StageAction {
  type: StageActionType;
  value?: number | string;
  basis?: "preliminary" | "firm";
  note?: string;
  downPayment?: number | string;
  termMonths?: number | string | null;
  outsideFinancing?: boolean;
  apr?: number | string;
  lenderName?: string;
  reason?: string;
}
export type StageResult = { ok: true; state: DealStageState } | { ok: false; code: string; error: string };
export interface StageContext { otdAmount?: number | null; taxRate?: number | null; state?: string | null; hasTradeInOnFile?: boolean; now?: Date }

export const applyStageAction = applyAction as (prev: DealStageState | null, action: StageAction & { actor: StageActor }, ctx?: StageContext) => StageResult;
export const initialStageState = initialState as (opts?: { tradeInExpected?: boolean | null }) => DealStageState;
export interface StageStep { id: StageId; label: string; state: "upcoming" | "current" | "locked" | "skipped" | "walked"; value: number | null }
export const stageProgress = progress as (state: DealStageState | null) => StageStep[];
export { currentStage, FINANCE_TERM_OPTIONS, MAX_APR, monthlyPayment, TRADE_TAX_CREDIT_STATES };

/** A request uses the staged flow when the buyer chose Cash / Finance (new requests carry `staged`). */
export function isStagedRfq(rfq: Pick<RfqRequest, "quotePrefs" | "leasePrefs"> | null | undefined): boolean {
  return Boolean(rfq && !rfq.leasePrefs && rfq.quotePrefs?.quoteType === "cash" && rfq.quotePrefs.staged === true);
}

/** This desk's stage state, or the starting state when nothing has happened yet; null for requests outside the staged flow. */
export function stageOf(rfq: Pick<RfqRequest, "quotePrefs" | "leasePrefs" | "tradeInExpected">, invite: Pick<RfqInvite, "stage">): DealStageState | null {
  if (!isStagedRfq(rfq)) return null;
  return invite.stage ?? initialStageState({ tradeInExpected: Boolean(rfq.tradeInExpected) });
}

export const STAGE_LABELS: Record<StageId, string> = { otd: "Out-the-door price", trade: "Trade-in", payment: "Payment" };

/** One short line for compare cards and the tracker: where this dealer is, in plain words. */
export function stageSummary(state: DealStageState | null, notSelected = false): string {
  if (!state) return "";
  if (notSelected && state.stage !== "walked") return "Not selected: you chose another dealer";
  if (state.stage === "walked") return `Walked away at ${state.walk ? STAGE_LABELS[state.walk.atStage as StageId] ?? "an earlier stage" : "an earlier stage"}`;
  if (state.stage === "closed") return state.payment.method === "finance" ? "Closed: financing accepted" : "Closed: paying cash";
  if (state.stage === "otd") return "Stage 1 of 3: out-the-door price";
  if (state.stage === "trade") return state.trade.offer ? (state.trade.counter && !state.trade.counterAnswered ? "Stage 2: your trade counter is with the dealer" : "Stage 2: trade-in offer to review") : "Stage 2: waiting for the dealer's trade-in offer";
  return state.payment.financeRequestedAt ? (state.payment.financeQuote ? "Stage 3: financing quote to review" : "Stage 3: waiting for the dealer's financing quote") : "Stage 3: pay cash or get financing";
}

/**
 * New requests only go out staged when the deals box can run the stages (FEATURE_DEAL_STAGES). Otherwise the `staged` marker
 * is dropped and "Cash / Finance" is the original single cash sheet, so no request ever depends on an endpoint that isn't live.
 */
export function gateStagedPrefs<T extends { quoteType: string } | null>(prefs: T, stagesEnabled: boolean): T {
  if (!prefs || stagesEnabled || !("staged" in (prefs as object))) return prefs;
  const { staged: _staged, ...rest } = prefs as unknown as Record<string, unknown>;
  return rest as unknown as T;
}
