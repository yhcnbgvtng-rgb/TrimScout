// Cash / Finance deal stages (OTD -> trade-in -> payment). Every gate, the no-trade-in skip, the cash close,
// the finance close, and a walk-away at each stage. See src/dealStages.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStageAction, initialStageState, stageProgress, monthlyPayment, cashQuoteOtd, quoteTaxRate, tradeTaxSavings, TRADE_TAX_CREDIT_STATES, liveTrueOtd, financeMath, finalSummary, stageForDealer, revealContact, trueOtdFor,
} from '../src/dealStages.js';

const NOW = new Date('2026-10-11T15:00:00Z');
const ctx = (extra = {}) => ({ otdAmount: 50000, hasTradeInOnFile: true, state: 'NJ', taxRate: 0.06625, now: NOW, ...extra });
const run = (state, action, c = ctx()) => applyStageAction(state, action, c);
const must = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.state; };
const refuse = (r, code) => { assert.equal(r.ok, false); assert.equal(r.code, code, JSON.stringify(r)); };

const atTrade = () => must(run(initialStageState({ tradeInExpected: true }), { type: 'accept_otd', actor: 'buyer' }));
const atPayment = () => {
  let s = atTrade();
  s = must(run(s, { type: 'trade_offer', actor: 'dealer', value: 12000 }));
  return must(run(s, { type: 'trade_accept', actor: 'buyer' }));
};
const CONTACT = { name: 'Pat Buyer', email: 'pat@example.com', phone: '555-0100', zip: '07030' };
const finalAccepted = () => must(run(must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' })), { type: 'accept_final', actor: 'buyer' }, ctx({ buyerContact: CONTACT })));
const noTradePayment = () => must(run(initialStageState({ tradeInExpected: false }), { type: 'accept_otd', actor: 'dealer' }));

describe('stage 1: out-the-door price', () => {
  it('starts open, with no finance and no trade state in play', () => {
    const s = initialStageState({ tradeInExpected: true });
    assert.equal(s.stage, 'otd');
    assert.equal(s.payment.status, 'pending');
    assert.equal(s.trade.status, 'pending');
  });
  it('locks when the buyer accepts, at the dealer quote amount from the server', () => {
    const s = atTrade();
    assert.equal(s.otd.status, 'locked');
    assert.equal(s.otd.amount, 50000);
    assert.equal(s.otd.lockedBy, 'buyer');
  });
  it('locks when the dealer accepts the buyer counter', () => {
    const s = must(run(initialStageState({ tradeInExpected: true }), { type: 'accept_otd', actor: 'dealer' }, ctx({ otdAmount: 48500 })));
    assert.equal(s.otd.amount, 48500);
    assert.equal(s.otd.lockedBy, 'dealer');
  });
  it('refuses to lock without an itemized quote', () => {
    refuse(run(initialStageState({}), { type: 'accept_otd', actor: 'buyer' }, ctx({ otdAmount: null })), 'no_quote');
  });
  it('gates every later stage until it is locked', () => {
    const s = initialStageState({ tradeInExpected: true });
    refuse(run(s, { type: 'trade_offer', actor: 'dealer', value: 1000 }), 'wrong_stage');
    refuse(run(s, { type: 'trade_counter', actor: 'buyer', value: 1000 }), 'wrong_stage');
    refuse(run(s, { type: 'trade_accept', actor: 'buyer' }), 'wrong_stage');
    refuse(run(s, { type: 'choose_cash', actor: 'buyer' }), 'wrong_stage');
    refuse(run(s, { type: 'request_finance', actor: 'buyer', downPayment: 0 }), 'wrong_stage');
    refuse(run(s, { type: 'finance_quote', actor: 'dealer', apr: 5, termMonths: 60 }), 'wrong_stage');
    refuse(run(s, { type: 'finance_accept', actor: 'buyer' }), 'wrong_stage');
  });
  it('cannot be locked twice', () => {
    refuse(run(atTrade(), { type: 'accept_otd', actor: 'dealer' }), 'wrong_stage');
  });
});

describe('no-trade-in skip', () => {
  it('goes straight from OTD to payment, true OTD = OTD', () => {
    const s = noTradePayment();
    assert.equal(s.stage, 'payment');
    assert.equal(s.trade.status, 'skipped');
    assert.equal(s.trueOtd, 50000);
    assert.equal(s.payment.status, 'open');
  });
  it('never opens the trade stage', () => {
    refuse(run(noTradePayment(), { type: 'trade_offer', actor: 'dealer', value: 5000 }), 'wrong_stage');
  });
  it('shows the trade step as skipped in the progress bar', () => {
    assert.deepEqual(stageProgress(noTradePayment()).map((p) => p.state), ['locked', 'skipped', 'current', 'upcoming']);
  });
});

describe('stage 2: trade-in', () => {
  it('needs the trade on file before the dealer can offer', () => {
    refuse(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 9000 }, ctx({ hasTradeInOnFile: false })), 'no_trade');
  });
  it('only the dealer offers, only the buyer counters or accepts', () => {
    refuse(run(atTrade(), { type: 'trade_offer', actor: 'buyer', value: 9000 }), 'forbidden_actor');
    const withOffer = must(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 9000 }));
    refuse(run(withOffer, { type: 'trade_counter', actor: 'dealer', value: 11000 }), 'forbidden_actor');
    refuse(run(withOffer, { type: 'trade_accept', actor: 'dealer' }), 'forbidden_actor');
  });
  it('rejects a trade value above the OTD or below zero', () => {
    refuse(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 60000 }), 'invalid');
    refuse(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: -1 }), 'invalid');
    refuse(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 'abc' }), 'invalid');
  });
  it('locks on accept with true OTD = agreed OTD - trade value', () => {
    const s = atPayment();
    assert.equal(s.trade.status, 'locked');
    assert.equal(s.trade.value, 12000);
    assert.equal(s.trueOtd, 38000);
    assert.equal(s.stage, 'payment');
  });
  it('shows the tax saving where the state credits trades', () => {
    assert.equal(atPayment().trade.taxSavings, 795);
    assert.equal(tradeTaxSavings({ tradeValue: 10000, state: 'CA', taxRate: 0.0725 }), null);
    assert.ok(TRADE_TAX_CREDIT_STATES.includes('NJ'));
  });
  it('leaves the saving off when the state does not credit trades', () => {
    let s = atTrade();
    s = must(run(s, { type: 'trade_offer', actor: 'dealer', value: 12000 }));
    s = must(run(s, { type: 'trade_accept', actor: 'buyer' }, ctx({ state: 'CA' })));
    assert.equal(s.trade.taxSavings, null);
    assert.equal(s.trueOtd, 38000);
  });
  it('cannot counter before there is an offer', () => {
    refuse(run(atTrade(), { type: 'trade_counter', actor: 'buyer', value: 12000 }), 'no_offer');
  });
  it('holds the buyer at accept-or-walk while their counter is with the dealer', () => {
    let s = must(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 9000 }));
    s = must(run(s, { type: 'trade_counter', actor: 'buyer', value: 12000 }));
    refuse(run(s, { type: 'trade_accept', actor: 'buyer' }), 'awaiting_dealer');
  });
  it('locks at the counter value when the dealer accepts it', () => {
    let s = must(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 9000 }));
    s = must(run(s, { type: 'trade_counter', actor: 'buyer', value: 12000 }));
    s = must(run(s, { type: 'trade_accept_counter', actor: 'dealer' }));
    assert.equal(s.trade.value, 12000);
    assert.equal(s.trueOtd, 38000);
  });
  it('lets the dealer answer a counter with a revised offer, then buyer accepts that', () => {
    let s = must(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 9000 }));
    s = must(run(s, { type: 'trade_counter', actor: 'buyer', value: 12000 }));
    s = must(run(s, { type: 'trade_offer', actor: 'dealer', value: 10500 }));
    assert.equal(s.trade.offer.revised, true);
    refuse(run(s, { type: 'trade_offer', actor: 'dealer', value: 11000 }), 'locked');
    refuse(run(s, { type: 'trade_accept_counter', actor: 'dealer' }), 'no_counter');
    s = must(run(s, { type: 'trade_accept', actor: 'buyer' }));
    assert.equal(s.trade.value, 10500);
    assert.equal(s.trueOtd, 39500);
  });
  it('does not let the dealer re-offer once an offer is open and uncountered', () => {
    const s = must(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 9000 }));
    refuse(run(s, { type: 'trade_offer', actor: 'dealer', value: 9500 }), 'locked');
  });
  it('keeps payment actions closed until the trade stage locks', () => {
    const s = must(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 9000 }));
    refuse(run(s, { type: 'choose_cash', actor: 'buyer' }), 'wrong_stage');
    refuse(run(s, { type: 'request_finance', actor: 'buyer', downPayment: 1000 }), 'wrong_stage');
  });
});

describe('stage 3: payment', () => {
  it('pay cash agrees the payment at the true OTD and moves to the final review (nothing is closed or released yet)', () => {
    const s = must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' }));
    assert.equal(s.stage, 'final');
    assert.equal(s.payment.method, 'cash');
    assert.equal(s.payment.status, 'agreed');
    assert.equal(s.release, null);
    assert.equal(s.trueOtd, 38000);
    assert.deepEqual(stageProgress(s).map((p) => p.state), ['locked', 'locked', 'locked', 'current']);
    assert.equal(stageProgress(s)[2].value, 38000);
  });
  it('pay cash works with no trade-in too', () => {
    const s = must(run(noTradePayment(), { type: 'choose_cash', actor: 'buyer' }));
    assert.equal(s.payment.method, 'cash');
    assert.equal(s.trueOtd, 50000);
  });
  it('only the buyer chooses cash', () => {
    refuse(run(atPayment(), { type: 'choose_cash', actor: 'dealer' }), 'forbidden_actor');
  });
  it('financing: request, dealer quotes on true OTD minus down, buyer accepts and it moves to the final review', () => {
    let s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 3000, outsideFinancing: true }));
    assert.equal(s.payment.outsideFinancing, true);
    s = must(run(s, { type: 'finance_quote', actor: 'dealer', apr: 5.9, termMonths: 60, lenderName: 'Toyota Financial' }));
    assert.equal(s.payment.financeQuote.amountFinanced, 35000);
    assert.equal(s.payment.financeQuote.monthly, monthlyPayment(35000, 5.9, 60));
    s = must(run(s, { type: 'finance_accept', actor: 'buyer' }));
    assert.equal(s.stage, 'final');
    assert.equal(s.payment.method, 'dealer_finance');
    assert.equal(stageProgress(s)[2].value, s.payment.financeQuote.monthly);
  });
  it('the dealer cannot quote before financing is requested', () => {
    refuse(run(atPayment(), { type: 'finance_quote', actor: 'dealer', apr: 5, termMonths: 60, lenderName: 'X' }), 'no_request');
  });
  it('the buyer cannot accept before a quote exists', () => {
    const s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 0 }));
    refuse(run(s, { type: 'finance_accept', actor: 'buyer' }), 'no_quote');
  });
  it('a new financing request clears the old quote and counter', () => {
    let s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 2000 }));
    s = must(run(s, { type: 'finance_quote', actor: 'dealer', apr: 6.5, termMonths: 72, lenderName: 'Bank' }));
    s = must(run(s, { type: 'finance_counter', actor: 'buyer', apr: 5.5 }));
    s = must(run(s, { type: 'request_finance', actor: 'buyer', downPayment: 8000 }));
    assert.equal(s.payment.financeQuote, null);
    assert.equal(s.payment.financeCounter, null);
  });
  it('validates APR, term and down payment', () => {
    const s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 1000 }));
    refuse(run(s, { type: 'finance_quote', actor: 'dealer', apr: -1, termMonths: 60, lenderName: 'X' }), 'invalid');
    refuse(run(s, { type: 'finance_quote', actor: 'dealer', apr: 80, termMonths: 60, lenderName: 'X' }), 'invalid');
    refuse(run(s, { type: 'finance_quote', actor: 'dealer', apr: 5, termMonths: 13, lenderName: 'X' }), 'invalid');
    refuse(run(s, { type: 'finance_quote', actor: 'dealer', apr: 5, termMonths: 24, lenderName: 'X' }), 'invalid');
    refuse(run(s, { type: 'finance_quote', actor: 'dealer', apr: 5, termMonths: 60 }), 'invalid');
    refuse(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: -5 }), 'invalid');
    refuse(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 38000 }), 'invalid');
  });
  it('0% APR is principal over term', () => {
    assert.equal(monthlyPayment(36000, 0, 60), 600);
    assert.equal(monthlyPayment(0, 5, 60), null);
  });
  it('a buyer who asked for financing can still pay cash', () => {
    let s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 1000 }));
    s = must(run(s, { type: 'choose_cash', actor: 'buyer' }));
    assert.equal(s.payment.method, 'cash');
    assert.equal(s.payment.financeRequestedAt, null);
  });
});

describe('walk away, at every stage', () => {
  for (const [label, make] of [
    ['out-the-door', () => initialStageState({ tradeInExpected: true })],
    ['trade-in', atTrade],
    ['payment', atPayment],
    ['final review', () => must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' }))],
  ]) {
    for (const actor of ['buyer', 'dealer']) {
      it(`${actor} walks at ${label}; nothing is possible after`, () => {
        const s = must(run(make(), { type: 'walk', actor, reason: ' not for me ' }));
        assert.equal(s.stage, 'walked');
        assert.equal(s.walk.by, actor);
        assert.equal(s.walk.reason, 'not for me');
        refuse(run(s, { type: 'accept_otd', actor: 'buyer' }), 'closed');
        refuse(run(s, { type: 'choose_cash', actor: 'buyer' }), 'closed');
      });
    }
  }
  it('records the stage walked from and marks it in the progress bar', () => {
    const s = must(run(atTrade(), { type: 'walk', actor: 'buyer' }));
    assert.equal(s.walk.atStage, 'trade');
    assert.deepEqual(stageProgress(s).map((p) => p.state), ['locked', 'walked', 'upcoming', 'upcoming']);
  });
  it('a closed deal cannot be walked from', () => {
    refuse(run(finalAccepted(), { type: 'walk', actor: 'buyer' }), 'closed');
  });
  it('rejects unknown actors and actions', () => {
    refuse(run(atPayment(), { type: 'choose_cash', actor: 'admin' }), 'bad_actor');
    refuse(run(atPayment(), { type: 'bid_up', actor: 'buyer' }), 'bad_action');
  });
});

describe('numbers from the stored quote', () => {
  const used = { kind: 'cash', sellingPrice: 40000, addOns: [{ name: 'Mats', amount: 200 }], rebates: [{ name: 'Rebate', amount: 500 }],
    dueAtSigning: [{ name: 'Sales tax', amount: 2650 }, { name: 'Doc fee', amount: 799 }, { name: 'Title & registration', amount: 300 }] };
  it('OTD = price + fees & tax + add-ons - rebates', () => assert.equal(cashQuoteOtd(used), 43449));
  it('finds the dealer tax rate without counting title/registration', () => assert.equal(Math.round(quoteTaxRate(used) * 10000) / 10000, 0.0659));
  it('has no OTD for a finance sheet or nothing', () => {
    assert.equal(cashQuoteOtd({ kind: 'finance' }), null);
    assert.equal(cashQuoteOtd(null), null);
  });
  it('the log keeps an entry per action, capped', () => {
    let s = initialStageState({});
    s = must(run(s, { type: 'accept_otd', actor: 'buyer' }));
    assert.equal(s.log.length, 1);
  });
});

describe('add your trade-in after the OTD is accepted (add_trade / skip_trade)', () => {
  it('no trade expected: add_trade re-opens the trade stage, the accepted OTD stays locked, true OTD waits for the dealer', () => {
    const s = noTradePayment();
    assert.equal(s.stage, 'payment');
    const next = must(run(s, { type: 'add_trade', actor: 'buyer' }));
    assert.equal(next.stage, 'trade');
    assert.equal(next.trade.status, 'open');
    assert.equal(next.tradeInExpected, true);
    assert.equal(next.otd.status, 'locked');
    assert.equal(next.otd.amount, 50000);
    assert.equal(next.trueOtd, null);
    assert.equal(next.payment.status, 'pending');
    // the dealer can now offer a value and the buyer reaches the true OTD
    const offered = must(run(next, { type: 'trade_offer', actor: 'dealer', value: 12000 }));
    const locked = must(run(offered, { type: 'trade_accept', actor: 'buyer' }));
    assert.equal(locked.trueOtd, 38000);
  });
  it('needs the trade-in on file, the buyer, and a locked OTD', () => {
    refuse(run(noTradePayment(), { type: 'add_trade', actor: 'buyer' }, ctx({ hasTradeInOnFile: false })), 'no_trade');
    refuse(run(noTradePayment(), { type: 'add_trade', actor: 'dealer' }), 'forbidden_actor');
    refuse(run(initialStageState({ tradeInExpected: false }), { type: 'add_trade', actor: 'buyer' }), 'wrong_stage');
  });
  it('is refused once the payment step has begun (financing asked, cash chosen) or a trade was locked', () => {
    const asked = must(run(noTradePayment(), { type: 'request_finance', actor: 'buyer', downPayment: 1000 }));
    refuse(run(asked, { type: 'add_trade', actor: 'buyer' }), 'locked');
    refuse(run(atPayment(), { type: 'add_trade', actor: 'buyer' }), 'locked');
    const chosen = must(run(noTradePayment(), { type: 'choose_cash', actor: 'buyer' }));
    refuse(run(chosen, { type: 'add_trade', actor: 'buyer' }), 'locked');
    refuse(run(finalAccepted(), { type: 'add_trade', actor: 'buyer' }), 'closed');
  });
  it('adding twice is harmless while the trade stage is open', () => {
    const open = must(run(noTradePayment(), { type: 'add_trade', actor: 'buyer' }));
    const again = must(run(open, { type: 'add_trade', actor: 'buyer' }));
    assert.equal(again.stage, 'trade');
  });
  it('skip_trade (trade stage open, no offer yet) carries on to payment at the accepted OTD', () => {
    const s = atTrade();
    const skipped = must(run(s, { type: 'skip_trade', actor: 'buyer' }));
    assert.equal(skipped.stage, 'payment');
    assert.equal(skipped.trade.status, 'skipped');
    assert.equal(skipped.trueOtd, 50000);
    assert.equal(skipped.otd.status, 'locked');
    refuse(run(s, { type: 'skip_trade', actor: 'dealer' }), 'forbidden_actor');
    refuse(run(noTradePayment(), { type: 'skip_trade', actor: 'buyer' }), 'wrong_stage');
  });
  it('skip_trade is refused once the dealer has made an offer', () => {
    const offered = must(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 9000 }));
    refuse(run(offered, { type: 'skip_trade', actor: 'buyer' }), 'locked');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Trade-in counter loop: buyer accepts or counters (with a note); dealer accepts, revises or holds firm; repeat until agreed.
// ---------------------------------------------------------------------------------------------------------------------------
describe('trade-in counter loop', () => {
  const offered = (value = 9000, c = ctx()) => must(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value }, c));
  it('tracks whose move it is through offer, counter, revise, counter again, accept', () => {
    let s = offered();
    assert.equal(s.trade.turn, 'buyer');
    s = must(run(s, { type: 'trade_counter', actor: 'buyer', value: 12000, note: '  KBB says more  ' }));
    assert.equal(s.trade.turn, 'dealer');
    assert.equal(s.trade.counter.note, 'KBB says more');
    s = must(run(s, { type: 'trade_offer', actor: 'dealer', value: 10000 }));
    assert.equal(s.trade.turn, 'buyer');
    s = must(run(s, { type: 'trade_counter', actor: 'buyer', value: 11000 }));
    s = must(run(s, { type: 'trade_offer', actor: 'dealer', value: 10500 }));
    s = must(run(s, { type: 'trade_counter', actor: 'buyer', value: 10800 }));
    s = must(run(s, { type: 'trade_accept_counter', actor: 'dealer' }));
    assert.equal(s.trade.value, 10800);
    assert.equal(s.trueOtd, 39200);
    assert.equal(s.stage, 'payment');
    assert.equal(s.trade.turn, null);
    assert.equal(s.trade.rounds, 6);
  });
  it('the dealer can hold firm, and the buyer can then counter again or accept', () => {
    let s = must(run(offered(), { type: 'trade_counter', actor: 'buyer', value: 12000 }));
    s = must(run(s, { type: 'trade_hold', actor: 'dealer' }));
    assert.equal(s.trade.offer.value, 9000);
    assert.equal(s.trade.offer.held, true);
    assert.equal(s.trade.turn, 'buyer');
    const again = must(run(s, { type: 'trade_counter', actor: 'buyer', value: 10000 }));
    assert.equal(again.trade.turn, 'dealer');
    const accepted = must(run(s, { type: 'trade_accept', actor: 'buyer' }));
    assert.equal(accepted.trade.value, 9000);
  });
  it('turn order is enforced for both sides', () => {
    const o = offered();
    refuse(run(o, { type: 'trade_hold', actor: 'dealer' }), 'no_counter');
    refuse(run(o, { type: 'trade_accept_counter', actor: 'dealer' }), 'no_counter');
    refuse(run(o, { type: 'trade_offer', actor: 'dealer', value: 9500 }), 'locked');
    const c = must(run(o, { type: 'trade_counter', actor: 'buyer', value: 12000 }));
    refuse(run(c, { type: 'trade_counter', actor: 'buyer', value: 13000 }), 'awaiting_dealer');
    refuse(run(c, { type: 'trade_accept', actor: 'buyer' }), 'awaiting_dealer');
    refuse(run(c, { type: 'trade_hold', actor: 'buyer' }), 'forbidden_actor');
  });
  it('a counter has to ask for more than the offer and no more than the OTD', () => {
    const o = offered();
    refuse(run(o, { type: 'trade_counter', actor: 'buyer', value: 9000 }), 'invalid');
    refuse(run(o, { type: 'trade_counter', actor: 'buyer', value: 100 }), 'invalid');
    refuse(run(o, { type: 'trade_counter', actor: 'buyer', value: 50001 }), 'invalid');
  });
  it('the accepted OTD stays locked through the whole loop', () => {
    let s = must(run(offered(), { type: 'trade_counter', actor: 'buyer', value: 12000 }));
    s = must(run(s, { type: 'trade_offer', actor: 'dealer', value: 11000 }));
    assert.equal(s.otd.status, 'locked');
    assert.equal(s.otd.amount, 50000);
    refuse(run(s, { type: 'accept_otd', actor: 'dealer' }, ctx({ otdAmount: 45000 })), 'wrong_stage');
  });
  it('true OTD = agreed OTD - agreed trade value + payoff, and updates live while negotiating', () => {
    const c = ctx({ tradePayoff: 4000 });
    let s = offered(9000, c);
    assert.equal(s.trade.payoff, 4000);
    assert.deepEqual(liveTrueOtd(s), { locked: null, ifOffer: 45000, ifCounter: null, payoff: 4000 });
    s = must(run(s, { type: 'trade_counter', actor: 'buyer', value: 12000 }, c));
    assert.equal(liveTrueOtd(s).ifCounter, 42000);
    s = must(run(s, { type: 'trade_accept_counter', actor: 'dealer' }, c));
    assert.equal(s.trueOtd, 42000);
    assert.equal(trueOtdFor(50000, 12000, 4000), 42000);
    assert.equal(trueOtdFor(50000, 12000, 0), 38000);
    assert.equal(trueOtdFor(50000, 0, -5), 50000);
  });
  it('logs every counter, hold and accept as a stage event', () => {
    let s = must(run(offered(), { type: 'trade_counter', actor: 'buyer', value: 12000 }));
    s = must(run(s, { type: 'trade_hold', actor: 'dealer' }));
    s = must(run(s, { type: 'trade_accept', actor: 'buyer' }));
    assert.deepEqual(s.log.map((e) => e.type), ['accept_otd', 'trade_offer', 'trade_counter', 'trade_hold', 'trade_accept']);
  });
  it('a walked trade negotiation stops everything', () => {
    const w = must(run(offered(), { type: 'walk', actor: 'dealer' }));
    refuse(run(w, { type: 'trade_counter', actor: 'buyer', value: 12000 }), 'closed');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Payment choice: cash, own financing, or a dealer financing offer.
// ---------------------------------------------------------------------------------------------------------------------------
describe('payment choice', () => {
  it('own financing needs no rate; the lender name is optional', () => {
    const a = must(run(atPayment(), { type: 'choose_own_financing', actor: 'buyer' }));
    assert.equal(a.payment.method, 'own_financing');
    assert.equal(a.payment.lenderName, null);
    assert.equal(a.stage, 'final');
    const b = must(run(atPayment(), { type: 'choose_own_financing', actor: 'buyer', lenderName: '  Navy Federal ' }));
    assert.equal(b.payment.lenderName, 'Navy Federal');
    assert.equal(b.payment.financeQuote, null);
  });
  it('dealer financing offers 36/48/60/72 months, an optional credit range and the down payment', () => {
    for (const t of [36, 48, 60, 72]) must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 1000, termMonths: t, creditRange: 'good' }));
    for (const t of [24, 84, 12]) refuse(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 1000, termMonths: t }), 'invalid');
    refuse(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 1000, creditRange: 'platinum' }), 'invalid');
    const s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 1000 }));
    assert.equal(s.payment.creditRange, null);
    assert.equal(s.payment.method, 'dealer_finance');
    assert.equal(s.payment.financeTurn, 'dealer');
  });
  it('only the buyer picks how to pay, and only once the trade is agreed or skipped', () => {
    for (const type of ['choose_cash', 'choose_own_financing', 'request_finance']) refuse(run(atPayment(), { type, actor: 'dealer', downPayment: 0 }), 'forbidden_actor');
    refuse(run(atTrade(), { type: 'choose_own_financing', actor: 'buyer' }), 'wrong_stage');
    must(run(noTradePayment(), { type: 'choose_own_financing', actor: 'buyer' }));
  });
  it('the buyer can step back from the final screen to change the payment, until they accept', () => {
    const f = must(run(atPayment(), { type: 'choose_own_financing', actor: 'buyer' }));
    const back = must(run(f, { type: 'change_payment', actor: 'buyer' }));
    assert.equal(back.stage, 'payment');
    assert.equal(back.payment.method, null);
    refuse(run(f, { type: 'change_payment', actor: 'dealer' }), 'forbidden_actor');
    refuse(run(finalAccepted(), { type: 'change_payment', actor: 'buyer' }), 'closed');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Dealer financing offer + counter loop, and the payment math.
// ---------------------------------------------------------------------------------------------------------------------------
describe('dealer financing offer and counter loop', () => {
  const requested = () => must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 3000, termMonths: 60 }));
  const quoted = (apr = 7.9, termMonths = 60) => must(run(requested(), { type: 'finance_quote', actor: 'dealer', apr, termMonths, lenderName: 'Ally' }));
  it('the offer carries APR, term, monthly, amount financed and lender, all computed from the true OTD', () => {
    const q = quoted().payment.financeQuote;
    assert.equal(q.apr, 7.9);
    assert.equal(q.termMonths, 60);
    assert.equal(q.lenderName, 'Ally');
    assert.equal(q.amountFinanced, 35000); // 38,000 true OTD - 3,000 down
    assert.equal(q.monthly, monthlyPayment(35000, 7.9, 60));
    assert.equal(q.totalPaid, Math.round(q.monthly * 60 * 100) / 100);
    assert.equal(q.interest, Math.round((q.totalPaid - 35000) * 100) / 100);
  });
  it('the payment math is a standard amortization (known values)', () => {
    assert.equal(monthlyPayment(35000, 7.9, 60), 708);
    assert.equal(monthlyPayment(20000, 6, 48), 469.7);
    assert.equal(monthlyPayment(30000, 0, 36), 833.33);
    assert.deepEqual(financeMath({ trueOtd: 38000, downPayment: 3000, apr: 0, termMonths: 36 }), { amountFinanced: 35000, monthly: 972.22, totalPaid: 34999.92, interest: -0.08 });
  });
  it('a typed monthly or amount financed has to match the numbers, else it is refused with the right figure', () => {
    const r = requested();
    must(run(r, { type: 'finance_quote', actor: 'dealer', apr: 7.9, termMonths: 60, lenderName: 'Ally', monthly: 708, amountFinanced: 35000 }));
    const badMonthly = run(r, { type: 'finance_quote', actor: 'dealer', apr: 7.9, termMonths: 60, lenderName: 'Ally', monthly: 650, amountFinanced: 35000 });
    refuse(badMonthly, 'math_mismatch');
    assert.match(badMonthly.error, /708\.00/);
    const badFinanced = run(r, { type: 'finance_quote', actor: 'dealer', apr: 7.9, termMonths: 60, lenderName: 'Ally', amountFinanced: 36000 });
    refuse(badFinanced, 'math_mismatch');
    assert.match(badFinanced.error, /35000\.00/);
  });
  it('a lender name is required', () => {
    refuse(run(requested(), { type: 'finance_quote', actor: 'dealer', apr: 7.9, termMonths: 60, lenderName: '   ' }), 'invalid');
  });
  it('the buyer accepts the offer as made', () => {
    const s = must(run(quoted(), { type: 'finance_accept', actor: 'buyer' }));
    assert.equal(s.stage, 'final');
    assert.equal(s.payment.financeQuote.apr, 7.9);
  });
  it('the buyer counters the APR (and term); the dealer can accept, and the numbers are recomputed', () => {
    let s = must(run(quoted(), { type: 'finance_counter', actor: 'buyer', apr: 6.5, termMonths: 48, note: 'Credit union offered 6.5' }));
    assert.equal(s.payment.financeTurn, 'dealer');
    assert.equal(s.payment.financeCounter.monthly, monthlyPayment(35000, 6.5, 48));
    s = must(run(s, { type: 'finance_accept_counter', actor: 'dealer' }));
    assert.equal(s.stage, 'final');
    assert.equal(s.payment.financeQuote.apr, 6.5);
    assert.equal(s.payment.financeQuote.termMonths, 48);
    assert.equal(s.payment.financeQuote.monthly, monthlyPayment(35000, 6.5, 48));
    assert.equal(s.payment.financeQuote.lenderName, 'Ally');
  });
  it('the dealer can revise or hold firm, and the buyer can counter again, until both agree', () => {
    let s = must(run(quoted(7.9), { type: 'finance_counter', actor: 'buyer', apr: 5.9 }));
    s = must(run(s, { type: 'finance_hold', actor: 'dealer' }));
    assert.equal(s.payment.financeQuote.apr, 7.9);
    assert.equal(s.payment.financeQuote.held, true);
    assert.equal(s.payment.financeTurn, 'buyer');
    s = must(run(s, { type: 'finance_counter', actor: 'buyer', apr: 6.9 }));
    s = must(run(s, { type: 'finance_quote', actor: 'dealer', apr: 7.2, termMonths: 60, lenderName: 'Ally' }));
    assert.equal(s.payment.financeQuote.revised, true);
    s = must(run(s, { type: 'finance_counter', actor: 'buyer', apr: 7.0 }));
    s = must(run(s, { type: 'finance_accept_counter', actor: 'dealer' }));
    assert.equal(s.payment.financeQuote.apr, 7);
    assert.equal(s.stage, 'final');
  });
  it('turn order and validity are enforced', () => {
    const q = quoted();
    refuse(run(q, { type: 'finance_quote', actor: 'dealer', apr: 6, termMonths: 60, lenderName: 'Ally' }), 'locked');
    refuse(run(q, { type: 'finance_hold', actor: 'dealer' }), 'no_counter');
    refuse(run(q, { type: 'finance_accept_counter', actor: 'dealer' }), 'no_counter');
    refuse(run(q, { type: 'finance_counter', actor: 'buyer', apr: 7.9 }), 'invalid');
    refuse(run(q, { type: 'finance_counter', actor: 'buyer', apr: 9 }), 'invalid');
    refuse(run(q, { type: 'finance_counter', actor: 'buyer', apr: 99 }), 'invalid');
    refuse(run(q, { type: 'finance_counter', actor: 'buyer', apr: 6, termMonths: 24 }), 'invalid');
    refuse(run(q, { type: 'finance_counter', actor: 'dealer', apr: 6 }), 'forbidden_actor');
    const c = must(run(q, { type: 'finance_counter', actor: 'buyer', apr: 6 }));
    refuse(run(c, { type: 'finance_counter', actor: 'buyer', apr: 5 }), 'awaiting_dealer');
    refuse(run(c, { type: 'finance_accept', actor: 'buyer' }), 'awaiting_dealer');
    refuse(run(requested(), { type: 'finance_counter', actor: 'buyer', apr: 6 }), 'no_quote');
    refuse(run(atPayment(), { type: 'finance_quote', actor: 'dealer', apr: 6, termMonths: 60, lenderName: 'Ally' }), 'no_request');
  });
  it('cannot offer financing to a buyer who is paying cash or bringing their own', () => {
    const own = must(run(atPayment(), { type: 'choose_own_financing', actor: 'buyer' }));
    refuse(run(own, { type: 'finance_quote', actor: 'dealer', apr: 6, termMonths: 60, lenderName: 'Ally' }), 'wrong_stage');
  });
  it('logs every counter, hold and accept', () => {
    let s = must(run(quoted(), { type: 'finance_counter', actor: 'buyer', apr: 6 }));
    s = must(run(s, { type: 'finance_hold', actor: 'dealer' }));
    s = must(run(s, { type: 'finance_accept', actor: 'buyer' }));
    assert.deepEqual(s.log.slice(-4).map((e) => e.type), ['finance_quote', 'finance_counter', 'finance_hold', 'finance_accept']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Final acceptance and the one-time release of the buyer's details.
// ---------------------------------------------------------------------------------------------------------------------------
describe('final acceptance and buyer-details release', () => {
  const atFinalFinance = () => {
    let s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 3000, termMonths: 60 }));
    s = must(run(s, { type: 'finance_quote', actor: 'dealer', apr: 7.9, termMonths: 60, lenderName: 'Ally' }));
    return must(run(s, { type: 'finance_accept', actor: 'buyer' }));
  };
  it('the summary shows vehicle numbers: OTD, trade, payment method, and APR + payment when financed', () => {
    const cash = finalSummary(must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' })));
    assert.deepEqual([cash.otd, cash.tradeValue, cash.trueOtd, cash.method, cash.apr, cash.monthly], [50000, 12000, 38000, 'cash', null, null]);
    const fin = finalSummary(atFinalFinance());
    assert.deepEqual([fin.method, fin.apr, fin.termMonths, fin.monthly, fin.amountFinanced, fin.lenderName, fin.downPayment], ['dealer_finance', 7.9, 60, 708, 35000, 'Ally', 3000]);
  });
  it('nothing is released before final acceptance: no stage before it carries contact details', () => {
    const states = [initialStageState({ tradeInExpected: true }), atTrade(), atPayment(), must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' })), atFinalFinance()];
    for (const s of states) {
      assert.equal(s.release, null);
      assert.ok(!JSON.stringify(s).includes('pat@example.com'));
    }
  });
  it('accept_final closes the deal, releases the details once, and the log records it without the details', () => {
    const s = finalAccepted();
    assert.equal(s.stage, 'closed');
    assert.equal(s.final.status, 'accepted');
    assert.equal(s.payment.status, 'closed');
    assert.deepEqual(s.release.contact, CONTACT);
    assert.equal(s.release.at, NOW.toISOString());
    assert.deepEqual(s.log.slice(-2).map((e) => e.type), ['accept_final', 'buyer_details_released']);
    assert.ok(!JSON.stringify(s.log).includes('pat@example.com'));
    assert.ok(!JSON.stringify(s.log).includes('555-0100'));
    refuse(run(s, { type: 'accept_final', actor: 'buyer' }, ctx({ buyerContact: CONTACT })), 'closed');
  });
  it('the details are cleaned and an email is required', () => {
    const s = must(run(must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' })), { type: 'accept_final', actor: 'buyer' }, ctx({ buyerContact: { name: '  Pat  ', email: ' PAT@x.co ', phone: '', zip: '07030', extra: 'drop me' } })));
    assert.deepEqual(s.release.contact, { name: 'Pat', email: 'PAT@x.co', phone: null, zip: '07030' });
    const f = must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' }));
    refuse(run(f, { type: 'accept_final', actor: 'buyer' }, ctx()), 'no_contact');
    refuse(run(f, { type: 'accept_final', actor: 'buyer' }, ctx({ buyerContact: { name: 'Pat', email: 'nope' } })), 'no_contact');
  });
  it('only the buyer can accept, and only from the final review', () => {
    const f = must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' }));
    refuse(run(f, { type: 'accept_final', actor: 'dealer' }, ctx({ buyerContact: CONTACT })), 'forbidden_actor');
    refuse(run(atPayment(), { type: 'accept_final', actor: 'buyer' }, ctx({ buyerContact: CONTACT })), 'wrong_stage');
    refuse(run(atTrade(), { type: 'accept_final', actor: 'buyer' }, ctx({ buyerContact: CONTACT })), 'wrong_stage');
    refuse(run(initialStageState({}), { type: 'accept_final', actor: 'buyer' }, ctx({ buyerContact: CONTACT })), 'wrong_stage');
  });
  it('a request to accept cannot carry contact details on any other action', () => {
    const s = must(run(atPayment(), { type: 'choose_cash', actor: 'buyer', buyerContact: CONTACT }, ctx({ buyerContact: CONTACT })));
    assert.equal(s.release, null);
    assert.ok(!JSON.stringify(s).includes('pat@example.com'));
  });
  it('the dealer view never carries the buyer details; the winner keeps only the release marker, a closed-out dealer has no release', () => {
    const accepted = finalAccepted();
    assert.equal(stageForDealer(accepted).release.contact, undefined);
    assert.ok(stageForDealer(accepted).release.at);
    assert.ok(!JSON.stringify(stageForDealer(accepted)).includes('pat@example.com'));
    assert.equal(stageForDealer(accepted, { notSelected: true }).release, null);
    const before = must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' }));
    assert.equal(stageForDealer(before).release, null);
    const tampered = { ...before, release: { at: 'x', contact: CONTACT } }; // even if a release were somehow attached early
    assert.equal(stageForDealer(tampered).release, null);
    assert.equal(stageForDealer(null), null);
  });
  it('revealContact: only on a finally accepted deal; stamps count/first/last and logs the reveal without the details', () => {
    const accepted = finalAccepted();
    refuse(revealContact(null), 'not_released');
    refuse(revealContact(atPayment()), 'not_released');
    const one = revealContact(accepted, new Date('2026-10-30T12:00:00Z'));
    assert.equal(one.ok, true);
    assert.deepEqual(one.contact, CONTACT);
    const two = revealContact(one.state, new Date('2026-10-30T13:00:00Z'));
    assert.deepEqual(two.state.release.reveals, { count: 2, firstAt: '2026-10-30T12:00:00.000Z', lastAt: '2026-10-30T13:00:00.000Z' });
    assert.equal(two.state.log.filter((e) => e.type === 'buyer_contact_revealed').length, 2);
    assert.ok(!JSON.stringify(two.state.log).includes('pat@example.com'));
  });
  it('progress shows all four steps locked after acceptance', () => {
    assert.deepEqual(stageProgress(finalAccepted()).map((p) => p.state), ['locked', 'locked', 'locked', 'locked']);
  });
});
