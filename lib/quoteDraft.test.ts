import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QUOTE_DRAFT_KEY, QUOTE_DRAFT_TTL_MS, clearQuoteDraft, readQuoteDraft, saveQuoteDraft, wizardAuthState } from "./quoteDraft";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

describe("quote draft — parked across an auth round-trip", () => {
  it("round-trips step + state and clears on read-then-clear", () => {
    const s = memStore();
    const state = { quoteType: "lease", leaseTerm: 36, leaseMiles: 10000, huntZip: "07405", selectedVehicle: { vin: "1GNS6MKD2TR280381" } };
    assert.equal(saveQuoteDraft({ step: 2, reason: "sign_in", state }, s), true);
    const back = readQuoteDraft(s);
    assert.ok(back);
    assert.equal(back.step, 2);
    assert.equal(back.reason, "sign_in");
    assert.deepEqual(back.state, state);
    clearQuoteDraft(s);
    assert.equal(readQuoteDraft(s), null);
  });

  it("a stale draft (older than the TTL) is discarded, not restored", () => {
    const s = memStore();
    saveQuoteDraft({ step: 3, reason: "sign_up", state: {} }, s);
    const later = Date.now() + QUOTE_DRAFT_TTL_MS + 1;
    assert.equal(readQuoteDraft(s, later), null);
    assert.equal(s.getItem(QUOTE_DRAFT_KEY), null, "stale draft removed");
  });

  it("garbage in storage never throws and is cleaned up", () => {
    const s = memStore();
    s.setItem(QUOTE_DRAFT_KEY, "{not json");
    assert.equal(readQuoteDraft(s), null);
    assert.equal(s.getItem(QUOTE_DRAFT_KEY), null);
    s.setItem(QUOTE_DRAFT_KEY, JSON.stringify({ version: 2, step: "x" }));
    assert.equal(readQuoteDraft(s), null);
  });

  it("no storage (SSR, blocked) is a no-op, not an error", () => {
    assert.equal(saveQuoteDraft({ step: 1, reason: "sign_in", state: {} }, null), false);
    assert.equal(readQuoteDraft(null), null);
    clearQuoteDraft(null);
  });

  it("header link set: signed out → sign in/up; buyer → quiet; dealer/admin → sign in as buyer", () => {
    assert.equal(wizardAuthState(null), "signed_out");
    assert.equal(wizardAuthState({ role: "buyer" }), "buyer");
    assert.equal(wizardAuthState({ role: "dealer" }), "not_buyer");
    assert.equal(wizardAuthState({ role: "admin" }), "not_buyer");
  });
});

import fs from "node:fs";
import path from "node:path";

describe("wizard wiring — discreet auth on every step, draft survives every path", () => {
  const wizard = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
  const page = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");

  it("header chrome carries the auth links (all steps share one header) with the close button after them", () => {
    assert.match(wizard, /data-testid="wizard-auth"/);
    assert.match(wizard, /authState === "signed_out" \?[\s\S]*?Sign in[\s\S]*?Sign up/);
    assert.match(wizard, /authState === "not_buyer" \?[\s\S]*?Sign in as buyer/);
    assert.match(wizard, /aria-label="Close"/);
  });

  it("the Step 4 gate never closes the wizard to sign in, and the banner reinforces the header link", () => {
    assert.doesNotMatch(wizard, /if \(!currentUser\) \{\s*onClose\(\);/);
    assert.match(wizard, /Sign in as a buyer to send this request — your vehicle, preferences and dealers stay as they are/);
    assert.match(wizard, /currentUser\.role !== "buyer"[\s\S]*?openAuth\("switch_account"\)/);
  });

  it("every auth path parks the draft first; sign-in from the wizard doesn't yank the page to a dashboard", () => {
    assert.match(wizard, /const openAuth = \(reason[\s\S]*?parkDraft\(reason\)/);
    assert.match(wizard, /const goSignUp = \(\) => \{\s*parkDraft\("sign_up"\)/);
    assert.match(wizard, /readQuoteDraft\(\)[\s\S]*?onDraftRestored\?\.\(\)/);
    assert.match(page, /onDraftRestored=\{\(\) => setIsWizardOpen\(true\)\}/);
    assert.match(page, /if \(!isWizardOpen\) setCurrentView/);
    assert.match(page, /onSwitchToBuyer=\{async[\s\S]*?authSignOut\(\{ redirect: false \}\)/);
  });
});
