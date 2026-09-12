import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deskFromDealership,
  deskFromBuyerEmail,
  isGenericMailbox,
  inferDeskRole,
  maskEmail,
  sisterStoreConflicts,
  desksWithOpenInvites,
  planInvites,
  inviteStage,
  MAX_PACKAGE_LINKS,
  NON_BINDING_COPY,
  type DealerLinkPaste,
  type DealerDesk,
} from "./quotePackage";
import type { RfqRequest } from "./rfq";

function row(over: Record<string, unknown> = {}) {
  return {
    dealerName: "Swickard Chevrolet Buick GMC of Anchorage",
    state: "AK",
    contactName: "Wendy Wilkins",
    contactEmail: "wendy.wilkins@swickard.com",
    notes: "General Manager",
    emailOptOut: false,
    ...over,
  };
}

function paste(over: Partial<DealerLinkPaste> = {}): DealerLinkPaste {
  return {
    raw: "https://www.example.com/vdp/1",
    kind: "url",
    vin: "1FMWK8JCXTGB47204",
    year: 2026,
    make: "Ford",
    model: "Explorer",
    trim: "Tremor",
    dealerName: "Route 23 Auto Mall",
    dealerState: "NJ",
    vdpUrl: "https://www.example.com/vdp/1",
    buildConfidence: "verified_factory",
    resolvedAt: "2026-09-11T00:00:00.000Z",
    ...over,
  };
}

function desk(over: Partial<DealerDesk> = {}): DealerDesk {
  return {
    dealerName: "Route 23 Auto Mall",
    dealerState: "NJ",
    contactName: "Jane Doe",
    role: "sales_manager",
    email: "jane.doe@route23.com",
    emailDomain: "route23.com",
    source: "directory",
    knownNamed: true,
    emailOptOut: false,
    ...over,
  };
}

describe("DealerDesk — known_named", () => {
  it("accepts a named person at a personal mailbox", () => {
    const d = deskFromDealership(row());
    assert.ok(d);
    assert.equal(d.knownNamed, true);
    assert.equal(d.contactName, "Wendy Wilkins");
    assert.equal(d.role, "gm");
    assert.equal(d.emailDomain, "swickard.com");
    assert.equal(d.source, "directory");
  });

  it("never treats info@ or any other shared inbox as a desk", () => {
    for (const email of [
      "info@dealer.com", "sales@dealer.com", "Internet@dealer.com", "internetsales@dealer.com",
      "new-cars@dealer.com", "contact@dealer.com", "bdc@dealer.com", "leads@dealer.com", "noreply@dealer.com",
    ]) {
      assert.equal(isGenericMailbox(email), true, email);
      const d = deskFromDealership(row({ contactEmail: email }));
      assert.equal(d?.knownNamed, false, email);
    }
  });

  it("needs a person's name, not a department", () => {
    for (const name of ["Sales Team", "Internet Department", "Sales", "W", ""]) {
      const d = deskFromDealership(row({ contactName: name }));
      assert.equal(d?.knownNamed ?? false, false, name);
    }
  });

  it("is null when the row has neither a name nor an email", () => {
    assert.equal(deskFromDealership(row({ contactName: "", contactEmail: null })), null);
  });

  it("strips a title tacked onto the name, and reads the role from it", () => {
    const d = deskFromDealership(row({ contactName: "James King, General Sales Manager", notes: "" }));
    assert.equal(d?.contactName, "James King");
    assert.equal(d?.role, "gsm");
  });

  it("infers the desk role from title text", () => {
    assert.equal(inferDeskRole("", "General Manager"), "gm");
    assert.equal(inferDeskRole("", "General Sales Manager"), "gsm");
    assert.equal(inferDeskRole("", "Internet Sales Director"), "internet");
    assert.equal(inferDeskRole("", "New Car Sales Manager"), "new_car");
    assert.equal(inferDeskRole("", "Sales Manager"), "sales_manager");
    assert.equal(inferDeskRole("", ""), "sales");
  });

  it("carries the opt-out through", () => {
    assert.equal(deskFromDealership(row({ emailOptOut: true }))?.emailOptOut, true);
  });

  it("accepts a buyer-typed adviser address only if it's a personal mailbox, and marks it unverified", () => {
    const ok = deskFromBuyerEmail("Route 23 Auto Mall", "NJ", "Paul.Smith@route23.com");
    assert.equal(ok?.knownNamed, true);
    assert.equal(ok?.source, "buyer");
    assert.equal(ok?.email, "paul.smith@route23.com");
    assert.equal(deskFromBuyerEmail("Route 23 Auto Mall", "NJ", "info@route23.com"), null);
    assert.equal(deskFromBuyerEmail("Route 23 Auto Mall", "NJ", ""), null);
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain, hides the rest", () => {
    assert.equal(maskEmail("john.doe@paulmillerbmw.com"), "j••••••@paulmillerbmw.com");
    assert.equal(maskEmail("wl@x.com"), "w•••@x.com");
    assert.equal(maskEmail("not-an-email"), "");
    assert.equal(maskEmail(null), "");
  });
});

describe("sister-store conflicts", () => {
  it("flags the second desk on a shared dealer-group domain", () => {
    const desks = [
      desk({ email: "draff@lithia.com", emailDomain: "lithia.com" }),
      desk({ email: "jane@independent.com", emailDomain: "independent.com" }),
      desk({ email: "other@lithia.com", emailDomain: "lithia.com" }),
    ];
    assert.deepEqual([...sisterStoreConflicts(desks)], [2]);
  });

  it("ignores consumer providers and empty desks", () => {
    const desks = [
      desk({ email: "a@gmail.com", emailDomain: "gmail.com" }),
      desk({ email: "b@gmail.com", emailDomain: "gmail.com" }),
      null,
    ];
    assert.equal(sisterStoreConflicts(desks).size, 0);
  });
});

describe("one open invite per desk", () => {
  const rfqs = [
    { status: "collecting", invites: [{ status: "invited", dealerContactEmail: "Jane.Doe@route23.com" }, { status: "declined", dealerContactEmail: "x@y.com" }] },
    { status: "picked", invites: [{ status: "invited", dealerContactEmail: "z@w.com" }] },
  ] as unknown as RfqRequest[];

  it("counts only invites still waiting, on packages still collecting", () => {
    const open = desksWithOpenInvites(rfqs);
    assert.deepEqual([...open], ["jane.doe@route23.com"]);
  });
});

describe("planInvites", () => {
  const directory = new Map<string, DealerDesk>([
    ["Route 23 Auto Mall", desk()],
    ["Lithia Ford of Boise", desk({ dealerName: "Lithia Ford of Boise", email: "a@lithia.com", emailDomain: "lithia.com" })],
    ["Lithia Chevrolet of Reno", desk({ dealerName: "Lithia Chevrolet of Reno", email: "b@lithia.com", emailDomain: "lithia.com" })],
    ["Shared Inbox Motors", desk({ dealerName: "Shared Inbox Motors", email: "info@shared.com", emailDomain: "shared.com", knownNamed: false })],
    ["Opted Out Motors", desk({ dealerName: "Opted Out Motors", email: "sam@optedout.com", emailDomain: "optedout.com", emailOptOut: true })],
  ]);
  const deskFor = (p: DealerLinkPaste) => (p.dealerName ? directory.get(p.dealerName) ?? null : null);

  it("pairs each car with its desk and lets a clean one through", () => {
    const plan = planInvites([paste()], deskFor);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].blocked, null);
    assert.equal(plan[0].desk?.contactName, "Jane Doe");
  });

  it("blocks with a specific reason instead of falling back to a shared inbox", () => {
    const plan = planInvites([paste({ dealerName: "Shared Inbox Motors" })], deskFor);
    assert.equal(plan[0].blocked, "no_named_contact");
    assert.equal(plan[0].desk?.email, "info@shared.com"); // visible for the message, never invited
  });

  it("blocks an opted-out desk, a no-rooftop paste, and an already-invited desk", () => {
    const plan = planInvites(
      [
        paste({ dealerName: "Opted Out Motors" }),
        paste({ dealerName: null }),
        paste({ vin: "2" }),
      ],
      deskFor,
      new Set(["jane.doe@route23.com"])
    );
    assert.deepEqual(plan.map((p) => p.blocked), ["dealer_opted_out", "no_rooftop", "desk_already_invited"]);
  });

  it("keeps the first of two sister stores and skips the second", () => {
    const plan = planInvites(
      [paste({ dealerName: "Lithia Ford of Boise" }), paste({ vin: "2", dealerName: "Lithia Chevrolet of Reno" })],
      deskFor
    );
    assert.deepEqual(plan.map((p) => p.blocked), [null, "sister_store"]);
  });

  it("caps the package at three links", () => {
    assert.equal(MAX_PACKAGE_LINKS, 3);
    const plan = planInvites([paste(), paste({ vin: "2" }), paste({ vin: "3" }), paste({ vin: "4" })], deskFor);
    assert.equal(plan.length, 3);
  });
});

describe("invite stage", () => {
  it("shows the delivery leg until the dealer answers", () => {
    assert.equal(inviteStage({ status: "invited", deliveryStatus: "queued" }), "queued");
    assert.equal(inviteStage({ status: "invited", deliveryStatus: "sent" }), "sent");
    assert.equal(inviteStage({ status: "invited", deliveryStatus: "viewed" }), "viewed");
    assert.equal(inviteStage({ status: "quoted", deliveryStatus: "viewed" }), "quoted");
    assert.equal(inviteStage({ status: "declined" }), "declined");
    assert.equal(inviteStage({ status: "invited" }), "queued");
  });
});

describe("non-binding copy", () => {
  it("says request, not bid, and that either side can walk", () => {
    assert.match(NON_BINDING_COPY, /request for a quote, not a bid/);
    assert.match(NON_BINDING_COPY, /either side can walk away/);
  });
});
