import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { env } from "node:process";
import { describe, it } from "node:test";
import { verifyTurnstileToken } from "./turnstile";

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

describe("verifyTurnstileToken", () => {
  it("returns true (degrades gracefully) when TURNSTILE_SECRET_KEY is not configured, without calling Cloudflare", async () => {
    await withEnv({ TURNSTILE_SECRET_KEY: undefined }, async () => {
      const origFetch = globalThis.fetch;
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        throw new Error("should not be called");
      }) as typeof fetch;
      try {
        const ok = await verifyTurnstileToken("some-token");
        assert.equal(ok, true);
        assert.equal(fetchCalled, false);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("returns false when a token is required but missing, without calling Cloudflare", async () => {
    await withEnv({ TURNSTILE_SECRET_KEY: "test-secret" }, async () => {
      const origFetch = globalThis.fetch;
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        throw new Error("should not be called");
      }) as typeof fetch;
      try {
        const ok = await verifyTurnstileToken(null);
        assert.equal(ok, false);
        assert.equal(fetchCalled, false);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("returns true when Cloudflare confirms the token, and sends the secret/response/remoteip", async () => {
    await withEnv({ TURNSTILE_SECRET_KEY: "test-secret" }, async () => {
      const origFetch = globalThis.fetch;
      let capturedBody: string | null = null;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
          capturedBody = String(init?.body || "");
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as typeof fetch;
      try {
        const ok = await verifyTurnstileToken("real-token", "1.2.3.4");
        assert.equal(ok, true);
        const params = new URLSearchParams(capturedBody || "");
        assert.equal(params.get("secret"), "test-secret");
        assert.equal(params.get("response"), "real-token");
        assert.equal(params.get("remoteip"), "1.2.3.4");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("returns false when Cloudflare rejects the token", async () => {
    await withEnv({ TURNSTILE_SECRET_KEY: "test-secret" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
          status: 200,
        })) as typeof fetch;
      try {
        const ok = await verifyTurnstileToken("bad-token");
        assert.equal(ok, false);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("returns false (never throws) when the verification request itself fails", async () => {
    await withEnv({ TURNSTILE_SECRET_KEY: "test-secret" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error("network down");
      }) as typeof fetch;
      try {
        const ok = await verifyTurnstileToken("some-token");
        assert.equal(ok, false);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("returns false when Cloudflare responds with a non-OK HTTP status", async () => {
    await withEnv({ TURNSTILE_SECRET_KEY: "test-secret" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
      try {
        const ok = await verifyTurnstileToken("some-token");
        assert.equal(ok, false);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
