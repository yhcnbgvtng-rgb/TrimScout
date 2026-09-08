import assert from "node:assert/strict";
import { env } from "node:process";
import { describe, it } from "node:test";
import { dealerSignupInviteToken, dealerSignupInviteUrl, verifyDealerSignupInviteToken } from "./dealerSignupInvite";
import { unsubscribeTokenFor } from "./dealerUnsubscribe";

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

describe("dealer signup invite tokens", () => {
  it("round-trips: a token generated for a dealership id verifies for that same id", () => {
    withKey(() => {
      const token = dealerSignupInviteToken("42");
      assert.equal(verifyDealerSignupInviteToken("42", token), true);
    });
  });

  it("rejects a token generated for a different dealership id", () => {
    withKey(() => {
      const token = dealerSignupInviteToken("42");
      assert.equal(verifyDealerSignupInviteToken("43", token), false);
    });
  });

  it("rejects a garbage or empty token", () => {
    withKey(() => {
      assert.equal(verifyDealerSignupInviteToken("42", "not-a-real-token"), false);
      assert.equal(verifyDealerSignupInviteToken("42", ""), false);
      assert.equal(verifyDealerSignupInviteToken("", "anything"), false);
    });
  });

  it("changes with the signing secret — a token from a different secret never verifies", () => {
    const tokenUnderSecretA = withKey(() => dealerSignupInviteToken("42"));
    const prev = env.LIGHTSAIL_API_KEY;
    env.LIGHTSAIL_API_KEY = "a-completely-different-secret";
    try {
      assert.equal(verifyDealerSignupInviteToken("42", tokenUnderSecretA), false);
    } finally {
      if (prev === undefined) delete env.LIGHTSAIL_API_KEY;
      else env.LIGHTSAIL_API_KEY = prev;
    }
  });

  it("is a distinct token namespace from the unsubscribe link — one never verifies as the other", () => {
    withKey(() => {
      const unsubscribeToken = unsubscribeTokenFor("42");
      assert.equal(verifyDealerSignupInviteToken("42", unsubscribeToken), false);
    });
  });

  it("builds a /signup URL carrying both the dealership id and a matching token", () => {
    withKey(() => {
      const url = new URL(dealerSignupInviteUrl("42"));
      assert.equal(url.pathname, "/signup");
      assert.equal(url.searchParams.get("dealerId"), "42");
      assert.equal(verifyDealerSignupInviteToken("42", url.searchParams.get("dealerToken") || ""), true);
    });
  });
});
