// The whole trade-with-the-quote flow through the app's own client code (lib/rfqApi.ts, lib/trade/*) against the REAL deals-box
// handlers (rfqTradeConfirm.js) on an in-memory database, behind a fake fetch. Covers: a trade quote without an allowance is refused,
// pick opens the confirm step, confirm / revise / accept / go back / walk, the deadline default, the guardrail, the audit log,
// the buyer editing after quotes, and who may see what.
import "../testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { env } from "node:process";
import { actOnTradeConfirmation, getRfq, getRfqInviteByViewToken, listTradeAudit, pickRfqQuote, reconfirmTradeAppraisal, RfqApiError, submitRfqQuote, sweepTradeConfirmations } from "../rfqApi";
import { createRfqTradeConfirmHandlers } from "../../scrapers/lightsail-crawler/src/rfqTradeConfirm.js";
import { tradeAnswerProblem as boxGuard } from "../../scrapers/lightsail-crawler/src/tradeConfirm.js";
import { recordTradeWithQuote } from "./quoteTrade";
import { openConfirmAfterPick, sweepIfDue } from "./confirmFlow";
import { appraisalForCompare, dueExpiries, openConfirmationOf, publicConfirmation, tradeConfirmConfig, type TradeConfirmation } from "./confirm";
import { dealerMayViewTrade } from "./access";
import { tradeEquity } from "./otd";
import { publicRfqForBuyer, type RfqInvite } from "../rfq";

env.LIGHTSAIL_API_KEY = "test-secret";
const FUTURE = new Date(Date.now() + 14 * 86400000).toISOString();
const QUOTE_EXP = new Date(Date.now() + 10 * 86400000).toISOString();
const TRADE = { vin: "1HGCM82633A004352", payoffEstimate: 4000, ownership: "financed", lenderName: "Chase", photos: [], updatedAt: new Date(Date.now() - 86400000).toISOString() };
const goodTrade = (n = 10000, over: Record<string, unknown> = {}) => ({ allowance: { mode: "single", single: String(n) }, basis: "preliminary", goodUntil: FUTURE, payoffConfirmed: true, conditions: "assumes no frame damage", conditionChips: ["no_frame_damage"], ...over });

type Row = Record<string, any>;
function box(opts: { trade?: boolean } = {}) {
  const db = {
    rfq: { id: 7, status: "collecting", picked_quote_id: null as number | null, trade_in_json: opts.trade === false ? null : JSON.stringify(TRADE), deleted_at: null },
    invites: {
      11: { id: 11, rfq_id: 7, dealer_name: "Winner Honda", status: "invited", not_selected_at: null, trade_appraisal_json: null, trade_confirmation_json: null, token: "winnertoken1" } as Row,
      12: { id: 12, rfq_id: 7, dealer_name: "Other Honda", status: "invited", not_selected_at: null, trade_appraisal_json: null, trade_confirmation_json: null, token: "othertoken12" } as Row,
    } as Record<number, Row>,
    quotes: {} as Record<number, Row>, audit: [] as Row[], nextQuote: 99,
  };
  const parse = (v: any) => (v == null || v === "" ? null : typeof v !== "string" ? v : JSON.parse(v));
  const q = async (sql: string, args: any[] = []) => {
    if (/^SELECT \* FROM rfq_requests WHERE id/.test(sql)) return [[db.rfq]];
    if (/^SELECT \* FROM rfq_invites WHERE id = \? AND rfq_id/.test(sql)) return [[db.invites[args[0]]].filter(Boolean)];
    if (/^SELECT \* FROM rfq_invites WHERE rfq_id = \? AND trade_confirmation_json IS NOT NULL/.test(sql)) return [Object.values(db.invites).filter((i) => i.trade_confirmation_json)];
    if (/^SELECT invite_id FROM rfq_quotes WHERE id/.test(sql)) return [[db.quotes[args[0]]].filter(Boolean)];
    if (/^SELECT \* FROM rfq_quotes WHERE invite_id/.test(sql)) return [Object.values(db.quotes).filter((x) => x.invite_id === args[0]).slice(-1)];
    if (/^SELECT \* FROM rfq_trade_audit/.test(sql)) return [db.audit.map((a, i) => ({ id: i + 1, ...a }))];
    if (/^UPDATE rfq_invites SET trade_appraisal_json/.test(sql)) { db.invites[args[1]].trade_appraisal_json = args[0]; return [{ affectedRows: 1 }]; }
    if (/^UPDATE rfq_invites SET trade_confirmation_json/.test(sql)) { const inv = db.invites[args[1]]; if ((inv.trade_confirmation_json ?? null) !== (args[3] ?? null)) return [{ affectedRows: 0 }]; inv.trade_confirmation_json = args[0]; return [{ affectedRows: 1 }]; }
    if (/^UPDATE rfq_requests SET status = 'collecting', picked_quote_id = NULL/.test(sql)) { if (db.rfq.status === "picked") { db.rfq.status = "collecting"; db.rfq.picked_quote_id = null; } return [{ affectedRows: 1 }]; }
    if (/^UPDATE rfq_requests SET status = 'walked'/.test(sql)) { if (db.rfq.status === "picked") db.rfq.status = "walked"; return [{ affectedRows: 1 }]; }
    if (/^INSERT INTO rfq_trade_audit/.test(sql)) { db.audit.push({ rfq_id: args[0], invite_id: args[1], actor: args[2], action: args[3], from_json: args[4], to_json: args[5], detail_json: args[6], at: args[7] }); return [{ affectedRows: 1 }]; }
    throw new Error("unexpected sql: " + sql);
  };
  const pool = { query: q, getConnection: async () => ({ query: q, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} }) };
  const publicInvite = (r: Row) => {
    const quote = Object.values(db.quotes).find((x) => x.invite_id === r.id);
    return { id: String(r.id), dealerName: r.dealer_name, status: r.status, viewToken: r.token, notSelectedAt: r.not_selected_at, tradeAppraisal: parse(r.trade_appraisal_json), tradeConfirmation: parse(r.trade_confirmation_json), quote: quote ? { id: String(quote.id), expiresAt: quote.expires_at, used: quote.used } : null };
  };
  const publicRfq = (r: Row) => ({ id: String(r.id), buyerUserId: "buyer1", status: r.status, pickedQuoteId: r.picked_quote_id == null ? null : String(r.picked_quote_id), tradeIn: parse(r.trade_in_json), vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", vin: "5J6RW2H89NL000001", invites: Object.values(db.invites).map(publicInvite), approvalStatus: "approved" });
  const h = createRfqTradeConfirmHandlers({
    getPool: () => pool, readBody: async (r: any) => r.body, sendJson: (res: any, s: number, o: any) => { res.status = s; res.json = o; },
    ensureColumns: async () => {}, loadInvites: async () => Object.values(db.invites).map(publicInvite), publicRfqRequest: (r: Row) => publicRfq(r),
    logRfqEvent: async () => {}, auditKind: () => null,
  });
  const calls: string[] = [];
  const fakeFetch = async (input: any, init: any = {}) => {
    const url = new URL(String(input)); const body = init.body ? JSON.parse(init.body) : {}; const method = init.method || "GET"; const p = url.pathname;
    calls.push(`${method} ${p}`);
    const reply = (status: number, json: any) => new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
    let m: RegExpMatchArray | null;
    if (method === "GET" && (m = p.match(/^\/api\/rfqs\/(\d+)$/))) return reply(200, { rfq: publicRfq(db.rfq) });
    if (method === "GET" && (m = p.match(/^\/api\/rfq-invites\/by-token\/(.+)$/))) { const inv = Object.values(db.invites).find((i) => i.token === m![1]); return inv ? reply(200, { rfqId: String(inv.rfq_id), invite: publicInvite(inv) }) : reply(404, { error: "not found" }); }
    if (method === "POST" && (m = p.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/quotes$/))) {
      const inv = db.invites[Number(m[2])];
      if (db.rfq.trade_in_json) { const problem = boxGuard({ hasTrade: true, appraisal: parse(inv.trade_appraisal_json), quoteExpiresAt: body.expiresAt, now: new Date() }); if (problem) return reply(422, { error: problem, code: "trade_allowance_required" }); }
      const id = db.nextQuote++; db.quotes[id] = { id, invite_id: inv.id, expires_at: body.expiresAt, used: body.used ?? { kind: "cash", sellingPrice: body.price, dueAtSigning: [], addOns: [], rebates: [] }, superseded_at: null };
      inv.status = "quoted"; return reply(201, { quote: { id: String(id) } });
    }
    if (method === "POST" && (m = p.match(/^\/api\/rfqs\/(\d+)\/pick$/))) { db.rfq.status = "picked"; db.rfq.picked_quote_id = Number(body.quoteId); return reply(200, { rfq: publicRfq(db.rfq) }); }
    const run = async (fn: string, ...ids: number[]) => { const res: any = {}; await (h as any)[fn]({ body }, res, ...ids); return reply(res.status, res.json); };
    if (method === "POST" && (m = p.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/trade-appraisal$/))) return run("handleTradeAppraisal", Number(m[1]), Number(m[2]));
    if (method === "POST" && (m = p.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/trade-confirmation$/))) return run("handleTradeConfirmation", Number(m[1]), Number(m[2]));
    if (method === "POST" && (m = p.match(/^\/api\/rfqs\/(\d+)\/trade-confirmations\/sweep$/))) return run("handleTradeConfirmSweep", Number(m[1]));
    if (method === "GET" && (m = p.match(/^\/api\/rfqs\/(\d+)\/trade-audit$/))) return run("handleTradeAudit", Number(m[1]));
    return reply(404, { error: `fake box: no route for ${method} ${p}` });
  };
  return { db, fakeFetch, calls };
}

let realFetch: typeof fetch;
let b: ReturnType<typeof box>;
before(() => { realFetch = globalThis.fetch; });
after(() => { globalThis.fetch = realFetch; });
const useBox = (o?: Parameters<typeof box>[0]) => { b = box(o); globalThis.fetch = b.fakeFetch as typeof fetch; return b; };
afterEach(() => { globalThis.fetch = realFetch; });

const inviteOf = async (id: string): Promise<RfqInvite> => (await getRfq("7"))!.invites.find((i) => i.id === id)!;
/** What the dealer's quote route does: record the trade with the quote, then the quote. */
async function dealerQuotes(inviteId: string, tradeBody: unknown, price = 40000) {
  const rfq = (await getRfq("7"))!; const invite = rfq.invites.find((i) => i.id === inviteId)!;
  const traded = await recordTradeWithQuote({ rfq, invite, body: tradeBody === undefined ? {} : { trade: tradeBody }, quoteExpiresAt: QUOTE_EXP });
  if (!traded.ok) return traded;
  await submitRfqQuote("7", inviteId, { price, fees: [], vin: "5J6RW2H89NL000001", expiresAt: QUOTE_EXP, mustHaveAcknowledgement: true, used: { kind: "cash", sellingPrice: price, dueAtSigning: [], addOns: [], rebates: [], expiresAt: QUOTE_EXP } as never });
  return { ok: true as const };
}
const cfg = () => tradeConfirmConfig({});

describe("a quote on a trade request needs the allowance", () => {
  it("the API rejects a quote with no allowance, however it is posted, and stores nothing", async () => {
    useBox();
    const r = await dealerQuotes("11", undefined);
    assert.ok(!r.ok); if (!r.ok) { assert.equal(r.status, 422); assert.equal((r.body as { code: string }).code, "trade_allowance_required"); }
    assert.equal(b.db.quotes[99], undefined); assert.equal(b.db.invites[11].status, "invited");
    for (const bad of [goodTrade(0), goodTrade(-1), { ...goodTrade(), allowance: { mode: "single", single: "" } }]) assert.ok(!(await dealerQuotes("11", bad)).ok);
  });
  it("even if the app is skipped, the box refuses the vehicle quote", async () => {
    useBox();
    await assert.rejects(() => submitRfqQuote("7", "11", { price: 40000, fees: [], vin: "V", expiresAt: QUOTE_EXP, mustHaveAcknowledgement: true }), (e: unknown) => e instanceof RfqApiError && e.status === 422 && e.code === "trade_allowance_required");
  });
  it("accepts a single number, a range, or a decline, and stores it with audit rows", async () => {
    useBox();
    assert.ok((await dealerQuotes("11", goodTrade(10000, { conditionChips: ["second_key"] }))).ok);
    assert.ok((await dealerQuotes("12", { declined: { code: "salvage_title", note: "" } })).ok);
    const w = await inviteOf("11"), o = await inviteOf("12");
    assert.equal(w.tradeAppraisal?.allowanceSingle, 10000); assert.deepEqual(w.tradeAppraisal?.conditionChips, ["second_key"]);
    assert.equal(o.tradeAppraisal?.declined?.code, "salvage_title"); assert.equal(o.status, "quoted");
    assert.deepEqual((await listTradeAudit("7")).map((a) => [a.inviteId, a.action]), [["11", "appraisal_set"], ["12", "trade_declined"]]);
    const range = useBox(); assert.ok((await dealerQuotes("11", goodTrade(0, { allowance: { mode: "range", low: "9000", high: "11000" } }))).ok);
    assert.equal(range.db.invites[11].trade_appraisal_json && JSON.parse(range.db.invites[11].trade_appraisal_json).allowanceLow, 9000);
  });
  it("no trade on the request: nothing is asked", async () => {
    useBox({ trade: false });
    assert.ok((await dealerQuotes("11", undefined)).ok);
    assert.equal(b.db.invites[11].status, "quoted");
  });
  it("a re-quote after a counter keeps the allowance on file; one whose allowance lapsed must give a new one", async () => {
    useBox(); await dealerQuotes("11", goodTrade());
    b.db.invites[11].status = "invited"; // the buyer countered; the box reopened the invite
    assert.ok((await dealerQuotes("11", undefined, 39000)).ok);
    const a = JSON.parse(b.db.invites[11].trade_appraisal_json); a.goodUntil = new Date(Date.now() - 1000).toISOString(); b.db.invites[11].trade_appraisal_json = JSON.stringify(a); b.db.invites[11].status = "invited";
    assert.ok(!(await dealerQuotes("11", undefined, 38000)).ok);
  });
});

describe("select, then confirm or revise", () => {
  const picked = async () => {
    useBox(); await dealerQuotes("11", goodTrade(10000)); await dealerQuotes("12", goodTrade(9000), 39000);
    await pickRfqQuote("7", "99");
  };
  it("opening happens for the selected dealer only, with the other dealers left open and untouched", async () => {
    await picked();
    const rfq = (await getRfq("7"))!;
    const w = rfq.invites.find((i) => i.id === "11")!;
    const r = await openConfirmAfterPick(rfq, w);
    assert.ok(r.opened);
    const after = (await getRfq("7"))!;
    assert.equal(after.invites.find((i) => i.id === "11")!.tradeConfirmation?.status, "pending");
    assert.equal(after.invites.find((i) => i.id === "12")!.tradeConfirmation, null);
    assert.equal(after.invites.find((i) => i.id === "12")!.notSelectedAt, null, "nobody was closed out yet");
    assert.equal(openConfirmationOf(after)?.invite.id, "11");
  });
  it("no trade, a declined trade or no allowance on the winner: nothing to confirm, so the caller closes out as before", async () => {
    useBox({ trade: false }); await dealerQuotes("11", undefined); await pickRfqQuote("7", "99");
    const rfq = (await getRfq("7"))!;
    assert.equal((await openConfirmAfterPick(rfq, rfq.invites[0])).opened, false);
    useBox(); await dealerQuotes("11", { declined: { code: "salvage_title" } }); await pickRfqQuote("7", "99");
    const r2 = (await getRfq("7"))!;
    assert.equal((await openConfirmAfterPick(r2, r2.invites[0])).opened, false);
  });
  it("confirm as quoted settles it at the quoted number", async () => {
    await picked(); const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    const r = await actOnTradeConfirmation("7", "11", "dealer", { type: "confirm" }, cfg());
    assert.equal(r.confirmation.status, "confirmed"); assert.equal(r.confirmation.allowanceFinal, 10000);
    assert.equal(openConfirmationOf((await getRfq("7"))!), null, "nothing left open");
  });
  it("revise → the buyer accepts → final number replaces the quoted one on the card", async () => {
    await picked(); const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    await actOnTradeConfirmation("7", "11", "dealer", { type: "revise", allowance: 9500, reasonCode: "inspection_finding", reasonText: "Curb rash" }, cfg());
    assert.equal(openConfirmationOf((await getRfq("7"))!)?.confirmation.status, "revised");
    await actOnTradeConfirmation("7", "11", "buyer", { type: "accept_revised" }, cfg());
    const w = await inviteOf("11");
    assert.equal(w.tradeConfirmation?.buyerDecision, "accepted");
    assert.equal(tradeEquity(true, 4000, appraisalForCompare(w.tradeAppraisal, w.tradeConfirmation)).net, 5500);
  });
  it("revise → the buyer goes back: compare reopens, the other dealer's number and the reviser's own quoted number are intact, no penalty, reviser marked Revised", async () => {
    await picked(); const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    await actOnTradeConfirmation("7", "11", "dealer", { type: "revise", allowance: 9500, reasonCode: "payoff_changed" }, cfg());
    await actOnTradeConfirmation("7", "11", "buyer", { type: "go_back" }, cfg());
    const after = (await getRfq("7"))!;
    assert.equal(after.status, "collecting"); assert.equal(after.pickedQuoteId, null);
    const w = after.invites.find((i) => i.id === "11")!, o = after.invites.find((i) => i.id === "12")!;
    assert.equal(w.tradeConfirmation?.status, "revised"); assert.equal(w.tradeConfirmation?.buyerDecision, "went_back");
    assert.equal(o.tradeAppraisal?.allowanceSingle, 9000); assert.equal(o.notSelectedAt, null); assert.ok(o.quote, "their quote is still live");
    assert.equal(appraisalForCompare(w.tradeAppraisal, w.tradeConfirmation)?.allowanceSingle, 10000);
    // The buyer can pick anyone again, including the reviser, who then reappears awaiting the buyer's answer.
    await pickRfqQuote("7", "99");
    const again = (await getRfq("7"))!;
    const reopened = await openConfirmAfterPick(again, again.invites.find((i) => i.id === "11")!);
    assert.ok(reopened.opened && reopened.confirmation.buyerDecision === null);
  });
  it("walking away is allowed while the dealer decides and while a revision waits", async () => {
    await picked(); const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    await actOnTradeConfirmation("7", "11", "buyer", { type: "walk" }, cfg());
    assert.equal((await getRfq("7"))!.status, "walked");
  });
  it("only the selected dealer can answer: the other desk is refused", async () => {
    await picked(); const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    await assert.rejects(() => actOnTradeConfirmation("7", "12", "dealer", { type: "confirm" }, cfg()), (e: unknown) => e instanceof RfqApiError && e.status === 404, "no confirmation was ever opened for the other desk");
    await assert.rejects(() => actOnTradeConfirmation("7", "12", "buyer", { type: "open" }, cfg()), (e: unknown) => e instanceof RfqApiError && e.status === 409 && e.code === "not_selected_desk");
  });
  it("the guardrail applies through the API: a big uncited drop is refused without an explanation, flagged with one", async () => {
    await picked(); const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    await assert.rejects(() => actOnTradeConfirmation("7", "11", "dealer", { type: "revise", allowance: 7000, reasonCode: "inspection_finding" }, cfg()), (e: unknown) => e instanceof RfqApiError && e.status === 422);
    const ok = await actOnTradeConfirmation("7", "11", "dealer", { type: "revise", allowance: 7000, reasonCode: "inspection_finding", reasonText: "Transmission slips under load; quote from our service dept." }, cfg());
    assert.equal(ok.confirmation.revisionFlagged, true);
  });
  it("a firm quote that is revised is flagged as a breach", async () => {
    useBox(); await dealerQuotes("11", goodTrade(10000, { basis: "firm" })); await pickRfqQuote("7", "99");
    const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    const r = await actOnTradeConfirmation("7", "11", "dealer", { type: "revise", allowance: 9800, reasonCode: "photos_dont_match" }, cfg());
    assert.equal(r.confirmation.firmBreach, true);
  });
});

describe("the deadline", () => {
  it("a pending confirmation past its deadline is written as expired and the original number stands", async () => {
    useBox(); await dealerQuotes("11", goodTrade(10000)); await pickRfqQuote("7", "99");
    const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    const c: TradeConfirmation = JSON.parse(b.db.invites[11].trade_confirmation_json); c.deadlineAt = new Date(Date.now() - 1000).toISOString(); b.db.invites[11].trade_confirmation_json = JSON.stringify(c);
    const stale = (await getRfq("7"))!;
    assert.deepEqual(dueExpiries(stale).map((i) => i.id), ["11"]);
    const swept = await sweepIfDue(stale);
    assert.deepEqual(swept.settledInviteIds, ["11"]);
    const w = swept.rfq.invites.find((i) => i.id === "11")!;
    assert.equal(w.tradeConfirmation?.status, "expired"); assert.equal(w.tradeConfirmation?.allowanceFinal, 10000); assert.equal(w.tradeConfirmation?.confirmedWithinDeadline, false);
    assert.equal(swept.rfq.status, "picked");
    await assert.rejects(() => actOnTradeConfirmation("7", "11", "dealer", { type: "revise", allowance: 5000, reasonCode: "other", reasonText: "too late to change this one" }, cfg()), (e: unknown) => e instanceof RfqApiError && e.status === 409);
    assert.deepEqual((await sweepIfDue(swept.rfq)).settledInviteIds, [], "nothing more to sweep");
  });
  it("sweepIfDue does not call the box when nothing is due", async () => {
    useBox(); await dealerQuotes("11", goodTrade(10000)); await pickRfqQuote("7", "99");
    const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    b.calls.length = 0;
    await sweepIfDue((await getRfq("7"))!);
    assert.ok(!b.calls.some((c) => /sweep/.test(c)));
  });
  it("sweeping directly is idempotent", async () => {
    useBox(); await dealerQuotes("11", goodTrade(10000)); await pickRfqQuote("7", "99");
    assert.deepEqual((await sweepTradeConfirmations("7", cfg())).expiredInviteIds, []);
  });
});

describe("the buyer changes the trade after quotes are in", () => {
  it("every existing number reads 'Based on earlier details' until the dealer reconfirms", async () => {
    useBox(); await dealerQuotes("11", goodTrade(10000)); await dealerQuotes("12", goodTrade(9000), 39000);
    const rfqNow = async () => (await getRfq("7"))!;
    const eq = async (id: string) => { const r = await rfqNow(); const i = r.invites.find((x) => x.id === id)!; return tradeEquity(true, 4000, i.tradeAppraisal, new Date(), { quoteExpiresAt: i.quote?.expiresAt, tradeUpdatedAt: r.tradeIn?.updatedAt }); };
    assert.equal((await eq("11")).stale, false);
    const t = JSON.parse(b.db.rfq.trade_in_json!); t.updatedAt = new Date(Date.now() + 300).toISOString(); b.db.rfq.trade_in_json = JSON.stringify(t); // the buyer replaced a photo
    assert.equal((await eq("11")).stale, true); assert.equal((await eq("12")).stale, true);
    await new Promise((r) => setTimeout(r, 450));
    await reconfirmTradeAppraisal("7", "11");
    assert.equal((await eq("11")).stale, false); assert.equal((await eq("12")).stale, true, "only the desk that reconfirmed is cleared");
    const actions = (await listTradeAudit("7")).map((a) => a.action);
    assert.ok(actions.includes("appraisal_reconfirmed"));
  });
});

describe("the audit log", () => {
  it("records every allowance change with actor and timestamp, in order", async () => {
    useBox(); await dealerQuotes("11", goodTrade(10000)); await dealerQuotes("11", goodTrade(9800)); await pickRfqQuote("7", "99");
    const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    await actOnTradeConfirmation("7", "11", "dealer", { type: "revise", allowance: 9300, reasonCode: "payoff_changed" }, cfg());
    await actOnTradeConfirmation("7", "11", "buyer", { type: "accept_revised" }, cfg());
    const rows = await listTradeAudit("7");
    assert.deepEqual(rows.map((r) => [r.actor, r.action]), [["dealer", "appraisal_set"], ["dealer", "appraisal_updated"], ["buyer", "confirmation_opened"], ["dealer", "allowance_revised"], ["buyer", "revision_accepted"]]);
    assert.ok(rows.every((r) => Date.parse(r.at) > 0));
    assert.deepEqual(rows[1].from, { single: 10000, low: null, high: null, basis: "preliminary" }); assert.deepEqual(rows[1].to, { single: 9800, low: null, high: null, basis: "preliminary" });
  });
});

describe("who can see and do what", () => {
  it("trade data and photos are for dealers invited on THAT request, proven by their own token", async () => {
    useBox();
    const mine = await getRfqInviteByViewToken("winnertoken1");
    assert.ok(mine && dealerMayViewTrade(mine, "7"));
    assert.equal(dealerMayViewTrade(mine, "8"), false, "a token for another request");
    assert.equal(await getRfqInviteByViewToken("nobodytoken"), null);
    assert.equal(dealerMayViewTrade(null, "7"), false);
  });
  it("the confirm step lives only on the selected dealer's invite; every other invite reads null", async () => {
    useBox(); await dealerQuotes("11", goodTrade()); await dealerQuotes("12", goodTrade(9000), 39000); await pickRfqQuote("7", "99");
    const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    const other = await getRfqInviteByViewToken("othertoken12");
    assert.equal(other?.invite.tradeConfirmation ?? null, null);
    const winner = await getRfqInviteByViewToken("winnertoken1");
    assert.equal(winner?.invite.tradeConfirmation?.status, "pending");
  });
});

describe("desk-honesty fields stay internal", () => {
  it("a flagged firm-breach revision reaches the buyer and the dealer WITHOUT the flags, and the admin raw row keeps them", async () => {
    useBox(); await dealerQuotes("11", goodTrade(10000, { basis: "firm", conditionChips: [], conditions: "" })); await pickRfqQuote("7", "99");
    const rfq = (await getRfq("7"))!; await openConfirmAfterPick(rfq, rfq.invites[0]);
    await actOnTradeConfirmation("7", "11", "dealer", { type: "revise", allowance: 7000, reasonCode: "inspection_finding", reasonText: "Transmission slips between second and third gear." }, cfg());
    const raw = (await getRfq("7"))!.invites.find((i) => i.id === "11")!.tradeConfirmation!;
    assert.equal(raw.revisionFlagged, true); assert.equal(raw.firmBreach, true); assert.ok(raw.revisionDropPct && raw.confirmedWithinDeadline);
    const buyerView = publicRfqForBuyer((await getRfq("7"))!).invites.find((i) => i.id === "11")!.tradeConfirmation!;
    const dealerView = publicConfirmation(raw)!;
    for (const v of [buyerView, dealerView]) {
      assert.equal(v.revisionFlagged, false); assert.equal(v.firmBreach, false); assert.equal(v.revisionDropPct, null); assert.equal(v.confirmedWithinDeadline, null);
      assert.equal(v.allowancePrelim, 10000); assert.equal(v.allowanceFinal, 7000); assert.equal(v.revisionReasonCode, "inspection_finding");
    }
    assert.equal(publicConfirmation(null), null);
  });
});

describe("route wiring (the guards the tests above rely on are actually called)", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("every route that records a vehicle quote records the trade answer first", () => {
    for (const f of ["app/api/quote-invite/used-quote/route.ts", "app/api/quote-invite/lease-quote/route.ts", "app/api/rfqs/[id]/invites/[inviteId]/quotes/route.ts"]) {
      const src = read(f);
      assert.match(src, /recordTradeWithQuote\(/, f);
      assert.ok(src.indexOf("recordTradeWithQuote(") < src.lastIndexOf("submitRfqQuote("), `${f}: trade is recorded before the quote`);
    }
  });
  it("pick opens the confirm step and defers the close-out; settling paths close out", () => {
    const pick = read("app/api/rfqs/[id]/pick/route.ts");
    assert.match(pick, /openConfirmAfterPick\(/); assert.match(pick, /else if \(winner\)[\s\S]*closeOutLosers/);
    assert.match(read("app/api/rfqs/[id]/trade-confirm/route.ts"), /accept_revised[\s\S]*settleAndCloseOut/);
    assert.match(read("app/api/quote-invite/trade-confirm/route.ts"), /type === "confirm"[\s\S]*settleAndCloseOut/);
  });
  it("the dealer's confirm route resolves the desk from its own token and refuses a desk that was not selected", () => {
    const src = read("app/api/quote-invite/trade-confirm/route.ts");
    assert.match(src, /getRfqInviteByViewToken\(token\)/); assert.match(src, /dealerMayViewTrade\(found, rfq\.id\)/); assert.match(src, /!invite\.tradeConfirmation[\s\S]*409/);
    assert.match(src, /publicConfirmation\(r\.confirmation\)/);
    assert.match(read("app/api/quote-invite/trade/route.ts"), /confirmation: publicConfirmation\(invite\.tradeConfirmation\)/);
  });
  it("the buyer's confirm route is owner-only", () => {
    const src = read("app/api/rfqs/[id]/trade-confirm/route.ts");
    assert.match(src, /hasBuyerCredential/); assert.match(src, /different buyer[\s\S]*403/);
  });
  it("admin metrics and the audit log are admin-session only", () => {
    for (const f of ["app/api/admin/trade-honesty/route.ts", "app/api/admin/rfqs/[id]/trade-audit/route.ts"]) assert.match(read(f), /requireAdminSession\(\)[\s\S]*403/, f);
  });
  it("buyers and dealers never receive the honesty rollup: it is imported by the admin route and panel only", () => {
    const hits = ["app", "components", "lib"].flatMap((d) => grep(d, /deskHonestyRollup|trade-honesty/)).filter((f) => !/\.test\./.test(f));
    assert.deepEqual(hits.sort(), ["app/admin/quote-requests/TradeHonestyPanel.tsx", "app/api/admin/trade-honesty/route.ts", "lib/trade/confirm.ts"]);
  });
});

function grep(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next/.test(e.name)) out.push(...grep(rel, re)); } else if (/\.(ts|tsx)$/.test(e.name) && re.test(fs.readFileSync(path.join(process.cwd(), rel), "utf8"))) out.push(rel);
  }
  return out;
}
