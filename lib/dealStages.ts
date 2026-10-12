/**
 * The Cash / Finance deal stages as the app sees them. The rules are one module shared with the deals server
 * (scrapers/lightsail-crawler/src/dealStages.js): out-the-door price -> trade-in (only with a trade) -> payment
 * (the trade value is negotiated until both agree) -> payment (cash, the buyer's own financing, or a dealer financing offer
 * negotiated the same way) -> final acceptance, which is the only moment the buyer's contact details are released, to the
 * winning dealer. Each stage locks before the next opens; either side may walk at any stage; nothing binds anyone.
 * Copy rule: "a request, not a bid".
 */
import {
  applyStageAction as applyAction,
  CREDIT_RANGES,
  currentStage,
  FINANCE_TERM_OPTIONS,
  financeMath as finMath,
  finalSummary as summarize,
  initialStageState as initialState,
  liveTrueOtd as liveOtd,
  MAX_APR,
  monthlyPayment,
  stageForDealer as forDealer,
  stageProgress as progress,
  TRADE_TAX_CREDIT_STATES,
  trueOtdFor,
} from "../scrapers/lightsail-crawler/src/dealStages.js";
import type { RfqInvite, RfqRequest } from "./rfq";

export type StageId = "otd" | "trade" | "payment" | "final";
export type DealStageName = StageId | "closed" | "walked";
export type PaymentMethod = "cash" | "own_financing" | "dealer_finance";
export type CreditRange = "excellent" | "good" | "fair" | "building" | "not_sure";
export type StageActor = "buyer" | "dealer";

export interface TradeOffer { value: number; at: string; basis: "preliminary" | "firm"; revised: boolean; held?: boolean }
export interface FinanceQuoteStage {
  apr: number; termMonths: number; monthly: number; amountFinanced: number; downPayment: number; trueOtd: number; lenderName: string | null;
  totalPaid?: number; interest?: number; revised?: boolean; held?: boolean; at: string;
}
export interface FinanceCounterStage { apr: number; termMonths: number; monthly: number; amountFinanced: number; note: string | null; at: string }
export interface BuyerContact { name: string | null; email: string; phone: string | null; zip: string | null }
export interface FinalSummary {
  otd: number | null; tradeValue: number | null; payoff: number; trueOtd: number | null; method: PaymentMethod | null; lenderName: string | null;
  downPayment: number | null; apr: number | null; termMonths: number | null; monthly: number | null; amountFinanced: number | null;
}
export interface DealStageState {
  v: 1 | 2;
  path: "cash_finance";
  stage: DealStageName;
  tradeInExpected: boolean;
  otd: { status: "open" | "locked"; amount: number | null; lockedAt: string | null; lockedBy: StageActor | null };
  trade: {
    status: "pending" | "open" | "locked" | "skipped";
    offer: TradeOffer | null;
    counter: { value: number; at: string; note: string | null } | null;
    /** Whose move it is while the trade value is being negotiated (null before the first offer and once locked). */
    turn?: StageActor | null;
    rounds?: number;
    history?: Array<{ by: StageActor; kind: string; value: number; at: string }>;
    /** The payoff the buyer stated on the trade-in; added to the true out-the-door. */
    payoff?: number;
    value: number | null;
    taxSavings: number | null;
    taxCreditState?: boolean;
    lockedAt: string | null;
  };
  payment: {
    status: "pending" | "open" | "agreed" | "closed";
    method: PaymentMethod | null;
    lenderName?: string | null;
    outsideFinancing: boolean;
    creditRange?: CreditRange | null;
    downPayment: number | null;
    preferredTermMonths?: number | null;
    financeRequestedAt: string | null;
    financeQuote: FinanceQuoteStage | null;
    financeCounter?: FinanceCounterStage | null;
    financeTurn?: StageActor | null;
    financeHistory?: Array<Record<string, unknown>>;
    agreedAt?: string | null;
    closedAt: string | null;
  };
  final?: { status: "pending" | "accepted"; summary: FinalSummary | null; acceptedAt: string | null };
  /** The buyer's details, present only on the winning dealer's deal after "Accept final deal". Never on any other deal. */
  release?: { at: string; contact: BuyerContact } | null;
  trueOtd: number | null;
  walk: { by: StageActor; atStage: DealStageName; at: string; reason: string | null } | null;
  log: Array<Record<string, unknown>>;
}

export type StageActionType =
  | "accept_otd" | "add_trade" | "skip_trade" | "trade_offer" | "trade_hold" | "trade_counter" | "trade_accept" | "trade_accept_counter"
  | "choose_cash" | "choose_own_financing" | "request_finance" | "finance_quote" | "finance_hold" | "finance_counter" | "finance_accept"
  | "finance_accept_counter" | "change_payment" | "accept_final" | "walk";
export interface StageAction {
  type: StageActionType;
  value?: number | string;
  basis?: "preliminary" | "firm";
  note?: string;
  downPayment?: number | string;
  termMonths?: number | string | null;
  outsideFinancing?: boolean;
  creditRange?: CreditRange | null;
  apr?: number | string;
  monthly?: number | string;
  amountFinanced?: number | string;
  lenderName?: string;
  reason?: string;
}
export type StageResult = { ok: true; state: DealStageState } | { ok: false; code: string; error: string };
export interface StageContext { otdAmount?: number | null; taxRate?: number | null; state?: string | null; hasTradeInOnFile?: boolean; tradePayoff?: number | null; buyerContact?: Partial<BuyerContact> | null; now?: Date }

export const applyStageAction = applyAction as (prev: DealStageState | null, action: StageAction & { actor: StageActor }, ctx?: StageContext) => StageResult;
export const initialStageState = initialState as (opts?: { tradeInExpected?: boolean | null }) => DealStageState;
export const liveTrueOtd = liveOtd as (state: DealStageState | null) => { locked: number | null; ifOffer: number | null; ifCounter: number | null; payoff: number } | null;
export const financeMath = finMath as (i: { trueOtd: number; downPayment: number | null; apr: number; termMonths: number }) => { amountFinanced: number; monthly: number; totalPaid: number; interest: number } | null;
export const finalSummary = summarize as (state: DealStageState) => FinalSummary;
/** What a dealer may see of a deal state: the buyer's released details only on the winning, finally accepted deal. */
export const stageForDealer = forDealer as (state: DealStageState | null, opts?: { notSelected?: boolean }) => DealStageState | null;
export interface StageStep { id: StageId; label: string; state: "upcoming" | "current" | "locked" | "skipped" | "walked"; value: number | null }
export const stageProgress = progress as (state: DealStageState | null) => StageStep[];
export { CREDIT_RANGES, currentStage, FINANCE_TERM_OPTIONS, MAX_APR, monthlyPayment, TRADE_TAX_CREDIT_STATES, trueOtdFor };
export const CREDIT_RANGE_LABELS: Record<CreditRange, string> = { excellent: "Excellent (740+)", good: "Good (680-739)", fair: "Fair (620-679)", building: "Building (under 620)", not_sure: "Not sure" };
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { cash: "Paying cash", own_financing: "Bringing my own financing", dealer_finance: "Financing through the dealer" };

/** A request uses the staged flow when the buyer chose Cash / Finance (new requests carry `staged`). */
export function isStagedRfq(rfq: Pick<RfqRequest, "quotePrefs" | "leasePrefs"> | null | undefined): boolean {
  return Boolean(rfq && !rfq.leasePrefs && rfq.quotePrefs?.quoteType === "cash" && rfq.quotePrefs.staged === true);
}

/** This desk's stage state, or the starting state when nothing has happened yet; null for requests outside the staged flow. */
export function stageOf(rfq: Pick<RfqRequest, "quotePrefs" | "leasePrefs" | "tradeInExpected">, invite: Pick<RfqInvite, "stage">): DealStageState | null {
  if (!isStagedRfq(rfq)) return null;
  return invite.stage ?? initialStageState({ tradeInExpected: Boolean(rfq.tradeInExpected) });
}

export const STAGE_LABELS: Record<StageId, string> = { otd: "Out-the-door price", trade: "Trade-in", payment: "Payment", final: "Final deal" };

/** One short line for compare cards and the tracker: where this dealer is, in plain words. */
export function stageSummary(state: DealStageState | null, notSelected = false): string {
  if (!state) return "";
  if (notSelected && state.stage !== "walked") return "Not selected: you chose another dealer";
  if (state.stage === "walked") return `Walked away at ${state.walk ? STAGE_LABELS[state.walk.atStage as StageId] ?? "an earlier stage" : "an earlier stage"}`;
  if (state.stage === "closed") return "Deal accepted: the dealer has your details";
  if (state.stage === "otd") return "Stage 1 of 4: out-the-door price";
  if (state.stage === "trade") {
    const t = state.trade;
    if (!t.offer) return "Stage 2: waiting for the dealer's trade-in offer";
    return t.turn === "dealer" ? "Stage 2: your trade counter is with the dealer" : t.counter ? "Stage 2: dealer answered your counter" : "Stage 2: trade-in offer to review";
  }
  if (state.stage === "final") return "Stage 4: review and accept the final deal";
  const p = state.payment;
  if (p.method === "dealer_finance" && p.financeRequestedAt) {
    if (!p.financeQuote) return "Stage 3: waiting for the dealer's financing offer";
    return p.financeTurn === "dealer" ? "Stage 3: your APR counter is with the dealer" : "Stage 3: financing offer to review";
  }
  return "Stage 3: pay cash, bring your own financing, or get a dealer offer";
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
