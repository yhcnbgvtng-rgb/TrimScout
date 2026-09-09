import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buyerRfqStrikeCount,
  canInviteMore,
  classifyRfqOutcome,
  dealerHandoffText,
  dealerResponseRate,
  firstQuoteFor,
  freezeMustHaves,
  hasActiveRfq,
  isFullyLockedSpec,
  isQuoteComplete,
  isReachableEmail,
  quoteMatchesLockedSpec,
  remainingInviteSlots,
  reputationInviteCap,
  timeToFirstQuoteHours,
  totalOtdFromFees,
} from "./rfqLogic";
import { RFQ_MAX_INVITES } from "./rfq";
import type { RfqInvite, RfqMustHave, RfqQuote, RfqRequest, RfqSpec } from "./rfq";

function spec(overrides: Partial<RfqSpec> = {}): RfqSpec {
  return {
    vin: "WP0AA2A93TS205511",
    stockNumber: "STK-1",
    vehicleYear: 2026,
    vehicleMake: "Porsche",
    vehicleModel: "911",
    vehicleTrim: "Carrera",
    mustHaves: [{ code: "8LH", name: "Sport Chrono Package", status: "hit" }],
    ...overrides,
  };
}

function quote(overrides: Partial<RfqQuote> = {}): RfqQuote {
  return {
    id: "q1",
    inviteId: "i1",
    dealerName: "Paul Miller Porsche",
    price: 180000,
    fees: [{ label: "Doc fee", amount: 500 }],
    totalOtdPrice: 180500,
    vin: "WP0AA2A93TS205511",
    stockNumber: "STK-1",
    expiresAt: "2026-12-01T00:00:00.000Z",
    submittedAt: "2026-11-01T00:00:00.000Z",
    mustHaveAcknowledgement: true,
    notes: null,
    ...overrides,
  };
}

function invite(overrides: Partial<RfqInvite> = {}): RfqInvite {
  return {
    id: "i1",
    dealerName: "Paul Miller Porsche",
    dealerContactEmail: null,
    status: "invited",
    declineReason: null,
    invitedAt: "2026-11-01T00:00:00.000Z",
    respondedAt: null,
    quote: null,
    ...overrides,
  };
}

describe("freezeMustHaves / isFullyLockedSpec", () => {
  it("freezes hits as status hit", () => {
    const frozen = freezeMustHaves([{ code: "8LH", name: "Sport Chrono Package" }]);
    assert.deepEqual(frozen, [{ code: "8LH", name: "Sport Chrono Package", status: "hit" }]);
  });

  it("is only fully locked when every must-have is a hit", () => {
    const hit: RfqMustHave[] = [{ code: "8LH", name: "x", status: "hit" }];
    const miss: RfqMustHave[] = [{ code: "8LH", name: "x", status: "hit" }, { code: "KA6", name: "y", status: "miss" }];
    const unknown: RfqMustHave[] = [{ code: "8LH", name: "x", status: "unknown" }];
    assert.equal(isFullyLockedSpec(hit), true);
    assert.equal(isFullyLockedSpec(miss), false);
    assert.equal(isFullyLockedSpec(unknown), false);
    assert.equal(isFullyLockedSpec([]), false);
  });
});

describe("canInviteMore / remainingInviteSlots", () => {
  it("allows up to 3 active invites", () => {
    const invites = [invite({ id: "1" }), invite({ id: "2" })];
    assert.equal(canInviteMore(invites), true);
    assert.equal(remainingInviteSlots(invites), 1);
  });

  it("blocks a 4th active invite", () => {
    const invites = [invite({ id: "1" }), invite({ id: "2" }), invite({ id: "3" })];
    assert.equal(canInviteMore(invites), false);
    assert.equal(remainingInviteSlots(invites), 0);
  });

  it("declined/expired invites free up a slot", () => {
    const invites = [
      invite({ id: "1", status: "declined" }),
      invite({ id: "2" }),
      invite({ id: "3" }),
    ];
    assert.equal(canInviteMore(invites), true);
    assert.equal(remainingInviteSlots(invites), 1);
  });
});

describe("quoteMatchesLockedSpec", () => {
  it("matches on VIN (case-insensitive)", () => {
    assert.equal(quoteMatchesLockedSpec({ vin: "wp0aa2a93ts205511", stockNumber: null }, spec()), true);
  });

  it("fails when the VIN differs — a substitute car, not the locked one", () => {
    assert.equal(quoteMatchesLockedSpec({ vin: "1FTFW1E50NFA00001", stockNumber: null }, spec()), false);
  });

  it("fails when both sides have a stock number and they differ", () => {
    assert.equal(
      quoteMatchesLockedSpec({ vin: spec().vin, stockNumber: "STK-2" }, spec({ stockNumber: "STK-1" })),
      false
    );
  });
});

describe("isQuoteComplete", () => {
  it("is complete with all required fields", () => {
    assert.equal(isQuoteComplete(quote()), true);
  });

  it("is incomplete with a non-positive price", () => {
    assert.equal(isQuoteComplete(quote({ price: 0 })), false);
  });

  it("is incomplete with no VIN", () => {
    assert.equal(isQuoteComplete(quote({ vin: "" })), false);
  });

  it("is incomplete with an unparseable expiry", () => {
    assert.equal(isQuoteComplete(quote({ expiresAt: "not-a-date" })), false);
  });
});

describe("totalOtdFromFees", () => {
  it("sums price plus every itemized fee", () => {
    assert.equal(totalOtdFromFees(180000, [{ amount: 500 }, { amount: 250 }]), 180750);
  });
});

describe("dealerHandoffText", () => {
  const text = dealerHandoffText(spec());

  it("names this a request for a quote, never a bid or auction", () => {
    assert.match(text, /request for a quote/i);
    assert.doesNotMatch(text, /\bauction\b/i);
  });

  it("explicitly disclaims a binding bid and a 24-hour SLA", () => {
    assert.match(text, /not a binding bid/i);
    assert.match(text, /no 24-hour deadline/i);
  });

  it("lists the locked must-haves by code and name", () => {
    assert.match(text, /8LH Sport Chrono Package/);
  });

  it("includes the VIN", () => {
    assert.match(text, /WP0AA2A93TS205511/);
  });
});

describe("dealerResponseRate", () => {
  it("is null with zero invites — never divide by zero into a false 0%", () => {
    assert.equal(dealerResponseRate({ totalInvites: 0, quotedInvites: 0 }), null);
  });

  it("is the quoted/total ratio", () => {
    assert.equal(dealerResponseRate({ totalInvites: 4, quotedInvites: 1 }), 0.25);
  });
});

describe("timeToFirstQuoteHours", () => {
  it("computes hours between creation and first quote", () => {
    const hours = timeToFirstQuoteHours("2026-11-01T00:00:00.000Z", "2026-11-02T12:00:00.000Z");
    assert.equal(hours, 36);
  });
});

describe("firstQuoteFor", () => {
  it("returns null with no quotes yet", () => {
    assert.equal(firstQuoteFor({ invites: [invite()] }), null);
  });

  it("returns the earliest-submitted quote across invites", () => {
    const early = quote({ id: "early", submittedAt: "2026-11-01T00:00:00.000Z" });
    const late = quote({ id: "late", submittedAt: "2026-11-05T00:00:00.000Z" });
    const rfq = { invites: [invite({ id: "1", quote: late }), invite({ id: "2", quote: early })] };
    assert.equal(firstQuoteFor(rfq)?.id, "early");
  });
});

describe("canInviteMore / remainingInviteSlots with a reduced cap", () => {
  it("respects a custom maxInvites instead of the flat RFQ_MAX_INVITES", () => {
    const invites = [invite({ id: "1" })];
    assert.equal(canInviteMore(invites, 1), false);
    assert.equal(remainingInviteSlots(invites, 1), 0);
    // Default still behaves exactly as before when no cap is passed.
    assert.equal(canInviteMore(invites), true);
    assert.equal(remainingInviteSlots(invites), RFQ_MAX_INVITES - 1);
  });
});

describe("hasActiveRfq", () => {
  it("is true with any collecting RFQ", () => {
    assert.equal(hasActiveRfq([{ status: "picked" }, { status: "collecting" }]), true);
  });

  it("is false when every RFQ is finished", () => {
    assert.equal(hasActiveRfq([{ status: "picked" }, { status: "walked" }]), false);
  });

  it("is false with no RFQs at all", () => {
    assert.equal(hasActiveRfq([]), false);
  });
});

describe("classifyRfqOutcome", () => {
  const now = new Date("2026-11-20T00:00:00.000Z").getTime();

  it("a picked RFQ is completed", () => {
    const rfq: Pick<RfqRequest, "status" | "invites"> = { status: "picked", invites: [invite({ quote: quote() })] };
    assert.equal(classifyRfqOutcome(rfq, now), "completed");
  });

  it("walking away with zero quotes is walked_early — never a strike", () => {
    const rfq: Pick<RfqRequest, "status" | "invites"> = { status: "walked", invites: [invite({ quote: null })] };
    assert.equal(classifyRfqOutcome(rfq, now), "walked_early");
  });

  it("walking away after seeing a real quote is cancelled_after_quote", () => {
    const rfq: Pick<RfqRequest, "status" | "invites"> = { status: "walked", invites: [invite({ quote: quote() })] };
    assert.equal(classifyRfqOutcome(rfq, now), "cancelled_after_quote");
  });

  it("still collecting with no quotes yet is in_progress, not ghosted", () => {
    const rfq: Pick<RfqRequest, "status" | "invites"> = { status: "collecting", invites: [invite({ quote: null })] };
    assert.equal(classifyRfqOutcome(rfq, now), "in_progress");
  });

  it("a fresh quote sitting uncollected is in_progress", () => {
    const fresh = quote({ submittedAt: "2026-11-19T00:00:00.000Z" });
    const rfq: Pick<RfqRequest, "status" | "invites"> = { status: "collecting", invites: [invite({ quote: fresh })] };
    assert.equal(classifyRfqOutcome(rfq, now), "in_progress");
  });

  it("a quote left uncollected past the stale window is ghosted", () => {
    const stale = quote({ submittedAt: "2026-11-01T00:00:00.000Z" });
    const rfq: Pick<RfqRequest, "status" | "invites"> = { status: "collecting", invites: [invite({ quote: stale })] };
    assert.equal(classifyRfqOutcome(rfq, now), "ghosted");
  });
});

describe("buyerRfqStrikeCount / reputationInviteCap", () => {
  const now = new Date("2026-11-20T00:00:00.000Z").getTime();
  const ghosted: Pick<RfqRequest, "status" | "invites"> = {
    status: "collecting",
    invites: [invite({ quote: quote({ submittedAt: "2026-11-01T00:00:00.000Z" }) })],
  };
  const cancelled: Pick<RfqRequest, "status" | "invites"> = {
    status: "walked",
    invites: [invite({ quote: quote() })],
  };
  const completed: Pick<RfqRequest, "status" | "invites"> = { status: "picked", invites: [invite({ quote: quote() })] };
  const walkedEarly: Pick<RfqRequest, "status" | "invites"> = { status: "walked", invites: [invite({ quote: null })] };

  it("only counts ghosted and cancelled_after_quote outcomes", () => {
    assert.equal(buyerRfqStrikeCount([ghosted, cancelled, completed, walkedEarly], now), 2);
    assert.equal(buyerRfqStrikeCount([completed, walkedEarly], now), 0);
  });

  it("keeps the normal invite cap below the strike threshold, reduces it at/above", () => {
    assert.equal(reputationInviteCap(0), RFQ_MAX_INVITES);
    assert.equal(reputationInviteCap(1), RFQ_MAX_INVITES);
    assert.equal(reputationInviteCap(2), 1);
    assert.equal(reputationInviteCap(5), 1);
  });
});

describe("isReachableEmail", () => {
  it("accepts a well-formed email", () => {
    assert.equal(isReachableEmail("buyer@example.com"), true);
  });

  it("rejects empty, missing, or malformed values", () => {
    assert.equal(isReachableEmail(""), false);
    assert.equal(isReachableEmail(null), false);
    assert.equal(isReachableEmail(undefined), false);
    assert.equal(isReachableEmail("not-an-email"), false);
    assert.equal(isReachableEmail("missing-domain@"), false);
  });
});
