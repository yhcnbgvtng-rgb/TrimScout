import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { quoteInviteSubject, quoteInviteHtml, type QuoteInviteEmailInput } from "./quoteInviteEmail";

const input: QuoteInviteEmailInput = {
  dealerName: "Bachrodt BMW",
  contactName: "Jane Doe",
  role: "sales_manager",
  vehicle: { year: 2026, make: "BMW", model: "X3", trim: "30 xDrive", vin: "5UX53GP01T9190742", vdpUrl: "https://www.loubachrodtbmw.com/vdp/1" },
  buyerAlias: "Buyer #K7M3Q",
  dealReference: "TS-ABC234",
  viewUrl: "https://www.trimscout.com/api/quote-invite/view?t=tok123",
  unsubscribeUrl: "https://www.trimscout.com/unsubscribe/1?t=x",
  paymentLabel: "Cash",
  purchaseTimelineLabel: "ASAP",
};

describe("quote invite email", () => {
  it("names the car, the VIN and the alias in the subject", () => {
    assert.equal(quoteInviteSubject(input), "Quote request: 2026 BMW X3 30 xDrive (VIN …190742) — Buyer #K7M3Q");
  });

  it("says request-not-bid and how to reply, and carries the tracked link", () => {
    const html = quoteInviteHtml(input);
    assert.match(html, /request for a quote, not a bid/);
    assert.match(html, /either side can walk away/);
    assert.match(html, /answer this email with your best out-the-door price/);
    assert.match(html, /Leave sales tax and registration out/);
    assert.match(html, /api\/quote-invite\/view\?t=tok123/);
    assert.match(html, /Hi Jane,/);
    assert.match(html, /Sales Manager at Bachrodt BMW/);
    assert.match(html, /TS-ABC234/);
    assert.match(html, /Unsubscribe/);
  });

  it("never carries anything that identifies the buyer beyond the alias", () => {
    const html = quoteInviteHtml({ ...input, buyerAlias: "Buyer #K7M3Q" });
    assert.match(html, /Buyer #K7M3Q/);
    assert.doesNotMatch(html, /@outlook\.com|@gmail\.com/);
    assert.doesNotMatch(html, /\b\d{5}\b(?!\d)/, "no ZIP-shaped number outside the VIN");
  });

  it("escapes what it interpolates", () => {
    const html = quoteInviteHtml({ ...input, dealerName: 'Evil <script>alert("x")</script> Motors' });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });
});
