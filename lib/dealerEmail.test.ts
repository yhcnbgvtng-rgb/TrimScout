import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { env } from "node:process";
import { describe, it } from "node:test";
import { SAFE_MODE_RECIPIENT, buildOfferEmail, notifyDealersOfNewOffer } from "./dealerEmail";
import type { BiddingRequest, Vehicle } from "./types";

function vehicle(partial: Partial<Vehicle> & Pick<Vehicle, "vin">): Vehicle {
  return {
    id: partial.id || partial.vin,
    vin: partial.vin,
    year: partial.year || 2026,
    make: partial.make || "Ford",
    model: partial.model || "Explorer",
    trim: partial.trim || "ST",
    bodyType: "",
    engine: "",
    drivetrain: "",
    transmission: "",
    exteriorColor: "",
    interiorColor: "",
    msrp: partial.msrp || 60000,
    dealerPrice: partial.dealerPrice || 58000,
    daysOnLot: 0,
    status: "on_lot",
    location: partial.location || {
      dealerName: "Battlefield Ford",
      city: "Culpeper",
      state: "VA",
      distanceMiles: 0,
    },
    packages: [],
    options: [],
    imageUrl: "",
    mileage: 0,
  };
}

const favorite = vehicle({ vin: "1FMWK8JCXTGB47204" });
const otherLot = vehicle({
  vin: "1FMWK8JC7TGB81309",
  location: { dealerName: "Jim Shorkey Ford", city: "White Oak", state: "PA", distanceMiles: 80 },
});

const request: BiddingRequest = {
  id: "req-email-1",
  strategy: "exact_auction",
  targetVin: favorite.vin,
  targetVehicle: favorite,
  otherLots: [otherLot],
  paymentMethod: "cash",
  dealStructurePreferences: { requestedStructures: ["cash"] },
  buyerZip: "22701",
  searchRadiusMiles: 100,
  createdAt: "now",
  expiresAt: "48 Hours",
  status: "active",
};

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

describe("buildOfferEmail", () => {
  it("names the intended dealer and the resolved contact-on-file, but is only ever informational — never the send target", () => {
    const { subject, html } = buildOfferEmail(
      { dealerName: "Battlefield Ford", dealerState: "VA", dealerCity: "Culpeper", knownRooftop: true },
      "real-gm@battlefieldford.com",
      request
    );
    assert.match(subject, /Battlefield Ford/);
    assert.match(html, /Battlefield Ford/);
    assert.match(html, /real-gm@battlefieldford\.com/);
    assert.match(html, /SAFE MODE/);
    assert.doesNotMatch(subject, /real-gm@battlefieldford\.com/);
  });

  it("says no contact on file rather than inventing one", () => {
    const { html } = buildOfferEmail(
      { dealerName: "Some Rooftop", dealerState: "TX", knownRooftop: true },
      null,
      request
    );
    assert.match(html, /none found in the dealership directory/);
  });
});

describe("notifyDealersOfNewOffer — safety override", () => {
  it("sends to SAFE_MODE_RECIPIENT for every invited dealer, never a real contact on file", async () => {
    await withEnv({ LIGHTSAIL_API_KEY: "test-key", RESEND_API_KEY: "test-resend-key" }, async () => {
      const origFetch = globalThis.fetch;
      const resendCalls: Array<{ to: unknown; subject: string }> = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/dealerships")) {
          return new Response(
            JSON.stringify({
              dealerships: [
                {
                  id: "1",
                  dealerName: "Battlefield Ford",
                  address: null,
                  city: "Culpeper",
                  state: "VA",
                  zipCode: null,
                  phone: null,
                  contactName: "Real GM",
                  contactEmail: "real-gm@battlefieldford.com",
                  notes: null,
                  createdAt: "",
                  updatedAt: "",
                },
                {
                  id: "2",
                  dealerName: "Jim Shorkey Ford",
                  address: null,
                  city: "White Oak",
                  state: "PA",
                  zipCode: null,
                  phone: null,
                  contactName: "Another Real Contact",
                  contactEmail: "definitely-real@jimshorkeyford.com",
                  notes: null,
                  createdAt: "",
                  updatedAt: "",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url === "https://api.resend.com/emails") {
          const body = JSON.parse(String(init?.body || "{}"));
          resendCalls.push({ to: body.to, subject: body.subject });
          return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as typeof fetch;

      try {
        const results = await notifyDealersOfNewOffer(request);
        assert.equal(results.length, 2, "one result per invited dealer");
        assert.equal(resendCalls.length, 2, "one Resend call per invited dealer");
        for (const call of resendCalls) {
          assert.deepEqual(call.to, [SAFE_MODE_RECIPIENT]);
        }
        // The real emails resolved from the directory must never appear as a `to`.
        const allTo = resendCalls.flatMap((c) => c.to as string[]);
        assert.ok(!allTo.includes("real-gm@battlefieldford.com"));
        assert.ok(!allTo.includes("definitely-real@jimshorkeyford.com"));
        assert.ok(results.every((r) => r.sent === true));
        assert.equal(results.find((r) => r.dealerName === "Battlefield Ford")?.resolvedContactEmail, "real-gm@battlefieldford.com");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("never throws when the dealership directory is unreachable — still emails the override with 'no contact on file'", async () => {
    await withEnv({ LIGHTSAIL_API_KEY: "test-key", RESEND_API_KEY: "test-resend-key" }, async () => {
      const origFetch = globalThis.fetch;
      const resendCalls: Array<{ to: unknown }> = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/dealerships")) {
          return new Response("boom", { status: 500 });
        }
        if (url === "https://api.resend.com/emails") {
          const body = JSON.parse(String(init?.body || "{}"));
          resendCalls.push({ to: body.to });
          return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as typeof fetch;

      try {
        const results = await notifyDealersOfNewOffer(request);
        assert.equal(results.length, 2);
        assert.ok(results.every((r) => r.resolvedContactEmail === null));
        assert.equal(resendCalls.length, 2);
        for (const call of resendCalls) assert.deepEqual(call.to, [SAFE_MODE_RECIPIENT]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("returns sent:false without throwing when RESEND_API_KEY is missing", async () => {
    await withEnv({ LIGHTSAIL_API_KEY: "test-key", RESEND_API_KEY: undefined }, async () => {
      const origFetch = globalThis.fetch;
      let resendCalled = false;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/dealerships")) {
          return new Response(JSON.stringify({ dealerships: [] }), { status: 200 });
        }
        if (url === "https://api.resend.com/emails") {
          resendCalled = true;
          return new Response("{}", { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as typeof fetch;

      try {
        const results = await notifyDealersOfNewOffer(request);
        assert.equal(resendCalled, false, "never calls Resend without an API key");
        assert.ok(results.every((r) => r.sent === false));
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("returns an empty result for a request with no dealer to invite", async () => {
    const bare: BiddingRequest = { ...request, targetVehicle: undefined, otherLots: [] };
    const results = await notifyDealersOfNewOffer(bare);
    assert.deepEqual(results, []);
  });
});
