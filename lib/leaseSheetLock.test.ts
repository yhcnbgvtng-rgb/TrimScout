import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The lease quote sheet is the buyer's to edit until the first dealer
// opens their quote link; then it's frozen, server-side, for everyone.
describe("lease sheet lock — editable until a dealer views, then frozen (box + app)", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  const box = read("scrapers/lightsail-crawler/src/deals_api_server.js");
  const script = read("scripts/box/2026-09-13-lease-sheet-lock.sh");
  const patchRoute = read("app/api/rfqs/[id]/lease-prefs/route.ts");
  const contextRoute = read("app/api/quote-invite/context/route.ts");
  const sheet = read("components/LeaseQuoteSheet.tsx");
  const format = read("components/LeaseQuoteFormat.tsx");
  const detail = read("app/rfq/[id]/page.tsx");

  it("box: lock columns exist, are set once on the first 'viewed', and PATCH lease-prefs answers 409 after", () => {
    assert.match(box, /ADD COLUMN IF NOT EXISTS lease_sheet_locked_at DATETIME NULL/);
    assert.match(box, /ADD COLUMN IF NOT EXISTS lease_sheet_locked_by_invite_id BIGINT NULL/);
    assert.match(box, /if \(status === "viewed"\) \{[\s\S]*?SET lease_sheet_locked_at = NOW\(\), lease_sheet_locked_by_invite_id = \? WHERE id = \? AND lease_sheet_locked_at IS NULL/);
    assert.match(box, /async function handlePatchRfqLeasePrefs[\s\S]*?if \(rows\[0\]\.lease_sheet_locked_at\) \{\s*return sendJson\(res, 409, \{ error: "locked"/);
    assert.match(box, /leaseSheetLockedAt: row\.lease_sheet_locked_at \|\| null/);
    assert.match(box, /pathname\.match\(\/\^\\\/api\\\/rfqs\\\/\(\\d\+\)\\\/lease-prefs\$\/\)/);
    // The user-run patch script carries the same pieces.
    for (const label of ['"columns"', '"rfq mapper"', '"lock on view"', '"patch handler"', '"route"']) assert.match(script, new RegExp(label));
  });

  it("app: the dealer's calculator page load marks the invite viewed server-side (which locks), and buyer PATCH refuses once locked", () => {
    assert.match(contextRoute, /markRfqInviteDelivery\(found\.rfqId, found\.invite\.id, "viewed"\)/);
    assert.match(patchRoute, /if \(rfq\.leaseSheetLockedAt\) \{[\s\S]*?status: 409/);
    assert.match(patchRoute, /Locked — a dealer has viewed this request\. New terms need a new quote request\./);
    assert.match(patchRoute, /parseLeasePrefs\(body\?\.leasePrefs\)/);
  });

  it("sheet: unlocked copy + Adjust while collecting and unlocked; locked copy + timestamp after; never both", () => {
    assert.match(sheet, /SHEET_UNLOCKED_COPY = "You can still adjust this lease request until a dealer opens it\."/);
    assert.match(sheet, /SHEET_LOCKED_COPY = "Locked — a dealer has viewed this request\. New terms need a new quote request\."/);
    assert.match(sheet, /return !rfq\.leaseSheetLockedAt && rfq\.status === "collecting";/);
    assert.match(sheet, /Locked when \{lockedBy \? `\$\{lockedBy\} viewed` : "a dealer viewed"\} · \{new Date\(rfq\.leaseSheetLockedAt\)\.toLocaleString\(\)\}/);
    assert.match(sheet, /\{editing && editable \? \(\s*<LeasePrefsEditor/);
    assert.match(sheet, /\/lease-prefs`, \{ method: "PATCH"/);
  });

  it("invited-dealer card on a lease deal: read-only format (blank, never $0) by default; calculator only behind an explicit phone-quote link", () => {
    assert.match(format, /AWAITING_DEALER_COPY = "Waiting on dealer — quote format below; numbers appear when they reply\."/);
    assert.match(format, /data-testid=\{q \? "lease-quote-filled" : "lease-quote-awaiting"\}/);
    assert.doesNotMatch(format, /<input|<select|<textarea/);
    assert.doesNotMatch(format, /["'`]\$0["'`]|money\(0[,)]/, "no literal $0 placeholder");
    assert.match(detail, /rfq\.leasePrefs && mode !== "quote" && \(invite\.status === "invited" \|\| invite\.quote\) \? \(\s*<LeaseQuoteFormat/);
    assert.match(detail, /Log a quote the dealer gave by phone or email/);
    // The green "Record Dealer's Quote" button is only the cash/finance path now.
    assert.match(detail, /invite\.status === "invited" && mode === "idle" && !rfq\.leasePrefs && \([\s\S]*?Record Dealer&apos;s Quote/);
  });
});
