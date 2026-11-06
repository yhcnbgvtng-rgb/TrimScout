import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildDealerQuoteRows,
  countByStatus,
  dealerSessionId,
  DEALER_QUOTE_STATUSES,
  deriveDealerQuoteStatus,
  filterDealerQuotes,
  type BoxDealerInvite,
} from "./dealerQuotes";

const ref = { reference: (r: string, i: string) => `TQ-${r}${i}` };
const T = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();

function invite(over: Partial<BoxDealerInvite> = {}): BoxDealerInvite {
  return {
    inviteId: "11", rfqId: "7", dealerName: "Acme Ford", viewToken: "tok_abcdefgh", inviteStatus: "quoted", invitedAt: T(1), respondedAt: T(2), viewedAt: T(1),
    buyerCounterAt: null, hasBuyerCounter: false, notSelectedAt: null, dealerUnsubscribedAt: null, rfqStatus: "collecting", pickedQuoteId: null,
    vehicle: { vin: "1FT", year: 2026, make: "Ford", model: "Bronco", trim: "Badlands" },
    quote: { id: "99", totalOtdPrice: 55000, submittedAt: T(2), supersededAt: null }, stage: null, audit: false, testDealer: false, ...over,
  };
}

describe("auth gate", () => {
  it("only a signed-in dealer account passes", () => {
    assert.equal(dealerSessionId({ user: { id: "d1", role: "dealer" } }), "d1");
    for (const s of [null, undefined, {}, { user: null }, { user: { id: "b1", role: "buyer" } }, { user: { id: "a1", role: "admin" } }, { user: { role: "dealer" } }, { user: { id: "  ", role: "dealer" } }, { user: { id: 5, role: "dealer" } }]) {
      assert.equal(dealerSessionId(s as any), null, JSON.stringify(s));
    }
  });
  it("the route checks the gate before it reads anything from the box", () => {
    const src = readFileSync(new URL("../app/api/dealer-quotes/route.ts", import.meta.url), "utf8");
    assert.ok(src.indexOf("dealerSessionId(") > -1 && src.indexOf("dealerSessionId(") < src.indexOf("listInvitesForDealerUser("));
    assert.match(src, /status: 401/);
    // The list is by account id only: no dealer-name lookup anywhere on this path.
    assert.doesNotMatch(src, /dealerName/);
  });
});

describe("status mapping", () => {
  it("an invite with no quote needs quoting", () => {
    assert.equal(deriveDealerQuoteStatus(invite({ inviteStatus: "invited", quote: null })), "needs_quoting");
  });
  it("a buyer counter newer than the quote reopens it; an older one does not", () => {
    assert.equal(deriveDealerQuoteStatus(invite({ hasBuyerCounter: true, buyerCounterAt: T(5) })), "needs_quoting");
    assert.equal(deriveDealerQuoteStatus(invite({ hasBuyerCounter: true, buyerCounterAt: T(1) })), "in_process");
  });
  it("quoted on an open request is in process", () => {
    assert.equal(deriveDealerQuoteStatus(invite()), "in_process");
  });
  it("picked quote, or a finally accepted staged deal, is awarded", () => {
    assert.equal(deriveDealerQuoteStatus(invite({ rfqStatus: "picked", pickedQuoteId: "99" })), "awarded");
    const stage: any = { stage: "closed", final: { status: "accepted" }, walk: null, log: [] };
    assert.equal(deriveDealerQuoteStatus(invite({ stage })), "awarded");
  });
  it("another dealer picked, buyer walked, declined, expired, closed by the buyer, or a walk: not awarded", () => {
    assert.equal(deriveDealerQuoteStatus(invite({ rfqStatus: "picked", pickedQuoteId: "123" })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(invite({ rfqStatus: "walked" })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(invite({ inviteStatus: "declined" })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(invite({ inviteStatus: "expired", quote: null })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(invite({ notSelectedAt: T(3) })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(invite({ stage: { walk: { by: "buyer", at: T(3) }, log: [] } as any })), "not_awarded");
    assert.equal(deriveDealerQuoteStatus(invite({ dealerUnsubscribedAt: T(3), quote: null, inviteStatus: "invited" })), "not_awarded");
  });
  it("an explicit not-selected beats a pick, and a walk beats an accepted deal", () => {
    assert.equal(deriveDealerQuoteStatus(invite({ notSelectedAt: T(3), rfqStatus: "picked", pickedQuoteId: "99" })), "not_awarded");
    const stage: any = { stage: "walked", final: { status: "accepted" }, walk: { by: "dealer", at: T(4) }, log: [] };
    assert.equal(deriveDealerQuoteStatus(invite({ stage })), "not_awarded");
  });
  it("there are exactly four statuses and no Completed", () => {
    assert.deepEqual(DEALER_QUOTE_STATUSES.map((s) => s.label), ["Needs quoting", "In process", "Awarded", "Not awarded"]);
  });
});

describe("rows", () => {
  const mixed = [
    invite({ inviteId: "1", inviteStatus: "quoted", respondedAt: T(9), quote: { id: "1", totalOtdPrice: 50000, submittedAt: T(9), supersededAt: null } }),
    invite({ inviteId: "2", inviteStatus: "invited", quote: null, respondedAt: null, viewedAt: null, invitedAt: T(3) }),
    invite({ inviteId: "3", rfqStatus: "picked", pickedQuoteId: "3", quote: { id: "3", totalOtdPrice: 48000, submittedAt: T(4), supersededAt: null } }),
    invite({ inviteId: "4", inviteStatus: "invited", quote: null, respondedAt: null, viewedAt: null, invitedAt: T(7) }),
    invite({ inviteId: "5", notSelectedAt: T(8) }),
  ];
  it("Needs quoting first, then in process, awarded, not awarded; newest first within a status", () => {
    const rows = buildDealerQuoteRows(mixed, ref);
    assert.deepEqual(rows.map((r) => r.inviteId), ["4", "2", "1", "3", "5"]);
    assert.deepEqual(rows.map((r) => r.status), ["needs_quoting", "needs_quoting", "in_process", "awarded", "not_awarded"]);
  });
  it("carries vehicle, the dealer reference, quoted OTD and last activity", () => {
    const [row] = buildDealerQuoteRows([invite()], ref);
    assert.equal(row.vehicle, "2026 Ford Bronco Badlands");
    assert.equal(row.reference, "TQ-711");
    assert.equal(row.quotedOtd, 55000);
    assert.equal(row.lastActivityAt, T(2));
  });
  it("filters by status and counts", () => {
    const rows = buildDealerQuoteRows(mixed, ref);
    assert.deepEqual(filterDealerQuotes(rows, "needs_quoting").map((r) => r.inviteId), ["4", "2"]);
    assert.equal(filterDealerQuotes(rows, "all").length, 5);
    assert.deepEqual(countByStatus(rows), { needs_quoting: 2, in_process: 1, awarded: 1, not_awarded: 1 });
  });
  it("the link is built on the server; no token field, no buyer contact", () => {
    const stage: any = {
      stage: "closed", final: { status: "accepted" }, walk: null, log: [{ at: T(6) }],
      release: { at: T(6), contact: { name: "Pat Buyer", email: "pat@example.com", phone: "555-0100", zip: "07030" } },
    };
    const rows = buildDealerQuoteRows([invite({ stage })], ref);
    const json = JSON.stringify(rows);
    assert.equal(rows[0].url, "/quote-request/received?t=tok_abcdefgh");
    assert.equal(rows[0].lastActivityAt, T(6));
    assert.doesNotMatch(json, /viewToken|pat@example|Pat Buyer|555-0100|"contact"/);
    assert.equal(buildDealerQuoteRows([invite({ viewToken: null })], ref)[0].url, null);
  });
});

describe("audit exclusion and TEST badge", () => {
  it("a real dealer never sees an audit RFQ, even if the box sent one", () => {
    const rows = buildDealerQuoteRows([invite({ inviteId: "1" }), invite({ inviteId: "2", audit: true, testDealer: false })], ref);
    assert.deepEqual(rows.map((r) => r.inviteId), ["1"]);
    assert.equal(rows[0].test, false);
  });
  it("a test dealer sees audit RFQs, marked TEST", () => {
    const rows = buildDealerQuoteRows([invite({ inviteId: "2", audit: true, testDealer: true })], ref);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].test, true);
  });
});

describe("UI", () => {
  it("shows the four chips, the TEST badge and no Completed", () => {
    const src = readFileSync(new URL("../components/DealerMyQuotes.tsx", import.meta.url), "utf8");
    assert.match(src, /DEALER_QUOTE_STATUSES/);
    assert.match(src, /data-testid="test-badge"/);
    assert.doesNotMatch(src, /Completed/);
    assert.doesNotMatch(src, /viewToken/);
  });
  it("the legacy Leads and My Bids tabs are untouched", () => {
    const src = readFileSync(new URL("../components/DealerPortal.tsx", import.meta.url), "utf8");
    assert.match(src, /setActiveTab\("leads"\)/);
    assert.match(src, /setActiveTab\("my_bids"\)/);
    assert.match(src, /setActiveTab\("my_quotes"\)/);
  });
});
