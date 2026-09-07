import assert from "node:assert/strict";
import { env } from "node:process";
import { afterEach, describe, it } from "node:test";
import {
  guardPaidDecode,
  guardPerDeskCap,
  isPaidVinDecodeEnabled,
  recordQuoteRequest,
  resetSpendGuardStateForTests,
} from "./apiSpendGuard";

function reqFrom(ip: string): Request {
  return new Request("http://localhost/api/test", { headers: { "x-forwarded-for": ip } });
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prev[key] = env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

afterEach(() => resetSpendGuardStateForTests());

describe("isPaidVinDecodeEnabled", () => {
  it("defaults to disabled — never turned on without an explicit env var", () => {
    withEnv({ PAID_VIN_DECODE_ENABLED: undefined }, () => {
      assert.equal(isPaidVinDecodeEnabled(), false);
    });
  });

  it("is enabled only by an explicit true/1", () => {
    withEnv({ PAID_VIN_DECODE_ENABLED: "true" }, () => {
      assert.equal(isPaidVinDecodeEnabled(), true);
    });
    withEnv({ PAID_VIN_DECODE_ENABLED: "1" }, () => {
      assert.equal(isPaidVinDecodeEnabled(), true);
    });
    withEnv({ PAID_VIN_DECODE_ENABLED: "false" }, () => {
      assert.equal(isPaidVinDecodeEnabled(), false);
    });
  });
});

describe("guardPaidDecode — per-IP rate limit", () => {
  it("allows calls under the limit and blocks once exceeded", () => {
    withEnv({ PAID_DECODE_PER_IP_LIMIT: "3", PAID_DECODE_WINDOW_MS: "60000", PAID_DECODE_DAILY_BUDGET_USD: "1000" }, () => {
      const req = reqFrom("1.2.3.4");
      assert.equal(guardPaidDecode({ kind: "test", request: req }), null);
      assert.equal(guardPaidDecode({ kind: "test", request: req }), null);
      assert.equal(guardPaidDecode({ kind: "test", request: req }), null);
      const blocked = guardPaidDecode({ kind: "test", request: req });
      assert.ok(blocked);
      assert.equal(blocked?.status, 429);
    });
  });

  it("tracks separate IPs independently", () => {
    withEnv({ PAID_DECODE_PER_IP_LIMIT: "1", PAID_DECODE_WINDOW_MS: "60000", PAID_DECODE_DAILY_BUDGET_USD: "1000" }, () => {
      assert.equal(guardPaidDecode({ kind: "test", request: reqFrom("1.1.1.1") }), null);
      assert.equal(guardPaidDecode({ kind: "test", request: reqFrom("2.2.2.2") }), null);
      assert.ok(guardPaidDecode({ kind: "test", request: reqFrom("1.1.1.1") }));
    });
  });
});

describe("guardPaidDecode — daily budget kill switch", () => {
  it("blocks once the estimated daily spend reaches the budget, before any vendor call", () => {
    withEnv(
      { PAID_DECODE_DAILY_BUDGET_USD: "0.10", PAID_DECODE_EST_COST_USD: "0.05", PAID_DECODE_PER_IP_LIMIT: "1000" },
      () => {
        assert.equal(guardPaidDecode({ kind: "test", request: reqFrom("9.9.9.1") }), null);
        assert.equal(guardPaidDecode({ kind: "test", request: reqFrom("9.9.9.2") }), null);
        // Third call would push estimated spend to 0.15, over the 0.10 budget.
        const blocked = guardPaidDecode({ kind: "test", request: reqFrom("9.9.9.3") });
        assert.ok(blocked);
        assert.equal(blocked?.status, 429);
      }
    );
  });

  it("a zero budget blocks every call immediately", () => {
    withEnv({ PAID_DECODE_DAILY_BUDGET_USD: "0" }, () => {
      const blocked = guardPaidDecode({ kind: "test", request: reqFrom("5.5.5.5") });
      assert.ok(blocked);
    });
  });
});

describe("guardPerDeskCap", () => {
  it("allows up to the per-desk daily limit, then blocks", () => {
    withEnv({ QUOTE_REQUEST_PER_DESK_DAILY_LIMIT: "2" }, () => {
      assert.equal(guardPerDeskCap("Paul Miller Porsche"), true);
      assert.equal(guardPerDeskCap("Paul Miller Porsche"), true);
      assert.equal(guardPerDeskCap("Paul Miller Porsche"), false);
    });
  });

  it("is case/whitespace-insensitive to the dealer name", () => {
    withEnv({ QUOTE_REQUEST_PER_DESK_DAILY_LIMIT: "1" }, () => {
      assert.equal(guardPerDeskCap("Family Ford"), true);
      assert.equal(guardPerDeskCap("  family ford  "), false);
    });
  });

  it("tracks different dealers independently", () => {
    withEnv({ QUOTE_REQUEST_PER_DESK_DAILY_LIMIT: "1" }, () => {
      assert.equal(guardPerDeskCap("Dealer A"), true);
      assert.equal(guardPerDeskCap("Dealer B"), true);
    });
  });
});

describe("recordQuoteRequest", () => {
  it("does not throw and is safe to call repeatedly", () => {
    recordQuoteRequest();
    recordQuoteRequest();
  });
});
