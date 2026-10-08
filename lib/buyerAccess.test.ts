import assert from "node:assert/strict";
import { env } from "node:process";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  buyerForRfq,
  guestBuyerId,
  guestEmailFromId,
  guestTokenFor,
  guestTrackerPath,
  hasBuyerCredential,
  normalizeGuestEmail,
  requireBuyerLogin,
  rfqCreateActor,
  verifyGuestToken,
} from "./buyerAccess";
import { namedLimit, resetRateLimitsForTests } from "./rateLimit";

const ON = { REQUIRE_BUYER_LOGIN: "true" };
const OFF = { REQUIRE_BUYER_LOGIN: "false" };
const rfq = { id: "118", buyerUserId: guestBuyerId("pat@example.com") };
const buyerSession = { user: { id: "u1", email: "b@example.com", role: "buyer" } };
const dealerSession = { user: { id: "d1", email: "d@example.com", role: "dealer" } };

let prevKey: string | undefined;
beforeEach(() => {
  prevKey = env.LIGHTSAIL_API_KEY;
  env.LIGHTSAIL_API_KEY = "test-signing-key";
  resetRateLimitsForTests();
});
afterEach(() => {
  if (prevKey === undefined) delete env.LIGHTSAIL_API_KEY;
  else env.LIGHTSAIL_API_KEY = prevKey;
});

const reqWith = (headers: Record<string, string> = {}, url = "http://localhost/api/rfqs/118") => new Request(url, { headers });

describe("REQUIRE_BUYER_LOGIN parsing", () => {
  it("defaults to true when unset, blank or junk", () => {
    for (const v of [undefined, "", "  ", "maybe", "1", "true", "TRUE", "yes"]) assert.equal(requireBuyerLogin({ REQUIRE_BUYER_LOGIN: v }), true, String(v));
  });
  it("is false only for an explicit off value", () => {
    for (const v of ["false", "FALSE", "0", "no", "off", " false "]) assert.equal(requireBuyerLogin({ REQUIRE_BUYER_LOGIN: v }), false, v);
  });
});

describe("guest email + ids", () => {
  it("normalizes and validates", () => {
    assert.equal(normalizeGuestEmail("  Pat@Example.COM "), "pat@example.com");
    for (const bad of ["", "pat", "pat@", "a b@c.com", "a@b", null, 5, "x@y.com,z@y.com"]) assert.equal(normalizeGuestEmail(bad), null, String(bad));
  });
  it("round-trips the email through the owner id", () => {
    assert.equal(guestEmailFromId(guestBuyerId("pat@example.com")), "pat@example.com");
    assert.equal(guestEmailFromId("user-42"), null);
  });
});

describe("rfqCreateActor — flag ON (login required)", () => {
  it("lets a signed-in buyer through", () => {
    assert.deepEqual(rfqCreateActor(buyerSession, {}, ON), { kind: "buyer", ownerId: "u1" });
  });
  it("refuses a guest, even one who supplies an email", () => {
    const a = rfqCreateActor(null, { guestEmail: "pat@example.com" }, ON);
    assert.equal(a.kind, "deny");
    assert.equal((a as { status: number }).status, 401);
  });
  it("refuses a signed-in dealer", () => {
    assert.equal(rfqCreateActor(dealerSession, {}, ON).kind, "deny");
  });
  it("is the default when the env var is unset", () => {
    assert.equal(rfqCreateActor(null, { guestEmail: "pat@example.com" }, {}).kind, "deny");
  });
});

describe("rfqCreateActor — flag OFF (guests allowed)", () => {
  it("accepts a guest with a valid email, owned by guest:<email>", () => {
    assert.deepEqual(rfqCreateActor(null, { guestEmail: " Pat@Example.com " }, OFF), { kind: "guest", ownerId: "guest:pat@example.com", email: "pat@example.com" });
  });
  it("needs an email — 400, not 401", () => {
    for (const body of [null, {}, { guestEmail: "nope" }]) {
      const a = rfqCreateActor(null, body, OFF);
      assert.equal(a.kind, "deny");
      assert.equal((a as { status: number }).status, 400);
      assert.equal((a as { code?: string }).code, "guest_email_required");
    }
  });
  it("still treats a signed-in buyer as a buyer (ignores any guestEmail)", () => {
    assert.deepEqual(rfqCreateActor(buyerSession, { guestEmail: "other@example.com" }, OFF), { kind: "buyer", ownerId: "u1" });
  });
  it("does not let a signed-in dealer fall through to guest", () => {
    assert.equal(rfqCreateActor(dealerSession, { guestEmail: "pat@example.com" }, OFF).kind, "deny");
  });
});

describe("guest tracker token", () => {
  it("verifies for its own request only", () => {
    const t = guestTokenFor("118");
    assert.equal(verifyGuestToken("118", t), true);
    assert.equal(verifyGuestToken("119", t), false);
    assert.equal(verifyGuestToken("118", t.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), false);
    for (const bad of [null, undefined, "", "abc", 7]) assert.equal(verifyGuestToken("118", bad), false);
  });
  it("is rejected when the signing secret is missing", () => {
    const t = guestTokenFor("118");
    delete env.LIGHTSAIL_API_KEY;
    assert.equal(verifyGuestToken("118", t), false);
  });
  it("builds a tracker path carrying the token", () => {
    assert.equal(guestTrackerPath("118"), `/rfq/118?t=${guestTokenFor("118")}`);
  });
});

describe("buyerForRfq / hasBuyerCredential — flag ON", () => {
  it("never honours a guest token, however valid", () => {
    const req = reqWith({ "x-guest-token": guestTokenFor("118") });
    assert.equal(hasBuyerCredential(null, req, ON), false);
    assert.equal(buyerForRfq(null, req, rfq, ON), null);
    assert.equal(buyerForRfq(null, reqWith({}, `http://localhost/api/rfqs/118?t=${guestTokenFor("118")}`), rfq, ON), null);
  });
  it("still serves a signed-in session", () => {
    const b = buyerForRfq(buyerSession, reqWith(), { id: "118", buyerUserId: "u1" }, ON);
    assert.equal(b?.id, "u1");
    assert.equal(b?.guest, false);
  });
});

describe("buyerForRfq / hasBuyerCredential — flag OFF", () => {
  it("honours a valid token via header or ?t=", () => {
    const t = guestTokenFor("118");
    for (const req of [reqWith({ "x-guest-token": t }), reqWith({}, `http://localhost/api/rfqs/118?t=${t}`)]) {
      assert.equal(hasBuyerCredential(null, req, OFF), true);
      const b = buyerForRfq(null, req, rfq, OFF);
      assert.equal(b?.id, "guest:pat@example.com");
      assert.equal(b?.email, "pat@example.com");
      assert.equal(b?.guest, true);
      assert.equal(b?.isAdmin, false);
    }
  });
  it("rejects no token, a wrong token, and another request's token", () => {
    assert.equal(hasBuyerCredential(null, reqWith(), OFF), false);
    assert.equal(buyerForRfq(null, reqWith({ "x-guest-token": "0".repeat(64) }), rfq, OFF), null);
    assert.equal(buyerForRfq(null, reqWith({ "x-guest-token": guestTokenFor("999") }), rfq, OFF), null);
  });
  it("never opens a signed-in buyer's request with a token", () => {
    const owned = { id: "118", buyerUserId: "u1" };
    assert.equal(buyerForRfq(null, reqWith({ "x-guest-token": guestTokenFor("118") }), owned, OFF), null);
  });
  it("a session still wins over a token", () => {
    const b = buyerForRfq(buyerSession, reqWith({ "x-guest-token": guestTokenFor("118") }), rfq, OFF);
    assert.equal(b?.id, "u1");
  });
});

describe("guest RFQ rate limits", () => {
  it("caps per email (4/h by default) without touching other emails", () => {
    for (let i = 0; i < 4; i++) assert.equal(namedLimit("rfq_guest_email", "a@example.com").ok, true);
    assert.equal(namedLimit("rfq_guest_email", "a@example.com").ok, false);
    assert.equal(namedLimit("rfq_guest_email", "b@example.com").ok, true);
  });
  it("caps per IP (6/h by default)", () => {
    for (let i = 0; i < 6; i++) assert.equal(namedLimit("rfq_guest_ip", "1.2.3.4").ok, true);
    const v = namedLimit("rfq_guest_ip", "1.2.3.4");
    assert.equal(v.ok, false);
    assert.ok(v.retryAfterSec > 0);
    assert.equal(namedLimit("rfq_guest_ip", "5.6.7.8").ok, true);
  });
});
