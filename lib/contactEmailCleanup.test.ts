import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nodeFs from "node:fs";
import { planContactEmailCleanup, rollbackStatements } from "../scrapers/lightsail-crawler/src/contactEmailCleanup.js";

const base = { website: null, domainsJson: null, emailOptOut: 0, notes: null };
const rows = [
  { ...base, id: 1, dealerName: "Autoplex Hyundai", contactEmail: "accessibility@hmausa.com", website: "autoplex-tx.com" },
  { ...base, id: 2, dealerName: "Ford of Lafayette", contactEmail: "s@leadcrm.com" },
  { ...base, id: 3, dealerName: "Pomeroy Chrysler", contactEmail: "logo@2x.png" },
  { ...base, id: 4, dealerName: "Houston Hyundai", contactEmail: "ruben@houstonhyundai" },
  { ...base, id: 5, dealerName: "Plain Motors", contactEmail: "info@plainmotors.com" },
  { ...base, id: 6, dealerName: "Good Motors", contactEmail: "jdoe@goodmotors.com" },                                  // fine: untouched
  { ...base, id: 7, dealerName: "Gmail Motors", contactEmail: "gina@gmail.com" },                                      // unverified: left alone
  // notes carry an address and the email column is empty
  { ...base, id: 8, dealerName: "Lexus of Route 10", contactEmail: null, notes: "Website: lexusofroute10.com | Lead inbox: Sales@lexusofroute10.com" },
  { ...base, id: 9, dealerName: "Info Only Kia", contactEmail: "", notes: "Email: info@infoonlykia.com" },              // department: not moved
  { ...base, id: 10, dealerName: "Vendor Honda", contactEmail: null, notes: "leads at x@eleadtrack.net" },              // vendor: not moved
  { ...base, id: 11, dealerName: "Stranger Subaru", contactEmail: null, notes: "contact jdoe@totallydifferent.com" },    // unrelated: not moved
  { ...base, id: 12, dealerName: "No Address Mazda", contactEmail: null, notes: "no email here" },
  { ...base, id: 13, dealerName: "Cleared And Noted", contactEmail: "info@x.com", notes: "alt: jdoe@clearedandnoted.com" }, // cleared; notes address NOT moved in the same pass
];

describe("planContactEmailCleanup", () => {
  const plan = planContactEmailCleanup(rows, { activeIds: new Set([1, 2, 8, 11]) });

  it("clears exactly the invalid stored addresses, by kind", () => {
    assert.deepEqual(plan.clear.map((c) => c.id), [1, 2, 3, 4, 5, 13]);
    assert.deepEqual(plan.counts.clearByKind, { department_mailbox: 3, vendor_or_oem_domain: 1, junk_file_name: 1, bad_format: 1 });
    // accessibility@ is both a department mailbox and an OEM domain; the department check names it first
    assert.equal(plan.clear[0].kind, "department_mailbox");
  });

  it("leaves good and merely-unverified addresses alone", () => {
    const ids = new Set(plan.clear.map((c) => c.id));
    assert.equal(ids.has(6), false);
    assert.equal(ids.has(7), false);
  });

  it("moves a notes address into an empty email column only when it passes the same check, lowercased", () => {
    assert.deepEqual(plan.move, [{ id: 8, old: null, next: "sales@lexusofroute10.com" }]);
  });

  it("reports why the other notes addresses were not moved", () => {
    assert.deepEqual(plan.counts.moveRejected, { no_address_in_notes: 0, bad_format: 0, junk_file_name: 0, department_mailbox: 1, vendor_or_oem_domain: 1, unverified: 1 });
  });

  it("counts everything, and the on-the-lot subset", () => {
    assert.equal(plan.counts.rows, 13);
    assert.equal(plan.counts.clear, 6);
    assert.equal(plan.counts.clearActive, 2);
    assert.equal(plan.counts.move, 1);
    assert.equal(plan.counts.moveActive, 1);
  });

  it("without activeIds the on-the-lot counts are unknown, not zero", () => {
    const p = planContactEmailCleanup(rows);
    assert.equal(p.counts.clearActive, null);
    assert.equal(p.counts.moveActive, null);
  });

  it("is idempotent: a second plan over the cleaned rows changes nothing", () => {
    const cleaned = rows.map((r) => {
      const c = plan.clear.find((x) => x.id === r.id);
      const m = plan.move.find((x) => x.id === r.id);
      return { ...r, contactEmail: c ? null : m ? m.next : r.contactEmail };
    });
    const again = planContactEmailCleanup(cleaned);
    assert.deepEqual(again.clear, []);
    // row 13's notes address is now eligible (the bad one is gone), which is correct: that is the second pass of a two-step fix
    assert.deepEqual(again.move.map((m) => m.id), [13]);
  });

  it("rollback restores every touched row, guarded on the value the cleanup wrote", () => {
    const back = rollbackStatements(plan);
    assert.equal(back.length, plan.clear.length + plan.move.length);
    assert.deepEqual(back.find((b) => b.id === 1), { id: 1, writtenValue: null, restore: "accessibility@hmausa.com" });
    assert.deepEqual(back.find((b) => b.id === 8), { id: 8, writtenValue: "sales@lexusofroute10.com", restore: null });
  });
});

describe("the cleanup script's gates", () => {
  const fs = nodeFs;
  const src = fs.readFileSync(new URL("../scripts/box/2026-10-30-contact-email-cleanup.mjs", import.meta.url), "utf8");
  it("dry run is the default and read-only", () => {
    assert.match(src, /SET SESSION TRANSACTION READ ONLY/);
    assert.match(src, /const WRITES = APPLY \|\| ROLLBACK/);
  });
  it("apply needs --fleet-idle, --go and a reviewed --plan, and takes the sync lock", () => {
    assert.match(src, /without --fleet-idle/);
    assert.match(src, /without --go/);
    assert.match(src, /--apply needs --plan=/);
    assert.match(src, /sync-lock\/\$\{action\}/);
    assert.match(src, /acquire/);
  });
  it("writes a backup and a rollback file before the first update, and guards each update on the old value", () => {
    const backupAt = src.indexOf("contact-email-backup-");
    const rollbackAt = src.indexOf("contact-email-rollback-");
    const firstUpdate = src.indexOf("writeGuarded(plan.clear");
    assert.ok(backupAt > 0 && rollbackAt > 0 && firstUpdate > backupAt && firstUpdate > rollbackAt);
    assert.match(src, /WHERE id = \? AND contact_email <=> \?/);
  });
});
