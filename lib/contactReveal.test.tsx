// "Reveal buyer contact info": the signed 30-day single-dealer token, the rate-limited reveal route logic, the box handler that
// logs every reveal (against an in-memory fake of the two tables it touches), and the buyer's "Dealer viewed your contact info" line.
// The email itself (no contact details) is tested in buyerRelease.test.tsx.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyStageAction, initialStageState, revealContact, stageForDealer, type DealStageState, type StageAction } from "./dealStages";
import { REVEAL_TOKEN_TTL_MS, signRevealToken, verifyRevealToken } from "./contactRevealToken";
import { describeReveal, performReveal, type RevealDeps } from "./contactReveal";
import { resetRateLimitsForTests } from "./rateLimit";
import { RfqApiError } from "./rfqApi";
import { StagedDeals } from "../components/StagedDeals";
import { createRfqContactRevealHandler } from "../scrapers/lightsail-crawler/src/rfqContactReveal.js";
import type { RfqInvite, RfqRequest } from "./rfq";

process.env.LIGHTSAIL_API_KEY ||= "test-signing-key";
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const T0 = Date.parse("2026-10-30T12:00:00Z");
const CONTACT = { name: "Pat Buyer", email: "pat.buyer@example.com", phone: "555-0142", zip: "07030" };
const FUTURE = "2099-01-01T00:00:00Z";
const ctx = { otdAmount: 43749, hasTradeInOnFile: false, tradePayoff: null, state: "NJ", taxRate: 0.06625, now: new Date(T0) };
const go = (s: DealStageState | null, a: StageAction, actor: "buyer" | "dealer", extra: object = {}) => {
  const r = applyStageAction(s, { ...a, actor }, { ...ctx, ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; state: DealStageState }).state;
};
const acceptedState = () => go(go(go(initialStageState({ tradeInExpected: false }), { type: "accept_otd" }, "buyer"), { type: "choose_cash" }, "buyer"), { type: "accept_final" }, "buyer", { buyerContact: CONTACT });

const invite = (id: string, name: string, stage: DealStageState | null, over: object = {}): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: null, status: "quoted", viewToken: `tok${id}abcdefgh`, vehicle: { vin: "VINX" },
    quote: { id: `q${id}`, inviteId: id, price: 40000, fees: [], totalOtdPrice: 43749, used: { kind: "cash", sellingPrice: 40000, addOns: [], noAddOns: true, rebates: [], dueAtSigning: [], expiresAt: FUTURE } }, stage, ...over }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[]): RfqRequest =>
  ({ id: "7", buyerUserId: "2", status: "picked", pickedQuoteId: null, vin: "VINX", vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", approvalStatus: "approved", quotePrefs: { quoteType: "cash", staged: true }, invites }) as unknown as RfqRequest;

/** An in-memory deals box: the real reveal handler over a fake pool, so the log and the stamp are exercised for real. */
function box(invites: Record<string, { dealer_name: string; stage: DealStageState | null; not_selected_at?: string | null }>) {
  const rows: Record<string, { id: string; rfq_id: string; dealer_name: string; stage_json: string | null; not_selected_at: string | null }> = {};
  for (const [id, v] of Object.entries(invites)) rows[id] = { id, rfq_id: "7", dealer_name: v.dealer_name, stage_json: v.stage ? JSON.stringify(v.stage) : null, not_selected_at: v.not_selected_at ?? null };
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const pool = {
    query: async (sql: string, args: unknown[] = []) => {
      if (/FROM rfq_requests/.test(sql)) return [[{ id: 7, deleted_at: null }]];
      if (/SELECT \* FROM rfq_invites/.test(sql)) return [[rows[String(args[0])]].filter(Boolean)];
      if (/UPDATE rfq_invites SET stage_json/.test(sql)) { const r = rows[String(args[1])]; if ((r.stage_json ?? null) !== (args[3] ?? null)) return [{ affectedRows: 0 }]; r.stage_json = args[0] as string; return [{ affectedRows: 1 }]; }
      throw new Error("unexpected sql " + sql);
    },
  };
  let key: string | null = null;
  const handle = createRfqContactRevealHandler({ getPool: () => pool, sendJson: (res: { status?: number; json?: unknown }, status: number, json: unknown) => { res.status = status; res.json = json; }, ensureColumns: async () => {}, logRfqEvent: async (_p: unknown, _id: unknown, type: string, payload: Record<string, unknown>) => { events.push({ type, payload }); }, auditKind: () => key, now: () => new Date(clock.t) });
  const call = async (inviteId: string) => { const res: { status?: number; json?: { contact?: unknown; reveals?: { count: number } } } = {}; await handle({}, res, 7, Number(inviteId)); return res; };
  return { rows, events, call, asKey: (k: string | null) => { key = k; } };
}
const clock = { t: T0 };

function world(over: { winnerNotSelected?: boolean; boxDown?: boolean } = {}) {
  const stage = acceptedState();
  const b = box({ "11": { dealer_name: "Winner Motors", stage }, "12": { dealer_name: "Loser Motors", stage: null, not_selected_at: "2026-10-30T11:00:00Z" } });
  const rfq = rfqOf([invite("11", "Winner Motors", stage, over.winnerNotSelected ? { notSelectedAt: "2026-10-30T11:30:00Z" } : {}), invite("12", "Loser Motors", null, { notSelectedAt: "2026-10-30T11:00:00Z" })]);
  const deps: RevealDeps = {
    getRfq: async () => rfq,
    revealOnBox: async (rfqId, inviteId) => {
      if (over.boxDown) throw new RfqApiError("down", 502);
      const r = await b.call(inviteId);
      if (r.status !== 200) throw new RfqApiError("refused", r.status ?? 500);
      return r.json as never;
    },
    now: T0,
  };
  return { b, rfq, deps, tokenFor: (i: string) => signRevealToken("7", i, T0) };
}

beforeEach(() => { resetRateLimitsForTests(); clock.t = T0; });

describe("the signed reveal token", () => {
  it("verifies, binds one rfq and one invite, and lasts exactly 30 days", () => {
    const t = signRevealToken("7", "11", T0);
    const v = verifyRevealToken(t, T0 + 1000);
    assert.ok(v.ok && v.claims.rfqId === "7" && v.claims.inviteId === "11");
    assert.equal(REVEAL_TOKEN_TTL_MS, 30 * 24 * 3600 * 1000);
    assert.ok(verifyRevealToken(t, T0 + REVEAL_TOKEN_TTL_MS - 1).ok);
    assert.deepEqual(verifyRevealToken(t, T0 + REVEAL_TOKEN_TTL_MS), { ok: false, reason: "expired" });
  });
  it("rejects tampering (changed invite, changed expiry, another secret), junk and non-strings", () => {
    const t = signRevealToken("7", "11", T0);
    const [body, sig] = t.split(".");
    const forge = (patch: object) => `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), ...patch })).toString("base64url")}.${sig}`;
    assert.equal((verifyRevealToken(forge({ i: "12" }), T0) as { reason: string }).reason, "bad_signature");
    assert.equal((verifyRevealToken(forge({ e: T0 + 9e12 }), T0) as { reason: string }).reason, "bad_signature");
    assert.equal((verifyRevealToken(signRevealToken("7", "11", T0, "other-secret"), T0) as { reason: string }).reason, "bad_signature");
    for (const junk of ["", "abc", "a.b.c", null, undefined, 42, "x".repeat(500)]) assert.equal(verifyRevealToken(junk, T0).ok, false);
  });
  it("is not the invite's view token and the view token cannot open the reveal", async () => {
    const w = world();
    const out = await performReveal("tok11abcdefgh", "1.1.1.1", w.deps);
    assert.notEqual(out.status, 200); assert.equal(w.b.events.length, 0);
  });
});

describe("the reveal works only with a valid token", () => {
  it("a valid token for the winner shows the buyer's details", async () => {
    const w = world();
    const out = await performReveal(w.tokenFor("11"), "1.1.1.1", w.deps);
    assert.equal(out.status, 200);
    assert.deepEqual((out.body as { contact: unknown }).contact, CONTACT);
  });
  it("no, malformed, forged and expired tokens reveal nothing and never reach the box", async () => {
    const w = world();
    const good = w.tokenFor("11");
    const expired = signRevealToken("7", "11", T0 - REVEAL_TOKEN_TTL_MS - 1);
    for (const [t, status] of [["", 400], ["nonsense", 400], [good.slice(0, -2) + "xx", 403], [expired, 410]] as const) {
      const out = await performReveal(t, "2.2.2.2", w.deps);
      assert.equal(out.status, status, String(t));
      assert.ok(!JSON.stringify(out.body).includes(CONTACT.email));
    }
    assert.equal(w.b.events.length, 0);
    assert.equal(JSON.parse(w.b.rows["11"].stage_json!).release.reveals, undefined);
  });
  it("another dealer's token never reveals: a closed-out dealer's link gets nothing, and the page summary is the token's own deal", async () => {
    const w = world();
    const out = await performReveal(w.tokenFor("12"), "3.3.3.3", w.deps);
    assert.equal(out.status, 409);
    assert.ok(!JSON.stringify(out.body).includes(CONTACT.email));
    const noSuchInvite = await performReveal(signRevealToken("7", "99", T0), "3.3.3.3", w.deps);
    assert.equal(noSuchInvite.status, 404);
    assert.equal(w.b.events.length, 0);
    const route = read("app/api/quote-invite/reveal-contact/route.ts");
    assert.doesNotMatch(route, /inviteId|searchParams\.get\("(i|invite|rfq)/, "the route never takes an invite id from the request");
  });
  it("a winner who was closed out afterwards cannot reveal either", async () => {
    const w = world({ winnerNotSelected: true });
    assert.equal((await performReveal(w.tokenFor("11"), "4.4.4.4", w.deps)).status, 409);
  });
  it("the GET that fills the page shows the vehicle, VIN and total, never the details, and logs no reveal", async () => {
    const w = world();
    const out = await describeReveal(w.tokenFor("11"), "5.5.5.5", w.deps);
    assert.equal(out.status, 200);
    const s = (out.body as { summary: { vehicle: string; vin: string; acceptedOtd: number; netAfterTrade: number | null } }).summary;
    assert.deepEqual([s.vehicle, s.vin, s.acceptedOtd, s.netAfterTrade], ["2026 Toyota RAV4 XLE", "VINX", 43749, null]);
    for (const secret of [CONTACT.email, CONTACT.name, CONTACT.phone]) assert.ok(!JSON.stringify(out.body).includes(secret));
    assert.equal(w.b.events.length, 0);
  });
});

describe("the page summary with a trade attached", () => {
  it("shows the quoted price and the net after trade-in", async () => {
    const tctx = { ...ctx, hasTradeInOnFile: true, tradePayoff: 2000 };
    const step = (s: DealStageState | null, a: StageAction, actor: "buyer" | "dealer", extra: object = {}) => (applyStageAction(s, { ...a, actor }, { ...tctx, ...extra }) as { ok: true; state: DealStageState }).state;
    let st = step(initialStageState({ tradeInExpected: true }), { type: "accept_otd" }, "buyer");
    st = step(st, { type: "trade_offer", value: 9000 }, "dealer");
    st = step(st, { type: "trade_accept" }, "buyer");
    st = step(step(st, { type: "choose_cash" }, "buyer"), { type: "accept_final" }, "buyer", { buyerContact: CONTACT });
    const deps: RevealDeps = { getRfq: async () => rfqOf([invite("11", "Winner Motors", st)]), revealOnBox: async () => { throw new Error("not called"); }, now: T0 };
    const out = await describeReveal(signRevealToken("7", "11", T0), "6.6.6.6", deps);
    const s = (out.body as { summary: { acceptedOtd: number; netAfterTrade: number } }).summary;
    assert.deepEqual([s.acceptedOtd, s.netAfterTrade], [43749, 36749]);
  });
});

describe("every reveal is logged", () => {
  it("each press adds a log event (dealer, quote request, time) and bumps the stamp; the event carries no details", async () => {
    const w = world();
    await performReveal(w.tokenFor("11"), "6.6.6.6", w.deps);
    clock.t = T0 + 3600_000;
    await performReveal(w.tokenFor("11"), "6.6.6.6", w.deps);
    assert.equal(w.b.events.length, 2);
    assert.deepEqual(w.b.events.map((e) => e.type), ["buyer_contact_revealed", "buyer_contact_revealed"]);
    assert.equal(w.b.events[0].payload.inviteId, 11); // dealer's invite
    assert.equal(w.b.events[0].payload.dealerName, "Winner Motors");
    assert.ok(!JSON.stringify(w.b.events).includes(CONTACT.email) && !JSON.stringify(w.b.events).includes(CONTACT.phone));
    const stored = JSON.parse(w.b.rows["11"].stage_json!);
    assert.equal(stored.release.reveals.count, 2);
    assert.equal(stored.release.reveals.firstAt, new Date(T0).toISOString());
    assert.equal(stored.release.reveals.lastAt, new Date(T0 + 3600_000).toISOString());
    assert.equal(stored.log.filter((e: { type: string }) => e.type === "buyer_contact_revealed").length, 2);
    assert.ok(!JSON.stringify(stored.log).includes(CONTACT.email));
  });
  it("fails closed: if the box cannot log the reveal, nothing is revealed", async () => {
    const w = world({ boxDown: true });
    const out = await performReveal(w.tokenFor("11"), "7.7.7.7", w.deps);
    assert.equal(out.status, 503);
    assert.ok(!JSON.stringify(out.body).includes(CONTACT.email));
  });
  it("the box handler refuses a closed-out invite, an unaccepted deal and the audit buyer key, and logs nothing", async () => {
    const b = box({ "12": { dealer_name: "Loser", stage: acceptedState(), not_selected_at: "2026-10-30T11:00:00Z" }, "13": { dealer_name: "Pending", stage: go(initialStageState({ tradeInExpected: false }), { type: "accept_otd" }, "buyer") }, "14": { dealer_name: "Win", stage: acceptedState() } });
    assert.equal((await b.call("12")).status, 409);
    assert.equal((await b.call("13")).status, 409);
    b.asKey("audit");
    assert.equal((await b.call("14")).status, 403);
    assert.equal(b.events.length, 0);
  });
  it("the pure state helper only reveals on a finally accepted deal and never invents a release", () => {
    assert.equal(revealContact(null).ok, false);
    assert.equal(revealContact(initialStageState({ tradeInExpected: false })).ok, false);
    const r = revealContact(acceptedState(), new Date(T0));
    assert.ok(r.ok && r.state.release?.reveals?.count === 1);
  });
  it("the box handler is a standalone module and the wiring is documented but NOT applied to the pinned live-file mirror", () => {
    const doc = read("docs/BUYER_CONTACT_REVEAL.md");
    assert.match(doc, /createRfqContactRevealHandler/);
    assert.match(doc, /reveal-contact/);
    assert.doesNotMatch(read("scrapers/lightsail-crawler/src/deals_api_server.js"), /rfqContactReveal/);
  });
});

describe("the endpoint is rate limited", () => {
  it("per IP: the 31st call in the window gets 429 with Retry-After seconds, even with garbage tokens", async () => {
    const w = world();
    let last = await performReveal("x", "9.9.9.9", w.deps);
    for (let i = 0; i < 30; i++) last = await performReveal("x", "9.9.9.9", w.deps);
    assert.equal(last.status, 429);
    assert.ok((last.body as { retryAfterSec: number }).retryAfterSec > 0);
    assert.notEqual((await performReveal("x", "8.8.8.8", w.deps)).status, 429, "another IP is unaffected");
  });
  it("per token: one dealer's link is capped even when the calls come from many IPs", async () => {
    const w = world();
    const t = w.tokenFor("11");
    let last = await performReveal(t, "10.0.0.0", w.deps);
    for (let i = 1; i <= 12; i++) last = await performReveal(t, `10.0.0.${i}`, w.deps);
    assert.equal(last.status, 429);
  });
  it("the route answers with the verdict's status, Retry-After, and no-store", () => {
    const route = read("app/api/quote-invite/reveal-contact/route.ts");
    assert.match(route, /"Retry-After"/);
    assert.match(route, /no-store/);
  });
});

describe("the buyer sees that the dealer looked", () => {
  const view = (reveals?: { count: number; firstAt: string; lastAt: string }) => {
    const base = acceptedState();
    const stage = reveals ? { ...base, release: { ...base.release!, reveals } } : base;
    const rfq = rfqOf([invite("11", "Winner Motors", stage)]);
    return renderToStaticMarkup(<StagedDeals rfq={rfq} headers={{}} onRfq={() => {}} />);
  };
  it("shows 'Dealer viewed your contact info' with the time once revealed, and nothing before", () => {
    assert.doesNotMatch(view(), /dealer-viewed-contact/);
    const h = view({ count: 1, firstAt: "2026-10-30T15:30:00Z", lastAt: "2026-10-30T15:30:00Z" });
    assert.match(h, /data-testid="dealer-viewed-contact"[^>]*>Dealer viewed your contact info · Oct 30, 2026/);
  });
  it("the buyer's page no longer says the dealer already has their details", () => {
    assert.doesNotMatch(view(), /now has your name, email, phone/);
  });
  it("a dealer-facing stage never carries the contact, only the marker", () => {
    const dealerView = stageForDealer(acceptedState());
    assert.equal(dealerView!.release!.contact, undefined);
    assert.ok(dealerView!.release!.at);
  });
});
