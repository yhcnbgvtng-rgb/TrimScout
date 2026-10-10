import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BLOCKED_NO_BYPASS_LABEL, blockedFlagText } from "./crawlSheetColumns";

describe("blockedFlagText", () => {
  it("is the 'blocked, no bypass' flag with the evidence", () => {
    assert.equal(BLOCKED_NO_BYPASS_LABEL, "blocked, no bypass");
    assert.equal(blockedFlagText({ cls: "HTTP_403", vendor: "Akamai", lastBlockedOn: "2026-10-09" }), "blocked, no bypass — HTTP_403 (Akamai), last blocked 2026-10-09");
    assert.equal(blockedFlagText({ cls: "CLOUDFLARE", vendor: null, lastBlockedOn: "2026-10-09" }), "blocked, no bypass — CLOUDFLARE, last blocked 2026-10-09");
  });
  it("is null for a dealer that is not flagged", () => {
    assert.equal(blockedFlagText(null), null);
    assert.equal(blockedFlagText(undefined), null);
  });
});
