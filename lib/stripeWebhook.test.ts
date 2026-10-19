import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { env } from "node:process";
import Stripe from "stripe";
import { POST } from "../app/api/checkout/webhook/route";

const SECRET = "whsec_test_unit_secret";
const realFetch = globalThis.fetch;
const saved = { sk: env.STRIPE_SECRET_KEY, wh: env.STRIPE_WEBHOOK_SECRET, ip: env.LIGHTSAIL_IP, key: env.LIGHTSAIL_API_KEY };
let boxCalls: string[] = [];

const completed = JSON.stringify({
  id: "evt_test_1", object: "event", type: "checkout.session.completed",
  data: { object: { id: "cs_test_1", object: "checkout.session", payment_intent: "pi_test_1", metadata: { dealId: "deal_1" } } },
});
const unrelated = JSON.stringify({ id: "evt_test_2", object: "event", type: "customer.created", data: { object: { id: "cus_1" } } });
const sign = (payload: string, secret = SECRET) => Stripe.webhooks.generateTestHeaderString({ payload, secret });
const post = (body: string, sig?: string) =>
  POST(new Request("https://www.trimscout.com/api/checkout/webhook", { method: "POST", body, headers: sig ? { "stripe-signature": sig } : {} }));

beforeEach(() => {
  env.STRIPE_SECRET_KEY = "sk_test_unit"; env.STRIPE_WEBHOOK_SECRET = SECRET; env.LIGHTSAIL_IP = "203.0.113.50"; env.LIGHTSAIL_API_KEY = "test-box-key";
  boxCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => { boxCalls.push(String(input)); return new Response("{}", { status: 200 }); }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [["STRIPE_SECRET_KEY", saved.sk], ["STRIPE_WEBHOOK_SECRET", saved.wh], ["LIGHTSAIL_IP", saved.ip], ["LIGHTSAIL_API_KEY", saved.key]] as const) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
});

describe("POST /api/checkout/webhook — Stripe signature is verified with the webhook secret", () => {
  it("rejects a request with no signature header, and records nothing", async () => {
    const res = await post(completed);
    assert.equal(res.status, 400);
    assert.deepEqual(boxCalls, []);
  });
  it("rejects a signature made with the wrong secret, and records nothing", async () => {
    const res = await post(completed, sign(completed, "whsec_someone_else"));
    assert.equal(res.status, 400);
    assert.deepEqual(boxCalls, []);
  });
  it("rejects a valid signature over a different (tampered) body, and records nothing", async () => {
    const res = await post(completed.replace("deal_1", "deal_2"), sign(completed));
    assert.equal(res.status, 400);
    assert.deepEqual(boxCalls, []);
  });
  it("rejects garbage in the signature header", async () => {
    assert.equal((await post(completed, "t=1,v1=deadbeef")).status, 400);
    assert.equal((await post(completed, "garbage")).status, 400);
    assert.deepEqual(boxCalls, []);
  });
  it("accepts a correctly signed event", async () => {
    const res = await post(unrelated, sign(unrelated));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true });
  });
  it("a correctly signed completed checkout gets past verification and reaches the box to mark the deal paid", async () => {
    // The stub box answers with a body markDealPaid may not accept (→ 500 so Stripe retries); the point is it was reached, not 400.
    const res = await post(completed, sign(completed));
    assert.notEqual(res.status, 400);
    assert.ok(boxCalls.some((u) => u.includes("203.0.113.50")), "markDealPaid reached the box");
  });
  it("refuses to run at all when the webhook secret is not configured (never skips verification)", async () => {
    delete env.STRIPE_WEBHOOK_SECRET;
    const res = await post(completed, sign(completed));
    assert.equal(res.status, 500);
    assert.deepEqual(boxCalls, []);
  });
});
