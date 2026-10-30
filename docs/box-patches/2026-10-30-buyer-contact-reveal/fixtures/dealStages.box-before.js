// The Cash / Finance deal stages for one dealer on one quote request.
//
//   1. otd      the dealer quotes an itemized out-the-door price; counter / accept as always.
//               Locks when either side accepts. No finance terms exist yet.
//   2. trade    only when the buyer said a trade-in is coming. The dealer offers a trade value; the buyer accepts or
//               counters (with an optional note); the dealer accepts, revises or holds firm; and it repeats until both
//               agree. True OTD = agreed OTD - agreed trade value + any payoff.
//   3. payment  the buyer picks ONE of: pay cash, bring their own financing (optional lender name), or get a financing
//               offer from the dealer (term 36/48/60/72, optional credit range, down payment). A dealer offer is an
//               APR + term + lender; the monthly and amount financed are computed here and must match what the dealer
//               submits. The buyer accepts or counters the APR (and term); the dealer accepts, revises or holds firm;
//               repeat until agreed.
//   4. final    the buyer sees the whole deal and taps "Accept final deal". Only then are the buyer's name, email,
//               phone and ZIP released, to the winning dealer only (state.release). Nothing earlier carries them.
//
// Every stage locks before the next opens, and either side may walk at any stage. Nothing here binds anyone:
// it records a request and the numbers both sides have agreed to so far. "A request, not a bid."
//
// Pure and dependency-free, so the deals server (ESM, plain node) and the Next app (lib/dealStages.ts) run the
// exact same rules. State is stored as JSON in rfq_invites.stage_json; every transition returns a NEW state.

export const STAGES = ["otd", "trade", "payment", "final"];
export const TERMINAL = ["closed", "walked"];
export const FINANCE_TERM_OPTIONS = [36, 48, 60, 72];
export const CREDIT_RANGES = ["excellent", "good", "fair", "building", "not_sure"];
export const PAYMENT_METHODS = ["cash", "own_financing", "dealer_finance"];
export const MAX_APR = 40;
const HISTORY_CAP = 20;

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


const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);
const pushHistory = (list, entry) => [...(Array.isArray(list) ? list : []), entry].slice(-HISTORY_CAP);

/** True OTD = agreed OTD - agreed trade value + any payoff the dealer pays off for the buyer. */
export function trueOtdFor(otd, tradeValue, payoff) {
  return r2(otd - (tradeValue || 0) + (payoff > 0 ? payoff : 0));
}

/**
 * The number the buyer would land on if the trade were agreed right now at the offer (and at their counter), for the live
 * "true OTD" line while the trade is still being negotiated. Null parts mean there is nothing to project yet.
 */
export function liveTrueOtd(state) {
  if (!state || state.otd?.amount == null) return null;
  const t = state.trade || {};
  const payoff = t.payoff || 0;
  return {
    locked: state.trueOtd,
    ifOffer: t.offer ? trueOtdFor(state.otd.amount, t.offer.value, payoff) : null,
    ifCounter: t.counter && t.turn === "dealer" ? trueOtdFor(state.otd.amount, t.counter.value, payoff) : null,
    payoff,
  };
}

/** The monthly and amount financed for a deal, computed from the numbers (never typed). Null for nonsense. */
export function financeMath({ trueOtd, downPayment, apr, termMonths }) {
  const amountFinanced = r2(trueOtd - (downPayment || 0));
  const monthly = monthlyPayment(amountFinanced, apr, termMonths);
  if (monthly == null) return null;
  return { amountFinanced, monthly, totalPaid: r2(monthly * termMonths), interest: r2(monthly * termMonths - amountFinanced) };
}

/** Where a deal starts. No trade-in -> the trade stage is skipped before it ever opens. */
export function initialStageState({ tradeInExpected } = {}) {
  return {
    v: 2,
    path: "cash_finance",
    stage: "otd",
    tradeInExpected: Boolean(tradeInExpected),
    otd: { status: "open", amount: null, lockedAt: null, lockedBy: null },
    trade: { status: tradeInExpected ? "pending" : "skipped", offer: null, counter: null, turn: null, rounds: 0, history: [], payoff: 0, value: null, taxSavings: null, lockedAt: null },
    payment: {
      status: "pending", method: null, lenderName: null, outsideFinancing: false, creditRange: null, downPayment: null, preferredTermMonths: null,
      financeRequestedAt: null, financeQuote: null, financeCounter: null, financeTurn: null, financeHistory: [], agreedAt: null, closedAt: null,
    },
    final: { status: "pending", summary: null, acceptedAt: null },
    release: null,
    trueOtd: null,
    walk: null,
    log: [],
  };
}

const fail = (code, error) => ({ ok: false, code, error });
const done = (state, at, entry) => ({ ok: true, state: { ...state, log: [...state.log, { at, ...entry }].slice(-60) } });

/** The stage the deal is "at" for display: a stage name, or closed / walked. */
export function currentStage(state) {
  return state ? state.stage : "otd";
}

/** Everything the buyer is about to accept, from the numbers on the state (what the final screen and the email show). */
export function finalSummary(state) {
  const p = state.payment;
  const q = p.financeQuote;
  return {
    otd: state.otd.amount,
    tradeValue: state.trade.value,
    payoff: state.trade.payoff || 0,
    trueOtd: state.trueOtd,
    method: p.method,
    lenderName: p.method === "dealer_finance" ? q?.lenderName ?? null : p.lenderName,
    downPayment: p.method === "dealer_finance" ? p.downPayment : null,
    apr: p.method === "dealer_finance" ? q?.apr ?? null : null,
    termMonths: p.method === "dealer_finance" ? q?.termMonths ?? null : null,
    monthly: p.method === "dealer_finance" ? q?.monthly ?? null : null,
    amountFinanced: p.method === "dealer_finance" ? q?.amountFinanced ?? null : null,
  };
}

/** What a dealer may see of a deal state: the buyer's released details only on the winning, finally accepted deal. */
export function stageForDealer(state, { notSelected = false } = {}) {
  if (!state) return state;
  const accepted = !notSelected && state.stage === "closed" && state.final?.status === "accepted" && state.release;
  if (accepted) return state;
  return { ...state, release: null };
}

const cleanContact = (c) => {
  if (!c || typeof c !== "object") return null;
  const email = text(c.email, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { name: text(c.name, 120), email, phone: text(c.phone, 40), zip: text(c.zip, 10) };
};

const toAgreedPayment = (state, at, extra) => ({
  ...state,
  stage: "final",
  payment: { ...state.payment, ...extra, status: "agreed", agreedAt: at, financeTurn: null },
  final: { status: "pending", summary: null, acceptedAt: null },
});

/**
 * Apply one action. `ctx` = { otdAmount, taxRate, state, hasTradeInOnFile, tradePayoff, buyerContact, now } where otdAmount is the
 * dealer's current quoted OTD and tradePayoff the buyer's stated payoff (both derived on the server from stored data, never
 * from the browser); buyerContact is only read by accept_final.
 * Actions (actor): accept_otd (buyer|dealer), add_trade (buyer), skip_trade (buyer), trade_offer (dealer), trade_hold (dealer),
 * trade_counter (buyer), trade_accept (buyer), trade_accept_counter (dealer), choose_cash (buyer), choose_own_financing (buyer),
 * request_finance (buyer), finance_quote (dealer), finance_hold (dealer), finance_counter (buyer), finance_accept (buyer),
 * finance_accept_counter (dealer), change_payment (buyer), accept_final (buyer), walk (buyer|dealer).
 */
export function applyStageAction(prev, action, ctx = {}) {
  const state = prev || initialStageState({ tradeInExpected: false });
  const type = action?.type;
  const actor = action?.actor;
  const at = iso(ctx.now);
  if (actor !== "buyer" && actor !== "dealer") return fail("bad_actor", "Unknown actor.");

  if (TERMINAL.includes(state.stage)) return fail("closed", state.stage === "walked" ? "This deal was walked away from." : "This deal is already closed.");

  if (type === "walk") {
    const walked = { ...state, stage: "walked", walk: { by: actor, atStage: state.stage, at, reason: text(action.reason, 300) } };
    return done(walked, at, { actor, type, stage: state.stage });
  }

  const only = (who) => (actor === who ? null : fail("forbidden_actor", `Only the ${who} can do that.`));
  const payoffNow = () => { const p = money(ctx.tradePayoff); return p != null && p > 0 ? p : 0; };

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
      if (state.trade.offer) return fail("locked", "The dealer already made a trade offer: accept it, counter it or walk away.");
      const next = { ...state, stage: "payment", tradeInExpected: false, trueOtd: state.otd.amount, trade: { ...state.trade, status: "skipped" }, payment: { ...state.payment, status: "open" } };
      return done(next, at, { actor, type, stage: "trade" });
    }

    case "trade_offer": {
      // The first offer, or a revised one in answer to the buyer's counter. After that the buyer accepts or counters again.
      const bad = only("dealer"); if (bad) return bad;
      if (state.stage !== "trade") return fail("wrong_stage", "The trade-in stage isn't open.");
      if (!ctx.hasTradeInOnFile) return fail("no_trade", "The buyer hasn't added the trade-in yet.");
      const value = money(action.value);
      if (value == null || value < 0) return fail("invalid", "Enter the trade value in dollars.");
      if (value > state.otd.amount) return fail("invalid", "The trade value can't be more than the out-the-door price.");
      const t = state.trade;
      if (t.offer && t.turn !== "dealer") return fail("locked", "An offer is already with the buyer: they can accept it, counter it or walk away.");
      const offer = { value, at, basis: action.basis === "firm" ? "firm" : "preliminary", revised: Boolean(t.offer), held: false };
      const trade = { ...t, offer, turn: "buyer", payoff: payoffNow(), rounds: t.rounds + 1, history: pushHistory(t.history, { by: "dealer", kind: t.offer ? "revise" : "offer", value, at }) };
      return done({ ...state, trade }, at, { actor, type, stage: "trade", value });
    }

    case "trade_hold": {
      const bad = only("dealer"); if (bad) return bad;
      if (state.stage !== "trade") return fail("wrong_stage", "The trade-in stage isn't open.");
      const t = state.trade;
      if (!t.offer || t.turn !== "dealer" || !t.counter) return fail("no_counter", "There is no counter to answer.");
      const trade = { ...t, offer: { ...t.offer, held: true, at }, turn: "buyer", rounds: t.rounds + 1, history: pushHistory(t.history, { by: "dealer", kind: "hold", value: t.offer.value, at }) };
      return done({ ...state, trade }, at, { actor, type, stage: "trade", value: t.offer.value });
    }

    case "trade_counter": {
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "trade") return fail("wrong_stage", "The trade-in stage isn't open.");
      const t = state.trade;
      if (!t.offer) return fail("no_offer", "There is no trade offer to counter yet.");
      if (t.turn !== "buyer") return fail("awaiting_dealer", "Your counter is with the dealer. Wait for their answer, or walk away.");
      const value = money(action.value);
      if (value == null || value < 0) return fail("invalid", "Enter the trade value you want, in dollars.");
      if (value > state.otd.amount) return fail("invalid", "The trade value can't be more than the out-the-door price.");
      if (value <= t.offer.value) return fail("invalid", "A counter has to be higher than the dealer's offer. Accept the offer instead.");
      const counter = { value, at, note: text(action.note, 300) };
      const trade = { ...t, counter, turn: "dealer", rounds: t.rounds + 1, history: pushHistory(t.history, { by: "buyer", kind: "counter", value, at }) };
      return done({ ...state, trade }, at, { actor, type, stage: "trade", value });
    }

    case "trade_accept":
    case "trade_accept_counter": {
      if (state.stage !== "trade") return fail("wrong_stage", "The trade-in stage isn't open.");
      const t = state.trade;
      let value;
      if (type === "trade_accept") {
        const bad = only("buyer"); if (bad) return bad;
        if (!t.offer) return fail("no_offer", "There is no trade offer to accept yet.");
        if (t.turn !== "buyer") return fail("awaiting_dealer", "Your counter is with the dealer. Wait for their answer, or walk away.");
        value = t.offer.value;
      } else {
        const bad = only("dealer"); if (bad) return bad;
        if (!t.counter || t.turn !== "dealer") return fail("no_counter", "There is no counter to accept.");
        value = t.counter.value;
      }
      const payoff = t.payoff || 0;
      const trueOtd = trueOtdFor(state.otd.amount, value, payoff);
      const taxSavings = tradeTaxSavings({ tradeValue: value, state: ctx.state, taxRate: ctx.taxRate });
      const next = {
        ...state,
        stage: "payment",
        trueOtd,
        trade: {
          ...t, status: "locked", value, turn: null, taxSavings, taxCreditState: TRADE_TAX_CREDIT_STATES.includes(String(ctx.state || "").toUpperCase()), lockedAt: at,
          history: pushHistory(t.history, { by: actor, kind: "accept", value, at }),
        },
        payment: { ...state.payment, status: "open" },
      };
      return done(next, at, { actor, type, stage: "trade", value, payoff, trueOtd });
    }

    case "choose_cash":
    case "choose_own_financing": {
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "Lock the out-the-door price (and trade-in) first.");
      const cash = type === "choose_cash";
      const extra = cash
        ? { method: "cash", lenderName: null, outsideFinancing: false, financeRequestedAt: null, financeQuote: null, financeCounter: null, downPayment: null }
        : { method: "own_financing", lenderName: text(action.lenderName, 80), outsideFinancing: true, financeRequestedAt: null, financeQuote: null, financeCounter: null, downPayment: null };
      return done(toAgreedPayment(state, at, extra), at, { actor, type, stage: "payment", amount: state.trueOtd });
    }

    case "request_finance": {
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "Lock the out-the-door price (and trade-in) first.");
      const down = money(action.downPayment ?? 0);
      if (down == null || down < 0) return fail("invalid", "Enter a down payment of $0 or more.");
      if (down >= state.trueOtd) return fail("invalid", "The down payment has to be less than the true out-the-door price.");
      const term = action.termMonths == null || action.termMonths === "" ? null : Number(action.termMonths);
      if (term != null && !FINANCE_TERM_OPTIONS.includes(term)) return fail("invalid", "Pick 36, 48, 60 or 72 months.");
      const credit = action.creditRange == null || action.creditRange === "" ? null : String(action.creditRange);
      if (credit != null && !CREDIT_RANGES.includes(credit)) return fail("invalid", "Pick one of the credit ranges.");
      const payment = {
        ...state.payment,
        method: "dealer_finance",
        downPayment: down,
        preferredTermMonths: term,
        creditRange: credit,
        outsideFinancing: Boolean(action.outsideFinancing),
        lenderName: null,
        financeRequestedAt: at,
        // A new request clears any quote or counter written against the old down payment.
        financeQuote: null,
        financeCounter: null,
        financeTurn: "dealer",
        financeHistory: [],
      };
      return done({ ...state, payment }, at, { actor, type, stage: "payment", down });
    }

    case "finance_quote": {
      // The first quote, or a revised one in answer to the buyer's counter.
      const bad = only("dealer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "The payment stage isn't open.");
      const p = state.payment;
      if (p.method !== "dealer_finance" || !p.financeRequestedAt) return fail("no_request", "The buyer hasn't asked for a financing offer.");
      if (p.financeTurn !== "dealer") return fail("locked", "Your offer is with the buyer: they can accept it, counter it or walk away.");
      const apr = Number(action.apr);
      const term = Number(action.termMonths);
      if (action.apr == null || action.apr === "" || !Number.isFinite(apr) || apr < 0 || apr > MAX_APR) return fail("invalid", `APR must be between 0% and ${MAX_APR}%.`);
      if (!FINANCE_TERM_OPTIONS.includes(term)) return fail("invalid", "Pick 36, 48, 60 or 72 months.");
      const lenderName = text(action.lenderName, 80);
      if (!lenderName) return fail("invalid", "Name the lender.");
      const m = financeMath({ trueOtd: state.trueOtd, downPayment: p.downPayment, apr, termMonths: term });
      if (!m) return fail("invalid", "Those terms don't produce a payment.");
      // The payment math has to match the numbers: whatever the dealer typed for the monthly / amount financed is checked, not trusted.
      const typedMonthly = action.monthly == null || action.monthly === "" ? null : money(action.monthly);
      const typedFinanced = action.amountFinanced == null || action.amountFinanced === "" ? null : money(action.amountFinanced);
      if (typedFinanced != null && Math.abs(typedFinanced - m.amountFinanced) > 0.005) return fail("math_mismatch", `Amount financed should be ${m.amountFinanced.toFixed(2)} (true out-the-door ${state.trueOtd.toFixed(2)} less ${p.downPayment.toFixed(2)} down).`);
      if (typedMonthly != null && Math.abs(typedMonthly - m.monthly) > 0.01) return fail("math_mismatch", `At ${apr}% for ${term} months the payment is ${m.monthly.toFixed(2)}, not ${typedMonthly.toFixed(2)}.`);
      const financeQuote = {
        apr: Math.round(apr * 1000) / 1000, termMonths: term, monthly: m.monthly, amountFinanced: m.amountFinanced, downPayment: p.downPayment,
        trueOtd: state.trueOtd, lenderName, totalPaid: m.totalPaid, interest: m.interest, revised: Boolean(p.financeQuote), held: false, at,
      };
      const payment = { ...p, financeQuote, financeTurn: "buyer", financeHistory: pushHistory(p.financeHistory, { by: "dealer", kind: p.financeQuote ? "revise" : "offer", apr: financeQuote.apr, termMonths: term, monthly: m.monthly, at }) };
      return done({ ...state, payment }, at, { actor, type, stage: "payment", apr: financeQuote.apr, termMonths: term, monthly: m.monthly });
    }

    case "finance_hold": {
      const bad = only("dealer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "The payment stage isn't open.");
      const p = state.payment;
      if (!p.financeQuote || p.financeTurn !== "dealer" || !p.financeCounter) return fail("no_counter", "There is no counter to answer.");
      const financeQuote = { ...p.financeQuote, held: true, at };
      const payment = { ...p, financeQuote, financeTurn: "buyer", financeHistory: pushHistory(p.financeHistory, { by: "dealer", kind: "hold", apr: financeQuote.apr, termMonths: financeQuote.termMonths, monthly: financeQuote.monthly, at }) };
      return done({ ...state, payment }, at, { actor, type, stage: "payment", apr: financeQuote.apr, termMonths: financeQuote.termMonths });
    }

    case "finance_counter": {
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "The payment stage isn't open.");
      const p = state.payment;
      if (!p.financeQuote) return fail("no_quote", "The dealer hasn't made a financing offer yet.");
      if (p.financeTurn !== "buyer") return fail("awaiting_dealer", "Your counter is with the dealer. Wait for their answer, or walk away.");
      const apr = Number(action.apr);
      if (action.apr == null || action.apr === "" || !Number.isFinite(apr) || apr < 0 || apr > MAX_APR) return fail("invalid", `APR must be between 0% and ${MAX_APR}%.`);
      const term = action.termMonths == null || action.termMonths === "" ? p.financeQuote.termMonths : Number(action.termMonths);
      if (!FINANCE_TERM_OPTIONS.includes(term)) return fail("invalid", "Pick 36, 48, 60 or 72 months.");
      if (apr >= p.financeQuote.apr && term === p.financeQuote.termMonths) return fail("invalid", "A counter has to ask for a lower APR or a different term. Accept the offer instead.");
      const m = financeMath({ trueOtd: state.trueOtd, downPayment: p.downPayment, apr, termMonths: term });
      if (!m) return fail("invalid", "Those terms don't produce a payment.");
      const financeCounter = { apr: Math.round(apr * 1000) / 1000, termMonths: term, monthly: m.monthly, amountFinanced: m.amountFinanced, note: text(action.note, 300), at };
      const payment = { ...p, financeCounter, financeTurn: "dealer", financeHistory: pushHistory(p.financeHistory, { by: "buyer", kind: "counter", apr: financeCounter.apr, termMonths: term, monthly: m.monthly, at }) };
      return done({ ...state, payment }, at, { actor, type, stage: "payment", apr: financeCounter.apr, termMonths: term, monthly: m.monthly });
    }

    case "finance_accept": {
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "The payment stage isn't open.");
      const p = state.payment;
      if (!p.financeQuote) return fail("no_quote", "The dealer hasn't made a financing offer yet.");
      if (p.financeTurn !== "buyer") return fail("awaiting_dealer", "Your counter is with the dealer. Wait for their answer, or walk away.");
      return done(toAgreedPayment(state, at, { financeHistory: pushHistory(p.financeHistory, { by: "buyer", kind: "accept", apr: p.financeQuote.apr, termMonths: p.financeQuote.termMonths, monthly: p.financeQuote.monthly, at }) }), at, { actor, type, stage: "payment", monthly: p.financeQuote.monthly });
    }

    case "finance_accept_counter": {
      const bad = only("dealer"); if (bad) return bad;
      if (state.stage !== "payment") return fail("wrong_stage", "The payment stage isn't open.");
      const p = state.payment;
      if (!p.financeQuote || !p.financeCounter || p.financeTurn !== "dealer") return fail("no_counter", "There is no counter to accept.");
      const c = p.financeCounter;
      const m = financeMath({ trueOtd: state.trueOtd, downPayment: p.downPayment, apr: c.apr, termMonths: c.termMonths });
      if (!m) return fail("invalid", "Those terms don't produce a payment.");
      const financeQuote = { ...p.financeQuote, apr: c.apr, termMonths: c.termMonths, monthly: m.monthly, amountFinanced: m.amountFinanced, totalPaid: m.totalPaid, interest: m.interest, held: false, at };
      return done(toAgreedPayment(state, at, { financeQuote, financeHistory: pushHistory(p.financeHistory, { by: "dealer", kind: "accept", apr: c.apr, termMonths: c.termMonths, monthly: m.monthly, at }) }), at, { actor, type, stage: "payment", apr: c.apr, termMonths: c.termMonths, monthly: m.monthly });
    }

    case "change_payment": {
      // Back from the final screen to the payment choice, as long as nothing has been accepted.
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "final") return fail("wrong_stage", "There is no payment choice to change.");
      const payment = { ...state.payment, status: "open", method: null, lenderName: null, outsideFinancing: false, creditRange: null, downPayment: null, preferredTermMonths: null, financeRequestedAt: null, financeQuote: null, financeCounter: null, financeTurn: null, financeHistory: [], agreedAt: null };
      return done({ ...state, stage: "payment", payment }, at, { actor, type, stage: "final" });
    }

    case "accept_final": {
      // The one and only release of the buyer's details: the winning dealer, once, after the buyer taps accept.
      const bad = only("buyer"); if (bad) return bad;
      if (state.stage !== "final" || state.payment.status !== "agreed") return fail("wrong_stage", "Agree the price, trade-in and payment first.");
      const contact = cleanContact(ctx.buyerContact);
      if (!contact) return fail("no_contact", "We need your email to introduce you to the dealer.");
      const summary = finalSummary(state);
      const next = {
        ...state,
        stage: "closed",
        payment: { ...state.payment, status: "closed", closedAt: at },
        final: { status: "accepted", summary, acceptedAt: at },
        release: { at, contact },
      };
      // Two log entries, neither carrying the contact details: the acceptance, and that the release happened (and to whom it applies).
      const accepted = done(next, at, { actor, type, stage: "final", method: summary.method, trueOtd: summary.trueOtd, monthly: summary.monthly });
      return done(accepted.state, at, { actor: "system", type: "buyer_details_released", stage: "final" });
    }

    default:
      return fail("bad_action", "Unknown action.");
  }
}

/** Display-ready progress: the four steps, each upcoming / current / locked / skipped / walked, with the locked number. */
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
  const agreed = s.payment.status === "agreed" || s.payment.status === "closed";
  const paymentValue = !agreed ? null : s.payment.method === "dealer_finance" ? s.payment.financeQuote?.monthly ?? null : s.trueOtd;
  return [
    { id: "otd", label: "Out-the-door price", state: stateOf("otd", s.otd.status === "locked"), value: s.otd.amount },
    { id: "trade", label: "Trade-in", state: stateOf("trade", s.trade.status === "locked"), value: s.trade.value },
    { id: "payment", label: "Payment", state: stateOf("payment", agreed), value: paymentValue },
    { id: "final", label: "Final deal", state: stateOf("final", s.final?.status === "accepted"), value: s.final?.status === "accepted" ? s.trueOtd : null },
  ];
}
