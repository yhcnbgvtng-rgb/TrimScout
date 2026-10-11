// Cash / Finance deal stages (OTD -> trade-in -> payment). Every gate, the no-trade-in skip, the cash close,
// the finance close, and a walk-away at each stage. See src/dealStages.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStageAction, initialStageState, stageProgress, monthlyPayment, cashQuoteOtd, quoteTaxRate, tradeTaxSavings, TRADE_TAX_CREDIT_STATES,
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
    assert.deepEqual(stageProgress(noTradePayment()).map((p) => p.state), ['locked', 'skipped', 'current']);
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
  it('lets the buyer counter exactly once', () => {
    let s = must(run(atTrade(), { type: 'trade_offer', actor: 'dealer', value: 9000 }));
    s = must(run(s, { type: 'trade_counter', actor: 'buyer', value: 12000 }));
    refuse(run(s, { type: 'trade_counter', actor: 'buyer', value: 11000 }), 'counter_used');
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
  it('lets the dealer answer a counter with one revised offer, then buyer accepts that', () => {
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
  it('pay cash closes the deal at the true OTD', () => {
    const s = must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' }));
    assert.equal(s.stage, 'closed');
    assert.equal(s.payment.method, 'cash');
    assert.equal(s.trueOtd, 38000);
    assert.deepEqual(stageProgress(s).map((p) => p.state), ['locked', 'locked', 'locked']);
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
  it('financing: request, dealer quotes on true OTD minus down, buyer accepts and it closes', () => {
    let s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 3000, outsideFinancing: true }));
    assert.equal(s.payment.outsideFinancing, true);
    s = must(run(s, { type: 'finance_quote', actor: 'dealer', apr: 5.9, termMonths: 60 }));
    assert.equal(s.payment.financeQuote.amountFinanced, 35000);
    assert.equal(s.payment.financeQuote.monthly, monthlyPayment(35000, 5.9, 60));
    s = must(run(s, { type: 'finance_accept', actor: 'buyer' }));
    assert.equal(s.stage, 'closed');
    assert.equal(s.payment.method, 'finance');
    assert.equal(stageProgress(s)[2].value, s.payment.financeQuote.monthly);
  });
  it('the dealer cannot quote before financing is requested', () => {
    refuse(run(atPayment(), { type: 'finance_quote', actor: 'dealer', apr: 5, termMonths: 60 }), 'no_request');
  });
  it('the buyer cannot accept before a quote exists', () => {
    const s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 0 }));
    refuse(run(s, { type: 'finance_accept', actor: 'buyer' }), 'no_quote');
  });
  it('the dealer can re-quote while open, and a new request clears the old quote', () => {
    let s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 2000 }));
    s = must(run(s, { type: 'finance_quote', actor: 'dealer', apr: 6.5, termMonths: 72 }));
    s = must(run(s, { type: 'finance_quote', actor: 'dealer', apr: 5.5, termMonths: 72 }));
    assert.equal(s.payment.financeQuote.apr, 5.5);
    s = must(run(s, { type: 'request_finance', actor: 'buyer', downPayment: 8000 }));
    assert.equal(s.payment.financeQuote, null);
  });
  it('validates APR, term and down payment', () => {
    const s = must(run(atPayment(), { type: 'request_finance', actor: 'buyer', downPayment: 1000 }));
    refuse(run(s, { type: 'finance_quote', actor: 'dealer', apr: -1, termMonths: 60 }), 'invalid');
    refuse(run(s, { type: 'finance_quote', actor: 'dealer', apr: 80, termMonths: 60 }), 'invalid');
    refuse(run(s, { type: 'finance_quote', actor: 'dealer', apr: 5, termMonths: 13 }), 'invalid');
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
  });
});

describe('walk away, at every stage', () => {
  for (const [label, make] of [
    ['out-the-door', () => initialStageState({ tradeInExpected: true })],
    ['trade-in', atTrade],
    ['payment', atPayment],
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
    assert.deepEqual(stageProgress(s).map((p) => p.state), ['locked', 'walked', 'upcoming']);
  });
  it('a closed deal cannot be walked from', () => {
    refuse(run(must(run(atPayment(), { type: 'choose_cash', actor: 'buyer' })), { type: 'walk', actor: 'buyer' }), 'closed');
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
