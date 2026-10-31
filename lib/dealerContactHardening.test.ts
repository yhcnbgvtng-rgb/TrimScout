import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { dealerContactStatus, type DirectoryDealership } from "./dealerContactLookup";
import { publicDeskFor } from "./publicDesk";
import { middleware } from "../middleware";

const dealer: DirectoryDealership & Record<string, unknown> = {
  id: "7",
  dealerName: "Joyce Honda",
  address: "1 Main St",
  city: "Butler",
  state: "NJ",
  zipCode: "07405",
  phone: "973-555-0100",
  contactName: "Pat Seller",
  contactEmail: "pat@joycehonda.com",
  emailOptOut: false,
  domains: ["joycehonda.com"],
  website: null,
  notes: null,
};

describe("public dealer-contact response", () => {
  it("has no phone, and keeps the address line the wizard prints", () => {
    const status = dealerContactStatus([dealer], { dealerName: "Joyce Honda", state: "NJ" });
    assert.ok(!("phone" in status));
    assert.equal(status.addressLine, "1 Main St, Butler, NJ 07405");
    assert.equal(status.hasEmail, true);
    assert.ok(!JSON.stringify(status).includes("973-555-0100"));
    assert.ok(!JSON.stringify(status).includes("pat@joycehonda.com"));
  });
});

describe("public quote-desks response", () => {
  it("keeps the fields the wizard reads and drops the email domain", () => {
    const desk = publicDeskFor([dealer as never], { dealerName: "Joyce Honda", state: "NJ" });
    assert.equal(desk.contactName, "Pat Seller");
    assert.match(desk.emailMasked || "", /•/);
    assert.ok(!("emailDomain" in desk));
    assert.ok(!JSON.stringify(desk).includes("pat@joycehonda.com"));
  });
});

describe("rate limits on the public lookups", () => {
  const call = (path: string, ip: string) =>
    middleware(new NextRequest(`https://www.trimscout.com${path}`, { headers: { "x-forwarded-for": ip } }));

  const limits: [string, number][] = [
    ["/api/dealer-contact", 30],
    ["/api/quote-desks", 30],
    ["/api/desk-resolve", 20],
    ["/api/dealer-search", 120],
    ["/api/vehicles/search", 120],
    ["/api/vehicles/vin", 30],
    ["/api/catalog/makes", 120],
  ];
  for (const [path, limit] of limits) {
    it(`${path} answers 429 past ${limit} per minute from one IP`, () => {
      const ip = `198.51.100.${limit}.${path.length}`;
      for (let i = 0; i < limit; i++) assert.notEqual(call(path, ip).status, 429, `request ${i + 1}`);
      assert.equal(call(path, ip).status, 429);
      assert.notEqual(call(path, "203.0.113.250").status, 429, "another IP is unaffected");
    });
  }
});

describe("POST /api/desk-resolve", () => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; method: string; body: string }[] = [];
  beforeEach(() => {
    process.env.LIGHTSAIL_API_KEY = "test-key";
    process.env.LIGHTSAIL_IP = "203.0.113.10";
    calls.length = 0;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method || "GET", body: String(init?.body || "") });
      return new Response(JSON.stringify({ dealerships: [dealer], success: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("matches a white-label host without writing anything back to the directory", async () => {
    const { POST } = await import("../app/api/desk-resolve/route");
    const res = await POST(new Request("https://www.trimscout.com/api/desk-resolve", {
      method: "POST",
      body: JSON.stringify({ url: "https://joycehonda.roadster.com/inventory/used-2022-honda-civic" }),
    }));
    const json = await res.json();
    assert.equal(json.status, "unique");
    assert.equal(json.via, "platform_slug"); // the case that used to PUT a full row
    const writes = calls.filter((c) => c.method !== "GET");
    assert.deepEqual(writes, []);
    assert.ok(!calls.some((c) => c.body.includes("contactEmail")));
    assert.ok(!JSON.stringify(json).includes("pat@joycehonda.com"));
  });
});
