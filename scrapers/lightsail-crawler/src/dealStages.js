// The Cash / Finance deal stages for one dealer on one quote request.
//
//   1. otd      the dealer quotes an itemized out-the-door price; counter / accept as always.
//               Locks when either side accepts. No finance terms exist yet.
//   2. trade    only when the buyer said a trade-in is coming. The dealer offers a trade value, the buyer may
//               counter ONCE, then accepts or walks. Locks as: true OTD = agreed OTD - trade value.
//   3. payment  "Pay cash" closes the deal at the true OTD. "Get financing" has the dealer quote APR + term on the
//               true OTD minus the down payment (the monthly is computed here, never typed). Accepting closes it.
//
// Every stage locks before the next opens, and either side may walk at any stage. Nothing here binds anyone:
// it records a request and the numbers both sides have agreed to so far. "A request, not a bid."
//
// Pure and dependency-free, so the deals server (ESM, plain node) and the Next app (lib/dealStages.ts) run the
// exact same rules. State is stored as JSON in rfq_invites.stage_json; every transition returns a NEW state.

export const STAGES = ["otd", "trade", "payment"];
export const TERMINAL = ["closed", "walked"];
export const FINANCE_TERM_OPTIONS = [24, 36, 48, 60, 72, 84];
export const MAX_APR = 40;

/**
 * States where a trade-in lowers the sales tax charged on the purchase (the tax applies to price minus trade).
 * Deliberately short and conservative: outside this list the app says the effect depends on the state and the
 * dealer confirms it, rather than promising a saving. Review per state before extending.
 */
export const TRADE_TAX_CREDIT_STATES = ["CO", "FL", "GA", "IL", "NC", "NJ", "NY", "OH", "PA", "TX", "WA"];

const r2 = (n) => Math.round(n * 100) / 100;
const money = (v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? r2(n) : null;
};
const iso = (d) => (d instanceof Date ? d : new Date(d || Date.now())).toISOString();

/** Selling price + itemized fees & tax + add-ons - rebates for a stored cash quote (mirrors lib/usedQuote cashOutTheDoor). */
export function cashQuoteOtd(used) {
  if (!used || used.kind !== "cash" || !(used.sellingPrice >= 0)) return null;
  const sum = (xs) => (Array.isArray(xs) ? xs : []).reduce((t, x) => t + (Number.isFinite(Number(x?.amount)) ? Number(x.amount) : 0), 0);
  return r2(used.sellingPrice + sum(used.dueAtSigning) + sum(used.addOns) - sum(used.rebates));
}

/** The dealer's own effective sales-tax rate on their quote: tax lines / (price + add-ons); null when it can't be derived. */
export function quoteTaxRate(used) {
  if (!used || used.kind !== "cash") return null;
  const lines = Array.isArray(used.dueAtSigning) ? used.dueAtSigning : [];
  const tax = lines.filter((l) => /tax/i.test(String(l?.name || "")) && !/title|registr/i.test(String(l?.name || ""))).reduce((t, l) => t + (Number(l.amount) || 0), 0);
  const base = used.sellingPrice + (Array.isArray(used.addOns) ? used.addOns : []).reduce((t, a) => t + (Number(a?.amount) || 0), 0);
  return base > 0 && tax > 0 ? tax / base : null;
}

/** What the trade saves in sales tax, or null when the state doesn't credit trade-ins (or the rate is unknown). */
export function tradeTaxSavings({ tradeValue, state, taxRate }) {
  const st = String(state || "").toUpperCase();
  if (!TRADE_TAX_CREDIT_STATES.includes(st)) return null;
  if (!(tradeValue > 0) || !(taxRate > 0)) return null;
  return r2(tradeValue * taxRate);
}

/** Standard amortized payment; 0% APR is principal / term. Null for nonsense inputs. */
export function monthlyPayment(principal, apr, termMonths) {
  if (!(principal > 0) || !(termMonths > 0) || !(apr >= 0) || !Number.isFinite(apr)) return null;
  const r = apr / 100 / 12;
  return r2(r === 0 ? principal / termMonths : (principal * r) / (1 - Math.pow(1 + r, -termMonths)));
}

/** Where a deal starts. No trade-in -> the trade stage is skipped before it ever opens. */
export function initialStageState({ tradeInExpected } = {}) {
  return {
    v: 1,
    path: "cash_finance",
    stage: "otd",
    tradeInExpected: Boolean(tradeInExpected),
    otd: { status: "open", amount: null, lockedAt: null, lockedBy: null },
    trade: { status: tradeInExpected ? "pending" : "skipped", offer: null, counter: null, counterUsed: false, value: null, taxSavings: null, lockedAt: null },
    payment: { status: "pending", method: null, outsideFinancing: false, downPayment: null, financeRequestedAt: null, financeQuote: null, closedAt: null },
    trueOtd: null,
    walk: null,
    log: [],
  };
}

const fail = (code, error) => ({ ok: false, code, error });
const done = (state, at, entry) => ({ ok: true, state: { ...state, log: [...state.log, { at, ...entry }].slice(-40) } });

/** The stage the deal is "at" for display: a stage name, or closed / walked. */
export function currentStage(state) {
  return state ? state.stage : "otd";
}

/**
 * Apply one action. `ctx` = { otdAmount, taxRate, state, hasTradeInOnFile, now } where otdAmount is the dealer's current
 * quoted OTD (derived on the server from the stored quote, never from the browser).
 * Actions (actor): accept_otd (buyer|dealer), add_trade (buyer), skip_trade (buyer), trade_offer (dealer), trade_counter (buyer), trade_accept (buyer),
 * trade_accept_counter (dealer), choose_cash (buyer), request_finance (buyer), finance_quote (dealer),
 * finance_accept (buyer), walk (buyer|dealer).
 */
export function applyStageAction(prev, action, ctx = {}) {
  const state = prev || initialStageState({ tradeInExpected: false });
  const type = action?.type;
  const actor = action?.actor;
  const at = iso(ctx.now);
  if (actor !== "buyer" && actor !== "dealer") return fail("bad_actor", "Unknown actor.");

  if (TERMINAL.includes(state.stage)) return fail("closed", state.stage === "walked" ? "This deal was walked away from." : "This deal is already closed.");

  if (type === "walk") {
    const walked = { ...state, stage: "walked", walk: { by: actor, atStage: state.stage, at, reason: typeof action.reason === "string" ? action.reason.trim().slice(0, 300) || null : null } };
    return done(walked, at, { actor, type, stage: state.stage });
  }

  const only = (who) => (actor === who ? null : fail("forbidden_actor", `Only the ${who} can do that.`));

  switch (type) {
    case "accept_otd": {
      if (state.stage !== "otd") return fail("wrong_stage", "The out-the-door price is already locked.");
      const amount = money(ctx.otdAmount);
      if (!(amount > 0)) return fail("no_quote", "There is no itemized out-the-door quote to accept yet.");
      const next = { ...state, otd: { status: "locked", amount, lockedAt: at, lockedBy: actor } };
      if (state.tradeInExpected) {
        next.stage = "trade";
        next.trade = { ...state.trade, status: "open" };
      } else {
        // No trade-in: the OTD is already the true OTD, so the trade stage never opens.
        next.stage = "payment";
        next.trueOtd = amount;
        next.payment = { ...state.payment, status: "open" };
      }
      return done(next, at, { actor, type, stage: "otd", amount });
    }

    case "add_trade": {
      // After the OTD is locked the buyer may still add a trade-in (the "Add your trade-in" step). The accepted OTD stays
      // locked; the trade stage re-opens so the winning dealer can offer a value and reach the true OTD.
      const bad = only("buyer"); if (bad) return bad;
      if (state.otd.status !== "locked") return fail("wrong_stage", "Lock the out-the-door price first.");
      if (!ctx.hasTradeInOnFile) return fail("no_trade", "Add your trade-in details and photos first.");
      if (state.stage === "trade") return done({ ...state, tradeInExpected: true }, at, { actor, type, stage: "trade" });
      if (state.stage !== "payment" || state.payment.method || state.payment.financeRequestedAt || state.trade.status !== "skipped") {
        return fail("locked", "The payment step has already started, so a trade-in can't be added to this deal.");
      }
      const next = { ...state, stage: "trade", tradeInExpected: true, trueOtd: null, trade: { ...state.trade, status: "open" }, payment: { ...state.payment, status: "pending" } };
      return done(next, at, { actor, type, stage: "trade" });
    }

    case "skip_trade": {
      // The buyer said a trade-in was coming, then decided against it before any offer: carry on with no trade.
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "trade") return fail("wrong_stage", "There is no trade-in step to skip.");
      if (state.trade.offer) return fail("locked", "The dealer already made a trade offer: accept it or walk away.");
      const next = { ...state, stage: "payment", tradeInExpected: false, trueOtd: state.otd.amount, trade: { ...state.trade, status: "skipped" }, payment: { ...state.payment, status: "open" } };
      return done(next, at, { actor, type, stage: "trade" });
    }

    case "trade_offer": {
      const bad = only("dealer"); if (bad) return bad;
      if (state.stage !== "trade") return fail("wrong_stage", "The trade-in stage isn't open.");
      if (!ctx.hasTradeInOnFile) return fail("no_trade", "The buyer hasn't added the trade-in yet.");
      const value = money(action.value);
      if (value == null || value < 0) return fail("invalid", "Enter the trade value in dollars.");
      if (value > state.otd.amount) return fail("invalid", "The trade value can't be more than the out-the-door price.");
      const t = state.trade;
      // First offer, or one revised offer in answer to the buyer's counter. After that the buyer accepts or walks.
      if (t.offer && !(t.counter && !t.counterAnswered)) return fail("locked", "An offer is already on the table: the buyer can accept it or walk away.");
      const offer = { value, at, basis: action.basis === "firm" ? "firm" : "preliminary", revised: Boolean(t.offer) };
      return done({ ...state, trade: { ...t, offer, counterAnswered: Boolean(t.counter) } }, at, { actor, type, stage: "trade", value });
    }

    case "trade_counter": {
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "trade") return fail("wrong_stage", "The trade-in stage isn't open.");
      const t = state.trade;
      if (!t.offer) return fail("no_offer", "There is no trade offer to counter yet.");
      if (t.counterUsed) return fail("counter_used", "You can counter the trade value once. Accept the offer or walk away.");
      const value = money(action.value);
      if (value == null || value < 0) return fail("invalid", "Enter the trade value you want, in dollars.");
      if (value > state.otd.amount) return fail("invalid", "The trade value can't be more than the out-the-door price.");
      const counter = { value, at, note: typeof action.note === "string" ? action.note.trim().slice(0, 300) || null : null };
      return done({ ...state, trade: { ...t, counter, counterUsed: true, counterAnswered: false } }, at, { actor, type, stage: "trade", value });
    }

    case "trade_accept":
    case "trade_accept_counter": {
      if (state.stage !== "trade") return fail("wrong_stage", "The trade-in stage isn't open.");
      const t = state.trade;
      let value;
      if (type === "trade_accept") {
        const bad = only("buyer"); if (bad) return bad;
        if (!t.offer) return fail("no_offer", "There is no trade offer to accept yet.");
        if (t.counter && !t.counterAnswered) return fail("awaiting_dealer", "Your counter is with the dealer. Wait for their answer, or walk away.");
        value = t.offer.value;
      } else {
        const bad = only("dealer"); if (bad) return bad;
        if (!t.counter || t.counterAnswered) return fail("no_counter", "There is no counter to accept.");
        value = t.counter.value;
      }
      const trueOtd = r2(state.otd.amount - value);
      const taxSavings = tradeTaxSavings({ tradeValue: value, state: ctx.state, taxRate: ctx.taxRate });
      const next = {
        ...state,
        stage: "payment",
        trueOtd,
        trade: { ...t, status: "locked", value, taxSavings, taxCreditState: TRADE_TAX_CREDIT_STATES.includes(String(ctx.state || "").toUpperCase()), lockedAt: at },
        payment: { ...state.payment, status: "open" },
      };
      return done(next, at, { actor, type, stage: "trade", value, trueOtd });
    }

    case "choose_cash": {
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "Lock the out-the-door price (and trade-in) first.");
      const next = { ...state, stage: "closed", payment: { ...state.payment, status: "closed", method: "cash", closedAt: at } };
      return done(next, at, { actor, type, stage: "payment", amount: state.trueOtd });
    }

    case "request_finance": {
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "Lock the out-the-door price (and trade-in) first.");
      const down = money(action.downPayment ?? 0);
      if (down == null || down < 0) return fail("invalid", "Enter a down payment of $0 or more.");
      if (down >= state.trueOtd) return fail("invalid", "The down payment has to be less than the true out-the-door price.");
      const term = action.termMonths == null || action.termMonths === "" ? null : Number(action.termMonths);
      if (term != null && !FINANCE_TERM_OPTIONS.includes(term)) return fail("invalid", "Pick one of the standard terms.");
      const payment = {
        ...state.payment,
        downPayment: down,
        preferredTermMonths: term,
        outsideFinancing: Boolean(action.outsideFinancing),
        financeRequestedAt: at,
        // A new request clears any quote written against the old down payment.
        financeQuote: null,
      };
      return done({ ...state, payment }, at, { actor, type, stage: "payment", down });
    }

    case "finance_quote": {
      const bad = only("dealer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "The payment stage isn't open.");
      if (!state.payment.financeRequestedAt) return fail("no_request", "The buyer hasn't asked for financing.");
      const apr = Number(action.apr);
      const term = Number(action.termMonths);
      if (!Number.isFinite(apr) || apr < 0 || apr > MAX_APR) return fail("invalid", `APR must be between 0% and ${MAX_APR}%.`);
      if (!FINANCE_TERM_OPTIONS.includes(term)) return fail("invalid", "Pick one of the standard terms.");
      const amountFinanced = r2(state.trueOtd - state.payment.downPayment);
      const monthly = monthlyPayment(amountFinanced, apr, term);
      if (monthly == null) return fail("invalid", "Those terms don't produce a payment.");
      const financeQuote = { apr: Math.round(apr * 1000) / 1000, termMonths: term, monthly, amountFinanced, downPayment: state.payment.downPayment, trueOtd: state.trueOtd, lenderName: typeof action.lenderName === "string" ? action.lenderName.trim().slice(0, 80) || null : null, at };
      return done({ ...state, payment: { ...state.payment, financeQuote } }, at, { actor, type, stage: "payment", apr: financeQuote.apr, termMonths: term, monthly });
    }

    case "finance_accept": {
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "The payment stage isn't open.");
      if (!state.payment.financeQuote) return fail("no_quote", "The dealer hasn't quoted financing yet.");
      const next = { ...state, stage: "closed", payment: { ...state.payment, status: "closed", method: "finance", closedAt: at } };
      return done(next, at, { actor, type, stage: "payment", monthly: state.payment.financeQuote.monthly });
    }

    default:
      return fail("bad_action", "Unknown action.");
  }
}

/** Display-ready progress: the three steps, each upcoming / current / locked / skipped / walked, with the locked number. */
export function stageProgress(state) {
  const s = state || initialStageState({ tradeInExpected: false });
  const walkedAt = s.walk?.atStage || null;
  const stateOf = (name, lockedWhen) => {
    if (name === "trade" && s.trade.status === "skipped") return "skipped";
    if (lockedWhen) return "locked";
    if (s.stage === "walked") return walkedAt === name ? "walked" : "upcoming";
    if (s.stage === name) return "current";
    return "upcoming";
  };
  return [
    { id: "otd", label: "Out-the-door price", state: stateOf("otd", s.otd.status === "locked"), value: s.otd.amount },
    { id: "trade", label: "Trade-in", state: stateOf("trade", s.trade.status === "locked"), value: s.trade.value },
    { id: "payment", label: "Payment", state: stateOf("payment", s.payment.status === "closed"), value: s.payment.method === "finance" ? s.payment.financeQuote?.monthly ?? null : s.payment.method === "cash" ? s.trueOtd : null },
  ];
}
