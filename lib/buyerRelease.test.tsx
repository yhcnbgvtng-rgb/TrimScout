// Final acceptance and the buyer-details release: the summary the buyer accepts, the "Deal accepted, here's your buyer" email,
// SAFE MODE routing of that email (including audit=1 deals), and the privacy rule that no dealer sees the buyer's contact details
// before acceptance (and losing dealers never do). The state-machine side is in scrapers/lightsail-crawler/test/dealStages.test.js.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyStageAction, initialStageState, stageForDealer, stageOf, type DealStageState, type StageAction } from "./dealStages";
import { BUYER_DETAILS_SUBJECT, buildBuyerDetailsEmail, buildStageNotice } from "./dealStageNotice";
import { sendBuyerDetailsRelease } from "./inviteOutbox";
import { SAFE_MODE_RECIPIENT, sendQuoteInviteEmail } from "./dealerEmail";
import { finalSummary } from "./dealStages";
import { StagedDeals } from "../components/StagedDeals";
import { DealerStagePanel } from "../components/DealerStagePanel";
import type { RfqInvite, RfqRequest } from "./rfq";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const NOW = new Date("2026-10-11T15:00:00Z");
const FUTURE = "2099-01-01T00:00:00Z";
const CONTACT = { name: "Pat Buyer", email: "pat.buyer@example.com", phone: "555-0142", zip: "07030" };
const SECRETS = [CONTACT.name, CONTACT.email, CONTACT.phone];
const ctx = { otdAmount: 43749, hasTradeInOnFile: true, tradePayoff: 2000, state: "NJ", taxRate: 0.06625, now: NOW };
const go = (s: DealStageState | null, a: StageAction, actor: "buyer" | "dealer", extra: object = {}) => {
  const r = applyStageAction(s, { ...a, actor }, { ...ctx, ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; state: DealStageState }).state;
};
const atPayment = () => go(go(go(initialStageState({ tradeInExpected: true }), { type: "accept_otd" }, "buyer"), { type: "trade_offer", value: 9000 }, "dealer"), { type: "trade_accept" }, "buyer");
const atFinalCash = () => go(atPayment(), { type: "choose_cash" }, "buyer");
const atFinalFinance = () => {
  let s = go(atPayment(), { type: "request_finance", downPayment: 4000, termMonths: 60 }, "buyer");
  s = go(s, { type: "finance_quote", apr: 5.9, termMonths: 60, lenderName: "Ally" }, "dealer");
  return go(s, { type: "finance_accept" }, "buyer");
};
const accepted = (s: DealStageState = atFinalCash()) => go(s, { type: "accept_final" }, "buyer", { buyerContact: CONTACT });

const invite = (id: string, name: string, stage: DealStageState | null, over: Partial<RfqInvite> = {}): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: `desk${id}@${name.toLowerCase().replace(/\W/g, "")}.example`, status: "quoted", declineReason: null, invitedAt: "2026-10-11T00:00:00Z", respondedAt: "2026-10-11T01:00:00Z", deliveryStatus: "sent", viewToken: `tok${id}abcdefgh`,
    desk: { contactName: "Sam Rivera", role: "sales_manager", emailMasked: "s••@x.com", source: "rooftop" },
    quote: { id: `q${id}`, inviteId: id, dealerName: name, price: 40000, fees: [], totalOtdPrice: 43749, vin: "V", stockNumber: null, expiresAt: FUTURE, submittedAt: "2026-10-11T01:00:00Z", mustHaveAcknowledgement: true, notes: null,
      used: { kind: "cash", sellingPrice: 40000, addOns: [], noAddOns: true, rebates: [], miles: null, stockNumber: null, cpo: false, expiresAt: FUTURE, dueAtSigning: [{ name: "Sales tax", amount: 2650 }, { name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 300 }] } },
    stage, ...over }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "7", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: "2026-10-11T00:00:00Z", vin: "VIN", stockNumber: null, vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", mustHaves: [], approvalStatus: "approved",
    quotePrefs: { quoteType: "cash", staged: true, cash: { zip: "07030" } }, tradeInExpected: true, tradeIn: { vin: "T" }, invites, ...over }) as unknown as RfqRequest;

describe("the buyer's final screen", () => {
  const html = (s: DealStageState) => renderToStaticMarkup(<StagedDeals rfq={rfqOf([invite("11", "Test Motors", s)])} headers={{}} onRfq={() => {}} />);
  it("cash: summary shows OTD, trade, payoff, true OTD and method, then 'Accept final deal'", () => {
    const h = html(atFinalCash());
    assert.match(h, /data-testid="final-summary"/);
    assert.match(h, /Agreed out-the-door[\s\S]*\$43,749/); assert.match(h, /Trade-in[\s\S]*-\$9,000/); assert.match(h, /Payoff[\s\S]*\+\$2,000/);
    assert.match(h, /data-testid="final-true-otd"[^>]*>[\s\S]*\$36,749/); assert.match(h, /Paying cash/);
    assert.match(h, /data-testid="accept-final"[^>]*>Accept final deal</);
    assert.match(h, /data-testid="change-payment"/);
    assert.doesNotMatch(h, /final-apr|final-monthly/);
  });
  it("financed: the summary adds APR, term, monthly, amount financed, down payment and lender", () => {
    const h = html(atFinalFinance());
    assert.match(h, /data-testid="final-apr"[^>]*>[\s\S]*5\.9% \/ 60 months/); assert.match(h, /data-testid="final-monthly"/);
    assert.match(h, /Amount financed[\s\S]*\$32,749/); assert.match(h, /Down payment[\s\S]*\$4,000/); assert.match(h, /Ally/);
    assert.match(h, /Financing through the dealer/);
  });
  it("says exactly who gets the details and when, and shows nothing of them before acceptance", () => {
    const h = html(atFinalCash());
    assert.match(h, /data-testid="release-notice"[^>]*>When you accept, Test Motors gets your name, email, phone and ZIP[\s\S]*No other dealer ever receives them/);
    for (const secret of SECRETS) assert.ok(!h.includes(secret));
  });
  it("after acceptance there is no accept button and the buyer is told who has their details", () => {
    const h = html(accepted());
    assert.doesNotMatch(h, /accept-final|change-payment/);
    assert.match(h, /data-testid="stage-closed"[^>]*>Final deal accepted: paying cash at \$36,749 out the door\. Test Motors now has your name, email, phone and ZIP, and no other dealer does/);
  });
  it("is phone-friendly: inputs go full width below the sm breakpoint and the options stack", () => {
    assert.match(html(atPayment()), /grid gap-2 sm:grid-cols-3/, "the three payment choices stack on a phone");
    const buyer = read("components/StagedDeals.tsx"); const dealerSrc = read("components/DealerStagePanel.tsx");
    for (const src of [buyer, dealerSrc]) assert.match(src, /const input = "w-full min-w-0[^"]*sm:w-32/);
    assert.match(read("components/DealStageBar.tsx"), /grid grid-cols-2 gap-1\.5 sm:grid-cols-4/);
  });
});

describe("the dealer's page", () => {
  const dealer = (state: DealStageState, rfqOpen = true) => renderToStaticMarkup(<DealerStagePanel token="tok12345" stage={stageForDealer(state)!} quotedOtd={43749} hasTrade rfqOpen={rfqOpen} onChanged={() => {}} />);
  it("before acceptance: no contact details, only a statement that they come after acceptance", () => {
    for (const s of [atPayment(), atFinalCash(), atFinalFinance()]) {
      const h = dealer(s);
      for (const secret of SECRETS) assert.ok(!h.includes(secret));
      assert.doesNotMatch(h, /buyer-details/);
    }
    assert.match(dealer(atFinalCash()), /You get their contact details the moment they accept it, and not before/);
  });
  it("after acceptance: name, email, phone and ZIP appear on the winning dealer's page", () => {
    const h = dealer(accepted(), false);
    assert.match(h, /data-testid="buyer-details"/);
    for (const v of [CONTACT.name, CONTACT.email, CONTACT.phone, CONTACT.zip]) assert.ok(h.includes(v), v);
  });
  it("a not-selected dealer never gets the block, even holding an accepted stage", () => {
    const h = renderToStaticMarkup(<DealerStagePanel token="tok12345" stage={stageForDealer(accepted(), { notSelected: true })!} quotedOtd={43749} hasTrade rfqOpen={false} onChanged={() => {}} />);
    for (const secret of SECRETS) assert.ok(!h.includes(secret));
  });
  it("trade counter loop UI: accept, hold firm and revise; financing counter UI: accept, hold firm and revise", () => {
    const offered = go(go(initialStageState({ tradeInExpected: true }), { type: "accept_otd" }, "buyer"), { type: "trade_offer", value: 9000 }, "dealer");
    const t = dealer(go(offered, { type: "trade_counter", value: 11000, note: "KBB" }, "buyer"));
    assert.match(t, /data-testid="accept-trade-counter"/); assert.match(t, /data-testid="hold-trade"/); assert.match(t, /data-testid="revise-trade-offer"/); assert.match(t, /KBB/);
    assert.match(t, /data-testid="live-true-otd"/);
    const asked = go(atPayment(), { type: "request_finance", downPayment: 4000 }, "buyer");
    const quoted = go(asked, { type: "finance_quote", apr: 6.9, termMonths: 60, lenderName: "Ally" }, "dealer");
    const countered = go(quoted, { type: "finance_counter", apr: 5.9, note: "credit union" }, "buyer");
    const f = dealer(countered);
    assert.match(f, /data-testid="accept-finance-counter"/); assert.match(f, /data-testid="hold-finance"/); assert.match(f, /Send revised offer/);
    assert.match(f, /5\.9%/);
    assert.match(dealer(quoted), /data-testid="dealer-finance-waiting"/);
  });
  it("the dealer's offer form shows the calculated payment and sends the monthly and amount financed with it", () => {
    const src = read("components/DealerStagePanel.tsx");
    assert.match(src, /monthly: math\.monthly, amountFinanced: math\.amountFinanced/);
    assert.match(src, /data-testid="finance-preview"/);
  });
});

describe("privacy: no dealer sees contact details before acceptance; losing dealers never do", () => {
  const winnerAccepted = accepted();
  const loserStage = go(go(initialStageState({ tradeInExpected: true }), { type: "accept_otd" }, "dealer"), { type: "walk" }, "dealer");
  it("every state a dealer can be in before acceptance carries no details, in any serialised form", () => {
    const states = [initialStageState({ tradeInExpected: true }), atPayment(), atFinalCash(), atFinalFinance(), loserStage];
    for (const s of states) {
      const seen = JSON.stringify(stageForDealer(s));
      for (const secret of [...SECRETS, CONTACT.zip + "\"contact"]) assert.ok(!seen.includes(secret), secret);
      assert.equal(stageForDealer(s)!.release, null);
    }
  });
  it("only the winning invite's view of the request carries the release", () => {
    const rfq = rfqOf([
      invite("11", "Winner", winnerAccepted),
      invite("12", "Loser A", go(go(initialStageState({ tradeInExpected: true }), { type: "accept_otd" }, "buyer"), { type: "trade_offer", value: 1000 }, "dealer"), { notSelectedAt: "2026-10-11T12:00:00Z" } as never),
      invite("13", "Loser B", null, { notSelectedAt: "2026-10-11T12:00:00Z" } as never),
    ], { status: "picked" });
    const views = rfq.invites.map((i) => JSON.stringify(stageForDealer(stageOf(rfq, i), { notSelected: Boolean(i.notSelectedAt) })));
    assert.ok(views[0].includes(CONTACT.email));
    assert.ok(!views[1].includes(CONTACT.email) && !views[2].includes(CONTACT.email));
  });
  it("the dealer context route filters every response through stageForDealer, and the dealer stage route does too", () => {
    assert.match(read("app/api/quote-invite/context/route.ts"), /stage: stageForDealer\(stageOf\(rfq, invite\), \{ notSelected: Boolean\(invite\.notSelectedAt\) \}\)/);
    assert.match(read("app/api/quote-invite/stage/route.ts"), /stageForDealer\(result\.stage/);
  });
  it("the browser can never supply the details: no allow-listed action carries a contact field", () => {
    const input = read("lib/dealStageInput.ts");
    assert.doesNotMatch(input, /buyerContact|phone|email/);
    const route = read("app/api/rfqs/[id]/invites/[inviteId]/stage/route.ts");
    assert.match(route, /action\.type === "accept_final"/);
    assert.doesNotMatch(route, /body\??\.(buyerContact|contact|email|phone)/);
    assert.doesNotMatch(read("app/api/quote-invite/stage/route.ts"), /buyerContact/);
  });
  it("no stage notice email (either direction, any action) ever contains the details", () => {
    const states = [atPayment(), atFinalCash(), atFinalFinance(), winnerAccepted, loserStage];
    const types = ["accept_otd", "add_trade", "skip_trade", "trade_offer", "trade_hold", "trade_counter", "trade_accept", "trade_accept_counter", "choose_cash", "choose_own_financing", "request_finance", "finance_quote", "finance_hold", "finance_counter", "finance_accept", "finance_accept_counter", "change_payment", "accept_final", "walk"] as const;
    for (const state of states) for (const actor of ["buyer", "dealer"] as const) for (const type of types) {
      const n = buildStageNotice({ actor, action: { type }, state, dealerName: "Test Motors", vehicle: "2026 Toyota RAV4", url: "https://example.test/x" });
      if (!n) continue;
      for (const secret of [...SECRETS, CONTACT.zip]) assert.ok(!n.html.includes(secret) && !n.subject.includes(secret), `${actor}/${type}: ${secret}`);
    }
    assert.equal(buildStageNotice({ actor: "buyer", action: { type: "accept_final" }, state: winnerAccepted, dealerName: "Test Motors", vehicle: "v", url: "u" }), null, "the release email replaces a stage notice");
  });
  it("the box's stage log and rfq events never receive them", () => {
    assert.ok(!JSON.stringify(winnerAccepted.log).includes(CONTACT.email));
    assert.match(read("scrapers/lightsail-crawler/src/rfqStages.js"), /buyer_details_released", \{ inviteId, dealerName: invite\.dealer_name, actor: "system", action: "release"/);
  });
});

describe("the 'Deal accepted, here's your buyer' email", () => {
  const input = () => {
    const s = accepted(atFinalFinance());
    return { dealerName: "Test Motors", vehicle: "2026 Toyota RAV4 XLE", dealReference: "TS-7A", summary: finalSummary(s), contact: s.release!.contact, url: "https://example.test/view?t=tok" };
  };
  it("has the agreed subject and the buyer's name, email, phone and ZIP", () => {
    const m = buildBuyerDetailsEmail(input());
    assert.equal(BUYER_DETAILS_SUBJECT, "Deal accepted, here's your buyer");
    assert.equal(m.subject, "Deal accepted, here's your buyer: 2026 Toyota RAV4 XLE");
    for (const v of [CONTACT.name, CONTACT.email, CONTACT.phone, CONTACT.zip]) assert.ok(m.html.includes(v), v);
  });
  it("states the deal: OTD, trade, payoff, true OTD, and the financing terms with matching payment math", () => {
    const m = buildBuyerDetailsEmail(input());
    for (const v of ["$43,749", "$9,000", "$2,000", "$36,749", "5.9% for 60 months", "Ally", "$4,000", "$32,749"]) assert.ok(m.html.includes(v), v);
    const sm = input().summary;
    assert.ok(m.html.includes(`$${sm.monthly!.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`));
    assert.ok(m.html.includes("not shared with any other dealer"));
  });
  it("escapes the buyer's text so a name cannot inject markup", () => {
    const m = buildBuyerDetailsEmail({ ...input(), contact: { ...CONTACT, name: "<script>alert(1)</script>" } });
    assert.ok(!m.html.includes("<script>"));
  });
  it("cash and own-financing deals say so and omit the dealer-finance rows", () => {
    const cash = buildBuyerDetailsEmail({ ...input(), summary: finalSummary(accepted(atFinalCash())) });
    assert.match(cash.html, /Paying cash/); assert.doesNotMatch(cash.html, /Amount financed|APR \/ term/);
  });
});

describe("routing: the release goes through the outbox, SAFE MODE only, winner only", () => {
  const winner = (s: DealStageState | null = accepted()) => invite("11", "Test Motors", s);
  const calls = () => { const c: Array<[string, string]> = []; return { c, send: (async (subject: string, html: string) => { c.push([subject, html]); return true; }) as typeof sendQuoteInviteEmail }; };
  it("sends once to the winner, tagged SAFE MODE with the intended dealer, with the details in the body", async () => {
    const r = calls();
    const rfq = rfqOf([winner()], { status: "picked" });
    assert.equal(await sendBuyerDetailsRelease(rfq, rfq.invites[0], { send: r.send, emailEnabled: () => true }), "sent");
    assert.equal(r.c.length, 1);
    assert.match(r.c[0][0], /^\[SAFE MODE · Test Motors\] Deal accepted, here's your buyer/);
    assert.match(r.c[0][1], /SAFE MODE:<\/strong> redirected here instead of Test Motors/);
    assert.ok(r.c[0][1].includes(CONTACT.email));
  });
  it("sends nothing before acceptance, for a closed-out dealer, an unreleased request, or with the email switch off", async () => {
    for (const [label, rfq, inv, enabled, want] of [
      ["unaccepted final review", rfqOf([winner(atFinalCash())]), winner(atFinalCash()), true, "not_accepted"],
      ["payment stage", rfqOf([winner(atPayment())]), winner(atPayment()), true, "not_accepted"],
      ["no stage at all", rfqOf([winner(null)]), winner(null), true, "not_accepted"],
      ["walked", rfqOf([winner(go(atFinalCash(), { type: "walk" }, "dealer"))]), winner(go(atFinalCash(), { type: "walk" }, "dealer")), true, "not_accepted"],
      ["not selected", rfqOf([winner()]), { ...winner(), notSelectedAt: "2026-10-11T12:00:00Z" } as RfqInvite, true, "not_winner"],
      ["unreleased request", rfqOf([winner()], { approvalStatus: "pending" } as never), winner(), true, "held_for_approval"],
      ["email switch off", rfqOf([winner()]), winner(), false, "parked_switch_off"],
    ] as const) {
      const r = calls();
      assert.equal(await sendBuyerDetailsRelease(rfq, inv, { send: r.send, emailEnabled: () => enabled }), want, label);
      assert.equal(r.c.length, 0, label);
    }
  });
  it("a losing dealer's invite can never trigger it, even with another dealer's stage attached", async () => {
    const r = calls();
    const rfq = rfqOf([winner(), invite("12", "Loser", null, { notSelectedAt: "2026-10-11T12:00:00Z" } as never)], { status: "picked" });
    assert.equal(await sendBuyerDetailsRelease(rfq, rfq.invites[1], { send: r.send, emailEnabled: () => true }), "not_accepted");
    assert.equal(r.c.length, 0);
  });
  for (const [label, over] of [["a real (non-audit) deal", {}], ["an audit=1 deal", { audit: true }], ["a buyer test-mode deal", { auditForcedSafeMode: true }]] as const) {
    it(`with the real sender, ${label} posts only to ${SAFE_MODE_RECIPIENT}, never the dealer's or the buyer's address`, async () => {
      const original = globalThis.fetch; const prevKey = process.env.RESEND_API_KEY; const bodies: Array<{ to: string[]; subject: string }> = [];
      process.env.RESEND_API_KEY = "re_test_key";
      globalThis.fetch = (async (_u: unknown, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as never;
      try {
        const rfq = rfqOf([winner()], { status: "picked", ...over } as never);
        assert.equal(await sendBuyerDetailsRelease(rfq, rfq.invites[0], { send: sendQuoteInviteEmail, emailEnabled: () => true }), "sent");
        assert.deepEqual(bodies.map((b) => b.to), [[SAFE_MODE_RECIPIENT]]);
        assert.ok(!JSON.stringify(bodies.map((b) => b.to)).includes(rfq.invites[0].dealerContactEmail as string));
        assert.ok(!JSON.stringify(bodies.map((b) => b.to)).includes(CONTACT.email));
      } finally {
        globalThis.fetch = original; if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
      }
    });
  }
  it("the sender still has no `to` parameter, and the buyer route sends the release through the outbox after the response", () => {
    const sender = read("lib/dealerEmail.ts");
    assert.match(sender, /async function sendViaResend\(subject: string, html: string\)/);
    assert.match(sender, /to: \[SAFE_MODE_RECIPIENT\]/);
    const route = read("app/api/rfqs/[id]/invites/[inviteId]/stage/route.ts");
    assert.match(route, /after\(async \(\) => \{ await sendBuyerDetailsRelease\(result\.rfq, winner\); \}\)/);
    assert.match(route, /action\.type === "accept_final" && result\.stage\.release/);
  });
  it("the rollout flag is untouched: staged requests (and so all of this) only exist when FEATURE_DEAL_STAGES is on", () => {
    assert.match(read("lib/featureFlags.ts"), /dealStages: "FEATURE_DEAL_STAGES"/);
    assert.match(read("app/api/rfqs/route.ts"), /gateStagedPrefs\(parseQuotePrefs\(body\.quotePrefs\), featureEnabled\("dealStages"\)\)/);
  });
});
