// The dealer must confirm the exact car is in stock before a quote is taken. Yes -> saved with a server-side time; No -> decline, or a comparable car
// under its own VIN (a different vehicle). The buyer reads the answer in the Deal Tracker; no dealer contact details, "quote request" wording only.
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AvailabilityConfirm, availabilityAnswer, availabilityErrors, availabilityQuoteVin, EMPTY_AVAILABILITY } from "../components/AvailabilityConfirm";
import { AvailabilityLines } from "../components/DealTrackerDashboard";
import { AVAILABILITY_REQUIRED_ERROR, buyerAvailabilityLine, coerceAvailability, resolveAvailability } from "./quoteAvailability";

const VIN = "5J6RW2H89NL000001";
const ALT = "5J6RW2H89NL000002";
const NOW = new Date("2026-11-03T19:05:00Z"); // 2:05pm in New York
const TZ = "America/New_York";

describe("availability is required", () => {
  it("rejects a missing or malformed answer, on the server and in the form", () => {
    for (const bad of [undefined, null, {}, { answer: "maybe" }, "yes", { answer: "" }]) {
      const r = resolveAvailability(bad, { requestedVin: VIN, quoteVin: VIN, now: NOW });
      assert.deepEqual(r, { ok: false, error: AVAILABILITY_REQUIRED_ERROR });
    }
    assert.deepEqual(availabilityErrors(EMPTY_AVAILABILITY, VIN, VIN), [AVAILABILITY_REQUIRED_ERROR]);
  });

  it("yes saves the VIN and a server-stamped confirmation time", () => {
    const r = resolveAvailability({ answer: "yes", confirmedAt: "1999-01-01T00:00:00Z" }, { requestedVin: VIN, quoteVin: VIN.toLowerCase(), now: NOW });
    assert.ok(r.ok);
    assert.deepEqual(r.availability, { status: "available", vin: VIN, confirmedAt: "2026-11-03T19:05:00.000Z" });
  });

  it("yes only confirms the car the buyer asked about", () => {
    const r = resolveAvailability({ answer: "yes" }, { requestedVin: VIN, quoteVin: ALT, now: NOW });
    assert.equal(r.ok, false);
  });

  it("an open-to-alternatives request (no VIN yet) confirms the quote's own VIN", () => {
    const r = resolveAvailability({ answer: "yes" }, { requestedVin: "", quoteVin: ALT, now: NOW });
    assert.ok(r.ok && r.availability.status === "available" && r.availability.vin === ALT);
  });
});

describe("the No path", () => {
  it("offers a comparable car under its own, different VIN, recorded as an alternative with no confirmed time", () => {
    const r = resolveAvailability({ answer: "alternative", alternativeVin: ALT }, { requestedVin: VIN, quoteVin: ALT, now: NOW });
    assert.ok(r.ok);
    assert.deepEqual(r.availability, { status: "unavailable_alternative", requestedVin: VIN, alternativeVin: ALT, recordedAt: "2026-11-03T19:05:00.000Z" });
    assert.equal("confirmedAt" in r.availability, false);
  });

  it("refuses an alternative that is the requested VIN, malformed, or not what the quote is for", () => {
    assert.equal(resolveAvailability({ answer: "alternative", alternativeVin: VIN }, { requestedVin: VIN, quoteVin: VIN }).ok, false);
    assert.equal(resolveAvailability({ answer: "alternative", alternativeVin: "SHORT" }, { requestedVin: VIN, quoteVin: "SHORT" }).ok, false);
    assert.equal(resolveAvailability({ answer: "alternative", alternativeVin: ALT }, { requestedVin: VIN, quoteVin: VIN }).ok, false);
  });

  it("the sheet: choosing No shows decline or comparable-vehicle, says it is a different car, and the alternative VIN becomes the quote's VIN", () => {
    const no = renderToStaticMarkup(<AvailabilityConfirm value={{ choice: "no", then: "", altVin: "" }} onChange={() => {}} requestedVin={VIN} sheetVin={VIN} onDecline={() => {}} />);
    assert.match(no, /data-testid="availability-decline"/);
    assert.match(no, /Offer a comparable vehicle/);
    assert.doesNotMatch(no, /availability-alt-vin/);
    const alt = renderToStaticMarkup(<AvailabilityConfirm value={{ choice: "no", then: "alternative", altVin: ALT }} onChange={() => {}} requestedVin={VIN} sheetVin={VIN} />);
    assert.match(alt, /availability-alt-vin/);
    assert.match(alt, /different vehicle/);
    const state = { choice: "no", then: "alternative", altVin: ALT } as const;
    assert.deepEqual(availabilityAnswer(state), { answer: "alternative", alternativeVin: ALT });
    assert.equal(availabilityQuoteVin(state, VIN), ALT);
    assert.deepEqual(availabilityErrors(state, VIN, VIN), []);
    // "No" with nothing chosen yet blocks the submit with a reason.
    assert.equal(availabilityErrors({ choice: "no", then: "", altVin: "" }, VIN, VIN).length, 1);
  });

  it("the sheet: the Yes choice shows the VIN and the exact wording", () => {
    const html = renderToStaticMarkup(<AvailabilityConfirm value={{ choice: "", then: "", altVin: "" }} onChange={() => {}} requestedVin={VIN} sheetVin={VIN} />);
    assert.match(html, new RegExp(`VIN ${VIN}`));
    assert.match(html, /Yes, this exact vehicle \(VIN shown\) is in stock and available/);
    assert.match(html, /No, it(&#x27;|')s sold or unavailable/);
  });
});

describe("what the buyer sees", () => {
  const confirmed = { status: "available", vin: VIN, confirmedAt: "2026-11-03T19:05:00.000Z" };
  const alt = { status: "unavailable_alternative", requestedVin: VIN, alternativeVin: ALT, recordedAt: "2026-11-03T19:06:00.000Z" };

  it("reads as plain sentences", () => {
    assert.equal(buyerAvailabilityLine(confirmed, TZ), "Dealer confirmed available · Nov 3, 2:05pm");
    assert.equal(buyerAvailabilityLine(alt, TZ), "Dealer says sold, offered an alternative");
    assert.equal(buyerAvailabilityLine(JSON.stringify(confirmed), TZ), "Dealer confirmed available · Nov 3, 2:05pm");
  });

  it("older quotes and junk show nothing", () => {
    for (const none of [undefined, null, {}, "not json", { status: "available" }]) assert.equal(buyerAvailabilityLine(none, TZ), null);
    assert.equal(coerceAvailability(undefined), null);
  });

  it("the Deal Tracker lists each quoting desk's answer with no contact details", () => {
    const rfq = {
      invites: [
        { id: "1", dealerName: "North Ford", dealerContactEmail: "sales@northford.example", quote: { availability: confirmed } },
        { id: "2", dealerName: "South Ford", dealerContactEmail: "desk@southford.example", quote: { availability: alt } },
        { id: "3", dealerName: "Old Quote Ford", quote: { availability: null } },
        { id: "4", dealerName: "No Reply Ford", quote: null },
      ],
    };
    const html = renderToStaticMarkup(<AvailabilityLines rfq={rfq as never} />);
    assert.match(html, /North Ford/);
    assert.match(html, /Dealer confirmed available · /);
    assert.match(html, /South Ford/);
    assert.match(html, /Dealer says sold, offered an alternative/);
    assert.doesNotMatch(html, /Old Quote Ford|No Reply Ford/);
    assert.doesNotMatch(html, /@|northford\.example|southford\.example/);
    assert.equal((html.match(/data-testid="rfq-availability-line"/g) || []).length, 2);
    assert.match(html, /data-alternative="true"/);
    assert.equal(renderToStaticMarkup(<AvailabilityLines rfq={{ invites: [{ id: "4", dealerName: "X", quote: null }] } as never} />), "");
  });

  it("uses 'quote request' wording, never 'bid'", () => {
    for (const f of ["lib/quoteAvailability.ts", "components/AvailabilityConfirm.tsx"]) {
      assert.doesNotMatch(fs.readFileSync(f, "utf8").replace(/\b(not|never|no)\s+(an?\s+)?(binding\s+)?bids?\b/gi, ""), /\b(bid|bids|bidding)\b/i, f);
    }
  });
});

describe("wiring", () => {
  const read = (f: string) => fs.readFileSync(f, "utf8");
  it("both dealer quote routes enforce the answer before anything reaches the box, and pass it on", () => {
    for (const f of ["app/api/quote-invite/used-quote/route.ts", "app/api/quote-invite/lease-quote/route.ts"]) {
      const src = read(f);
      const at = src.indexOf("resolveAvailability(body?.availability");
      assert.ok(at > 0, `${f} validates availability`);
      assert.ok(at < src.indexOf("submitRfqQuote("), `${f} validates before submitting`);
      assert.match(src, /status: 422/);
      assert.match(src, /availability: availability\.availability/);
    }
  });

  it("both forms block the submit on an unanswered question and send the choice", () => {
    for (const f of ["components/UsedQuoteForm.tsx", "components/LeaseCalculatorForm.tsx"]) {
      const src = read(f);
      assert.match(src, /\.\.\.availErrors/);
      assert.match(src, /availability: availabilityAnswer\(av\)/);
      assert.match(src, /<AvailabilityConfirm /);
    }
  });

  it("the migration is one new nullable column, additive only (the box patch is tested in scripts/box/rfq-quote-availability.test.mjs)", () => {
    const sql = read("scripts/box/2026-11-03-rfq-quote-availability.sql").split("\n").filter((l) => !l.startsWith("--")).join("\n");
    assert.match(sql, /ADD COLUMN IF NOT EXISTS availability_json TEXT NULL/);
    assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE|MODIFY)\b/i);
  });
});
