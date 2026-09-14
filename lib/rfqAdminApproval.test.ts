import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "node:process";
import { buildRfqInviteEmailInput, approveRfqInvites, sendRfqInvite } from "./rfqAdminApproval";
import type { RfqInvite, RfqRequest } from "./rfq";

const base = (over: Partial<RfqRequest> = {}): RfqRequest => ({
  id: "118",
  buyerUserId: "u1",
  invites: [],
  status: "collecting",
  pickedQuoteId: null,
  createdAt: "2026-09-13T12:00:00Z",
  vin: "1GNS6MKD2TR280381",
  stockNumber: null,
  vehicleYear: 2026,
  vehicleMake: "Chevrolet",
  vehicleModel: "Tahoe",
  vehicleTrim: "LS",
  mustHaves: [],
  packageKind: "links",
  dealReference: "TS-K7M3Q2",
  ...over,
});

const invite = (over: Partial<RfqInvite> = {}): RfqInvite => ({
  id: "i1",
  dealerName: "Scott Chevrolet",
  dealerContactEmail: "jim@scottchevy.com",
  status: "invited",
  declineReason: null,
  invitedAt: "2026-09-13T12:00:00Z",
  respondedAt: null,
  quote: null,
  desk: { contactName: "Jim Doe", role: "gsm", emailMasked: "j•••@scottchevy.com", source: "directory" },
  vehicle: { vin: "1GNS6MKD2TR280381", year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", vdpUrl: "https://www.scottchevy.com/x" },
  deliveryStatus: "queued",
  queuedAt: "2026-09-13T12:00:00Z",
  sentAt: null,
  viewedAt: null,
  viewToken: "tok_abcdefghij",
  ...over,
});

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = env[k];
    if (vars[k] === undefined) delete env[k];
    else env[k] = vars[k];
  }
  return fn().finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete env[k];
      else env[k] = prev[k];
    }
  });
}

describe("buildRfqInviteEmailInput — pure, derives everything from the persisted rfq/invite", () => {
  it("returns null when the invite has no named desk or no dealer contact — nothing to send to", () => {
    assert.equal(buildRfqInviteEmailInput(base(), invite({ desk: null }), null, null), null);
    assert.equal(buildRfqInviteEmailInput(base(), invite({ dealerContactEmail: null }), null, null), null);
  });

  it("lease request: quoteType lease, leasePrefs passed through, no financePrefs", () => {
    const rfq = base({ leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: "this_month" } });
    const out = buildRfqInviteEmailInput(rfq, invite(), null, null)!;
    assert.equal(out.quoteType, "lease");
    assert.equal(out.leasePrefs?.termMonths, 36);
    assert.equal(out.financePrefs, null);
    assert.equal(out.buyerZip, "07405");
    assert.equal(out.purchaseTimelineLabel, "Within the month");
    assert.equal(out.dealReference, "TS-K7M3Q2");
  });

  it("finance request: quoteType finance, financePrefs and ZIP/timeline come from quotePrefs.finance", () => {
    const rfq = base({ quotePrefs: { quoteType: "finance", finance: { termMonths: 60, downPayment: 3000, creditBand: "good", zip: "10001", timeline: "asap" } } });
    const out = buildRfqInviteEmailInput(rfq, invite(), null, null)!;
    assert.equal(out.quoteType, "finance");
    assert.deepEqual(out.financePrefs, { termMonths: 60, downPayment: 3000, creditBand: "good" });
    assert.equal(out.buyerZip, "10001");
    assert.equal(out.purchaseTimelineLabel, "ASAP");
  });

  it("cash request: quoteType cash, ZIP/timeline from quotePrefs.cash, no financePrefs", () => {
    const rfq = base({ quotePrefs: { quoteType: "cash", cash: { zip: "60601", timeline: "this_week" } } });
    const out = buildRfqInviteEmailInput(rfq, invite(), null, null)!;
    assert.equal(out.quoteType, "cash");
    assert.equal(out.financePrefs, null);
    assert.equal(out.buyerZip, "60601");
    assert.equal(out.purchaseTimelineLabel, "Within the week");
  });

  it("neither lease nor quote prefs set: falls back to cash, no ZIP/timeline invented", () => {
    const out = buildRfqInviteEmailInput(base(), invite(), null, null)!;
    assert.equal(out.quoteType, "cash");
    assert.equal(out.buyerZip, null);
    assert.equal(out.purchaseTimelineLabel, null);
  });

  it("rooftop comes from the directory row when given, else all null — never invents a location", () => {
    const withRow = buildRfqInviteEmailInput(base(), invite(), { city: "Fayetteville", state: "NC", address: "123 Main St" }, null)!;
    assert.deepEqual(withRow.rooftop, { city: "Fayetteville", state: "NC", address: "123 Main St" });
    const withoutRow = buildRfqInviteEmailInput(base(), invite(), null, null)!;
    assert.deepEqual(withoutRow.rooftop, { city: null, state: null, address: null });
  });

  it("view URL is built from the invite's own tracked-link token", () => {
    const out = buildRfqInviteEmailInput(base(), invite({ viewToken: "tok_xyz987" }), null, null)!;
    assert.match(out.viewUrl, /\/api\/quote-invite\/view\?t=tok_xyz987$/);
  });

  it("buyer note passes through verbatim; contact name and role come from the invite's desk", () => {
    const out = buildRfqInviteEmailInput(base({ buyerNote: "No dealer add-ons, please." }), invite(), null, null)!;
    assert.equal(out.buyerNote, "No dealer add-ons, please.");
    assert.equal(out.contactName, "Jim Doe");
    assert.equal(out.role, "gsm");
    assert.equal(out.dealerName, "Scott Chevrolet");
  });
});

describe("sendRfqInvite — sends the dealer email and marks delivery; never throws", () => {
  it("no named desk / no contact email: reports sent:false without any network call", async () => {
    const origFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("must not be called");
    }) as typeof fetch;
    try {
      const result = await sendRfqInvite(base(), invite({ desk: null }));
      assert.equal(result.sent, false);
      assert.match(result.error || "", /No named dealer contact/);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("happy path: sends via Resend then marks the invite delivered 'sent' on the box", async () => {
    await withEnv({ LIGHTSAIL_API_KEY: "test-key", RESEND_API_KEY: "test-resend-key" }, async () => {
      const origFetch = globalThis.fetch;
      const calls: string[] = [];
      let resendSubject = "";
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/api/dealerships")) {
          return new Response(JSON.stringify({ dealerships: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url === "https://api.resend.com/emails") {
          resendSubject = JSON.parse(String(init?.body || "{}")).subject;
          return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
        }
        if (url.includes("/invites/i1/delivery")) {
          const body = JSON.parse(String(init?.body || "{}"));
          assert.equal(body.status, "sent");
          return new Response(JSON.stringify({ invite: { ...invite(), deliveryStatus: "sent" } }), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as typeof fetch;

      try {
        const result = await sendRfqInvite(base(), invite());
        assert.equal(result.sent, true);
        assert.equal(result.error, undefined);
        assert.match(resendSubject, /VIN …280381/);
        assert.ok(calls.some((u) => u.includes("/invites/i1/delivery")), "marks delivery on the box");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("Resend not configured: reports sent:false, never calls the box delivery endpoint", async () => {
    await withEnv({ LIGHTSAIL_API_KEY: "test-key", RESEND_API_KEY: undefined }, async () => {
      const origFetch = globalThis.fetch;
      let deliveryCalled = false;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/dealerships")) return new Response(JSON.stringify({ dealerships: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.includes("/delivery")) deliveryCalled = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;
      try {
        const result = await sendRfqInvite(base(), invite());
        assert.equal(result.sent, false);
        assert.equal(deliveryCalled, false);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("a thrown error is caught and returned, never propagated", async () => {
    await withEnv({ LIGHTSAIL_API_KEY: "test-key", RESEND_API_KEY: "test-resend-key" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/dealerships")) return new Response(JSON.stringify({ dealerships: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        throw new Error("network down");
      }) as typeof fetch;
      try {
        const result = await sendRfqInvite(base(), invite());
        assert.equal(result.sent, false);
        assert.ok(result.error);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});

describe("approveRfqInvites — sends only the pending (or requested) invites, re-fetches fresh", () => {
  it("with no inviteIds: sends every still-queued invite, leaves an already-sent one alone", async () => {
    await withEnv({ LIGHTSAIL_API_KEY: "test-key", RESEND_API_KEY: "test-resend-key" }, async () => {
      const origFetch = globalThis.fetch;
      const deliveryCalls: string[] = [];
      const rfqRow = {
        ...base(),
        invites: [invite({ id: "i1" }), invite({ id: "i2", dealerContactEmail: "gm@otherdealer.com" }), invite({ id: "i3", deliveryStatus: "sent", sentAt: "2026-09-13T00:00:00Z" })],
      };
      let getRfqCalls = 0;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/dealerships")) return new Response(JSON.stringify({ dealerships: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url === "https://api.resend.com/emails") return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
        if (url.match(/\/api\/rfqs\/118$/)) {
          getRfqCalls++;
          return new Response(JSON.stringify({ rfq: rfqRow }), { status: 200 });
        }
        if (url.includes("/delivery")) {
          deliveryCalls.push(url);
          return new Response(JSON.stringify({ invite: invite() }), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as typeof fetch;

      try {
        const { results } = await approveRfqInvites("118");
        assert.equal(results.length, 2, "only the two still-queued invites are acted on");
        assert.deepEqual(results.map((r) => r.inviteId).sort(), ["i1", "i2"]);
        assert.ok(results.every((r) => r.sent));
        assert.equal(deliveryCalls.length, 2);
        assert.ok(!deliveryCalls.some((u) => u.includes("/invites/i3/")), "the already-sent invite is left alone");
        assert.equal(getRfqCalls, 2, "fetches fresh before sending, and again after");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("with inviteIds: sends only the named subset, even when more are pending", async () => {
    await withEnv({ LIGHTSAIL_API_KEY: "test-key", RESEND_API_KEY: "test-resend-key" }, async () => {
      const origFetch = globalThis.fetch;
      const rfqRow = { ...base(), invites: [invite({ id: "i1" }), invite({ id: "i2", dealerContactEmail: "gm@otherdealer.com" })] };
      const sentInviteIds: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/dealerships")) return new Response(JSON.stringify({ dealerships: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url === "https://api.resend.com/emails") return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
        if (url.match(/\/api\/rfqs\/118$/)) return new Response(JSON.stringify({ rfq: rfqRow }), { status: 200 });
        const deliveryMatch = url.match(/\/invites\/(i\d)\/delivery/);
        if (deliveryMatch) {
          sentInviteIds.push(deliveryMatch[1]);
          return new Response(JSON.stringify({ invite: invite() }), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as typeof fetch;

      try {
        const { results } = await approveRfqInvites("118", ["i2"]);
        assert.deepEqual(results.map((r) => r.inviteId), ["i2"]);
        assert.deepEqual(sentInviteIds, ["i2"]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
