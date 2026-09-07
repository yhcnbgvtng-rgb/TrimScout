import assert from "node:assert/strict";
import { env } from "node:process";
import { describe, it } from "node:test";
import { unsubscribeTokenFor, unsubscribeUrlFor, verifyUnsubscribeToken } from "./dealerUnsubscribe";

function withKey<T>(fn: () => T): T {
  const prev = env.LIGHTSAIL_API_KEY;
  env.LIGHTSAIL_API_KEY = "test-signing-key";
  try {
    return fn();
  } finally {
    if (prev === undefined) delete env.LIGHTSAIL_API_KEY;
    else env.LIGHTSAIL_API_KEY = prev;
  }
}

describe("dealer unsubscribe tokens", () => {
  it("round-trips: a token generated for an id verifies for that same id", () => {
    withKey(() => {
      const token = unsubscribeTokenFor("42");
      assert.equal(verifyUnsubscribeToken("42", token), true);
    });
  });

  it("rejects a token generated for a different dealership id", () => {
    withKey(() => {
      const token = unsubscribeTokenFor("42");
      assert.equal(verifyUnsubscribeToken("43", token), false);
    });
  });

  it("rejects a garbage or empty token", () => {
    withKey(() => {
      assert.equal(verifyUnsubscribeToken("42", "not-a-real-token"), false);
      assert.equal(verifyUnsubscribeToken("42", ""), false);
      assert.equal(verifyUnsubscribeToken("", "anything"), false);
    });
  });

  it("changes with the signing secret — a token from a different secret never verifies", () => {
    const tokenUnderSecretA = withKey(() => unsubscribeTokenFor("42"));
    const prev = env.LIGHTSAIL_API_KEY;
    env.LIGHTSAIL_API_KEY = "a-completely-different-secret";
    try {
      assert.equal(verifyUnsubscribeToken("42", tokenUnderSecretA), false);
    } finally {
      if (prev === undefined) delete env.LIGHTSAIL_API_KEY;
      else env.LIGHTSAIL_API_KEY = prev;
    }
  });

  it("builds a URL carrying both the id and a matching token", () => {
    withKey(() => {
      const url = new URL(unsubscribeUrlFor("42"));
      assert.equal(url.pathname, "/api/dealer-unsubscribe");
      assert.equal(url.searchParams.get("id"), "42");
      assert.equal(verifyUnsubscribeToken("42", url.searchParams.get("token") || ""), true);
    });
  });
});
