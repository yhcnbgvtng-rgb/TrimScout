import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildDealerQuoteRows,
  dealerQuoteCounts,
  deriveDealerQuoteStatus,
  filterDealerQuoteRows,
  DEALER_QUOTE_STATUSES,
  type DealerInviteRecord,
} from "./dealerQuotes";
import { dealerQuotesResponse } from "./dealerQuotesHandler";
import { bindableDealerId, linkInviteToSignedInDealer, linkInviteTokenToNewDealer } from "./dealerInviteLink";
import { DealerMyQuotesList } from "../components/DealerMyQuotes";
import { dealerReference } from "./dealerReference";

const SECRET = "test-secret";
const NOW = "2026-11-01T12:00:00.000Z";

function rec(over: { invite?: Record<string, unknown>; rfq?: Record<string, unknown>; id?: string } = {}): DealerInviteRecord {
  const id = over.id ?? "11";
  return {
    rfqId: "7",
    rfq: { status: "collecting", pickedQuoteId: null, approvalStatus: "approved", audit: false, auditForcedSafeMode: false, packageKind: "links", vin: "1FTFW1RJ5TFB88090", vehicleYear: 2026, vehicleMake: "Ford", vehicleModel: "F-150", vehicleTrim: "XLT", ...over.rfq },
    invite: {
      id,
      dealerName: "Acme Ford",
      dealerContactEmail: "desk@acme.example",
      status: "invited",
      declineReason: null,
      invitedAt: "2026-10-30T12:00:00.000Z",
      respondedAt: null,
      quote: null,
      viewToken: `tok_${id}_abcdefgh`,
      vehicle: { vin: "1FTFW1RJ5TFB88090", year: 2026, make: "Ford", model: "F-150", trim: "XLT", vdpUrl: null },
      ...over.invite,
    },
  } as unknown as DealerInviteRecord;
}
const quote = (id = "90", total = 61234) => ({ id, inviteId: "11", dealerName: "Acme Ford", price: 58000, fees: [], totalOtdPrice: total, vin: "1FTFW1RJ5TFB88090", stockNumber: null, expiresAt: null, submittedAt: NOW, mustHaveAcknowledgement: true, notes: null });
const build = (records: DealerInviteRecord[], dealerTest = false) => buildDealerQuoteRows(records, { dealerTest, viewUrlFor: (t) => `/quote-request/received?t=${t}`, referenceSecret: SECRET });

describe("My Quotes status mapping — four chips, no Completed", () => {
  it("exposes exactly the four statuses", () => {
    assert.deepEqual([...DEALER_QUOTE_STATUSES], ["needs_quoting", "in_process", "awarded", "not_awarded"]);
    assert.doesNotMatch(JSON.stringify(DEALER_QUOTE_STATUSES), /complete/i);
  });
  it("invited with no quote → Needs quoting", () => {
    assert.equal(deriveDealerQuoteStatus(rec()), "needs_quoting");
  });
  it("a buyer counter reopens the invite → Needs quoting again, even though an older quote exists", () => {
    const r = rec({ invite: { status: "invited", buyerCounterAt: NOW, quote: null, priorQuotes: [quote()] } });
    assert.equal(deriveDealerQuoteStatus(r), "needs_quoting");
  });
  it("quoted while the request is open → In process", () => {
    assert.equal(deriveDealerQuoteStatus(rec({ invite: { status: "quoted", quote: quote() } })), "in_process");
  });
  it("buyer picked THIS dealer's quote → Awarded", () => {
    const r = rec({ invite: { status: "quoted", quote: quote("90") }, rfq: { status: "picked", pickedQuoteId: "90" } });
    assert.equal(deriveDealerQuoteStatus(r), "awarded");
  });
  it("buyer picked another dealer, walked, or this desk was closed/declined/expired → Not awarded", () => {
    assert.equal(deriveDealerQuoteStatus(rec({ invite: { status: "quoted", quote: quote("90") }, rfq: { status: "picked", pickedQuoteId: "91" } })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(rec({ invite: { status: "quoted", quote: quote() }, rfq: { status: "walked" } })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(rec({ invite: { status: "quoted", quote: quote(), notSelectedAt: NOW } })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(rec({ invite: { status: "declined" } })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(rec({ invite: { status: "expired" } })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(rec({ invite: { dealerUnsubscribedAt: NOW } })), "not_awarded");
  });
  it("a picked request never marks a dealer with no quote as Awarded", () => {
    assert.equal(deriveDealerQuoteStatus(rec({ rfq: { status: "picked", pickedQuoteId: "90" } })), "not_awarded");
  });
});

describe("My Quotes rows — shape, order, filter", () => {
  it("builds the row fields and the token link on the server", () => {
    const [row] = build([rec({ invite: { status: "quoted", quote: quote("90", 61234), respondedAt: NOW } })]);
    assert.equal(row.vehicle, "2026 Ford F-150 XLT");
    assert.equal(row.dealerReference, dealerReference("7", "11", SECRET));
    assert.equal(row.quotedOtd, 61234);
    assert.equal(row.status, "in_process");
    assert.equal(row.statusLabel, "In process");
    assert.equal(row.lastActivityAt, NOW);
    assert.equal(row.viewUrl, "/quote-request/received?t=tok_11_abcdefgh");
    assert.equal(row.test, false);
    assert.ok(!("viewToken" in row), "the bare token is not a row field");
  });
  it("Needs quoting sorts first, then newest activity within a group", () => {
    const rows = build([
      rec({ id: "1", invite: { status: "quoted", quote: quote("1"), respondedAt: "2026-10-31T00:00:00.000Z" } }),
      rec({ id: "2", invite: { invitedAt: "2026-10-29T00:00:00.000Z" } }),
      rec({ id: "3", invite: { invitedAt: "2026-10-30T00:00:00.000Z" } }),
      rec({ id: "4", invite: { status: "declined" } }),
    ]);
    assert.deepEqual(rows.map((r) => r.inviteId), ["3", "2", "1", "4"]);
    assert.equal(rows[0].status, "needs_quoting");
  });
  it("filter chips and counts", () => {
    const rows = build([rec({ id: "1" }), rec({ id: "2", invite: { status: "quoted", quote: quote("2") } }), rec({ id: "3", invite: { status: "declined" } })]);
    assert.deepEqual(dealerQuoteCounts(rows), { all: 3, needs_quoting: 1, in_process: 1, awarded: 0, not_awarded: 1 });
    assert.deepEqual(filterDealerQuoteRows(rows, "in_process").map((r) => r.inviteId), ["2"]);
    assert.equal(filterDealerQuoteRows(rows, "all").length, 3);
  });
  it("a lease quote has no single OTD; a request not yet released never appears", () => {
    const lease = build([rec({ invite: { status: "quoted", quote: { ...quote(), lease: { monthlyPaymentPreTax: 500 } } } })]);
    assert.equal(lease[0].quotedOtd, null);
    assert.equal(build([rec({ rfq: { approvalStatus: "pending" } }), rec({ id: "2", rfq: { approvalStatus: undefined } })]).length, 0);
  });
});

describe("My Quotes — no buyer contact reaches the dealer", () => {
  it("serialized rows carry no buyer fields even when the stage holds an unreleased contact", () => {
    const stage = { v: 2, path: "cash_finance", stage: "otd", otd: { status: "open", amount: null, lockedAt: null, lockedBy: null }, trade: { status: "pending", offer: null, counter: null, value: null, taxSavings: null, lockedAt: null }, payment: { status: "pending", method: null, outsideFinancing: false }, release: { at: NOW, contact: { name: "Pat Buyer", email: "pat@buyer.example", phone: "555-0100" } }, walk: null };
    const out = JSON.stringify(build([rec({ invite: { stage, status: "quoted", quote: quote() } })]));
    for (const leak of ["Pat Buyer", "pat@buyer.example", "555-0100", "buyerUserId", "contact"]) assert.ok(!out.includes(leak), `leaked ${leak}`);
  });
  it("the module reads the stage only through stageForDealer, and the box list never selects buyer_user_id", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/dealerQuotes.ts"), "utf8");
    assert.match(src, /stageForDealer\(/);
    assert.doesNotMatch(src, /invite\.stage\??\.(contact|release)/);
    const box = fs.readFileSync(path.join(process.cwd(), "scrapers/lightsail-crawler/src/deals_api_server.js"), "utf8");
    const fn = box.slice(box.indexOf("async function handleListDealerInvites("), box.indexOf("async function handleBindInviteDealer("));
    assert.doesNotMatch(fn, /buyer_user_id/);
  });
});

describe("My Quotes — audit exclusion and TEST badge", () => {
  const records = [rec({ id: "1" }), rec({ id: "2", rfq: { audit: true } }), rec({ id: "3", rfq: { auditForcedSafeMode: true } }), rec({ id: "4", invite: { audit: true } })];
  it("a real dealer never sees audit / safe-mode requests", () => {
    assert.deepEqual(build(records, false).map((r) => r.inviteId), ["1"]);
  });
  it("a test-dealer account sees them, each badged TEST (and the real one is not)", () => {
    const rows = build(records, true);
    assert.deepEqual(rows.map((r) => [r.inviteId, r.test]).sort(), [["1", false], ["2", true], ["3", true], ["4", true]]);
    const html = renderToStaticMarkup(<DealerMyQuotesList quotes={rows} filter="all" />);
    assert.equal((html.match(/>TEST</g) || []).length, 3);
  });
  it("the handler asks the box for audit rows only for a test account", async () => {
    const asked: boolean[] = [];
    const deps = (test: boolean) => ({ isTestAccount: () => test, referenceSecret: SECRET, listInvites: async (_id: string, o: { includeAudit: boolean }) => (asked.push(o.includeAudit), records) });
    const real = await dealerQuotesResponse({ id: "5", role: "dealer", email: "d@x.example" }, deps(false));
    const test = await dealerQuotesResponse({ id: "6", role: "dealer", email: "t@x.example" }, deps(true));
    assert.deepEqual(asked, [false, true]);
    assert.equal(real.status === 200 && real.body.quotes.length, 1);
    assert.equal(test.status === 200 && test.body.quotes.length, 4);
  });
});

describe("GET /api/dealer-quotes — auth gate and dealerUserId isolation", () => {
  const never = async () => {
    throw new Error("must not reach the box");
  };
  it("401 for signed-out, buyer, admin and an id-less session — the box is never called", async () => {
    for (const user of [null, undefined, {}, { id: "1", role: "buyer" }, { id: "1", role: "admin" }, { role: "dealer" }]) {
      const res = await dealerQuotesResponse(user as never, { listInvites: never });
      assert.equal(res.status, 401, JSON.stringify(user));
    }
  });
  it("asks the box for the SESSION's own id only, and returns only that dealer's invites", async () => {
    const db: Record<string, DealerInviteRecord[]> = { "5": [rec({ id: "1" })], "6": [rec({ id: "2" })] };
    const asked: string[] = [];
    const listInvites = async (id: string) => (asked.push(id), db[id] || []);
    const a = await dealerQuotesResponse({ id: "5", role: "dealer", email: "a@x.example" }, { listInvites, referenceSecret: SECRET });
    const b = await dealerQuotesResponse({ id: "6", role: "dealer", email: "b@x.example" }, { listInvites, referenceSecret: SECRET });
    assert.deepEqual(asked, ["5", "6"]);
    assert.deepEqual(a.status === 200 && a.body.quotes.map((q) => q.inviteId), ["1"]);
    assert.deepEqual(b.status === 200 && b.body.quotes.map((q) => q.inviteId), ["2"]);
  });
  it("the route takes no dealer id from the request, and the portal tab calls it", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "app/api/dealer-quotes/route.ts"), "utf8");
    assert.doesNotMatch(route, /searchParams|req\.url|request\.url/);
    assert.match(route, /export async function GET\(\)/);
    const portal = fs.readFileSync(path.join(process.cwd(), "components/DealerPortal.tsx"), "utf8");
    assert.match(portal, /<DealerMyQuotes \/>/);
    assert.match(portal, /Leads|leads/, "legacy Leads / My Bids are untouched");
    assert.match(portal, /"my_bids"/);
  });
  it("a box failure is a 502 with a plain message, not a leak", async () => {
    const res = await dealerQuotesResponse({ id: "5", role: "dealer" }, { listInvites: async () => { throw new Error("ECONNREFUSED 10.0.0.1"); } });
    assert.equal(res.status, 502);
    assert.doesNotMatch(JSON.stringify(res.body), /ECONNREFUSED|10\.0\.0\.1/);
  });
});

describe("linking an invite to an account", () => {
  it("only a dealer session may claim an invite", () => {
    assert.equal(bindableDealerId({ id: "5", role: "dealer" }), "5");
    for (const u of [null, { id: "5", role: "buyer" }, { id: "5", role: "admin" }, { role: "dealer" }]) assert.equal(bindableDealerId(u as never), null);
  });
  it("first authenticated token use binds by the session's account id", async () => {
    const calls: Array<[string, string]> = [];
    const bind = async (i: string, d: string) => (calls.push([i, d]), { bound: true });
    assert.equal(await linkInviteToSignedInDealer("11", { session: async () => ({ user: { id: "5", role: "dealer" } }), bind }), true);
    assert.equal(await linkInviteToSignedInDealer("11", { session: async () => ({ user: { id: "9", role: "buyer" } }), bind }), false);
    assert.equal(await linkInviteToSignedInDealer("11", { session: async () => null, bind }), false);
    assert.deepEqual(calls, [["11", "5"]]);
  });
  it("an already-linked invite is reported not-bound, and a failing box never throws into the page", async () => {
    assert.equal(await linkInviteToSignedInDealer("11", { session: async () => ({ user: { id: "6", role: "dealer" } }), bind: async () => ({ bound: false }) }), false);
    assert.equal(await linkInviteToSignedInDealer("11", { session: async () => ({ user: { id: "6", role: "dealer" } }), bind: async () => { throw new Error("down"); } }), false);
  });
  it("signup with a quote token binds the NEW account's id to that token's invite; junk tokens are ignored", async () => {
    const calls: Array<[string, string]> = [];
    const deps = { lookup: async () => ({ rfqId: "7", invite: { id: "11" } as never }), bind: async (i: string, d: string) => (calls.push([i, d]), { bound: true }) };
    assert.equal(await linkInviteTokenToNewDealer("tok_11_abcdefgh", "42", deps), true);
    assert.equal(await linkInviteTokenToNewDealer("../etc", "42", deps), false);
    assert.equal(await linkInviteTokenToNewDealer("tok_11_abcdefgh", null, deps), false);
    assert.deepEqual(calls, [["11", "42"]]);
  });
  it("wiring: the token page and signup both call the link helpers", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    assert.match(read("app/api/quote-invite/context/route.ts"), /linkInviteToSignedInDealer\(found\.invite\.id\)/);
    assert.match(read("app/api/auth/signup/route.ts"), /linkInviteTokenToNewDealer\(body\?\.quoteInviteToken, created\?\.id\)/);
  });
});

describe("My Quotes UI", () => {
  it("renders chips with counts, rows with reference/OTD/status and an Open link", () => {
    const rows = build([rec({ id: "1" }), rec({ id: "2", invite: { status: "quoted", quote: quote("2", 50000) } })]);
    const html = renderToStaticMarkup(<DealerMyQuotesList quotes={rows} filter="all" />);
    for (const s of ["All (2)", "Needs quoting (1)", "In process (1)", "Awarded (0)", "Not awarded (0)", "2026 Ford F-150 XLT", "$50,000", "/quote-request/received?t=tok_2_abcdefgh"]) assert.ok(html.includes(s), s);
    assert.doesNotMatch(html, /Completed/);
    assert.doesNotMatch(html, />TEST</);
  });
  it("an empty account says so", () => {
    assert.match(renderToStaticMarkup(<DealerMyQuotesList quotes={[]} filter="all" />), /No quote requests are linked/);
  });
});
