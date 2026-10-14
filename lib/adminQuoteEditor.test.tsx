// Admin "Correct the quote sheet": plain-field quote preferences (same saved shapes as before), the Add dealer desk rules
// (a typed email is accepted whatever the package kind or directory says), and SAFE MODE routing staying untouched.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditSheet } from "../app/admin/approvals/ApprovalsClient";
import { formToPrefs, prefsPatch, prefsToForm, emptyPrefsForm } from "./adminQuotePrefs";
import { resolveAdminInviteDesk } from "./inviteDesk";
import { parseLeasePrefs } from "./leaseQuote";
import { parseQuotePrefs } from "./usedQuote";
import { SAFE_MODE_RECIPIENT, sendQuoteInviteEmail } from "./dealerEmail";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const lease = { termMonths: 36, milesPerYear: 10000, zip: "07836", timeline: "this_week", creditBand: "good", dueAtSigningIntent: "first_month_only" } as const;
const finance = { quoteType: "finance", finance: { termMonths: 60, downPayment: 3000, creditBand: "good", zip: "07836", timeline: null } } as const;

describe("quote preference fields", () => {
  it("round-trips a lease through the form to the exact stored shape", () => {
    const form = prefsToForm({ leasePrefs: lease as never });
    assert.equal(form.type, "lease");
    const r = formToPrefs(form);
    assert.ok(r.ok);
    if (r.ok) { assert.deepEqual(r.leasePrefs, parseLeasePrefs(lease)); assert.equal(r.quotePrefs, null); }
  });
  it("round-trips finance and keeps a staged cash flag", () => {
    const r = formToPrefs(prefsToForm({ quotePrefs: finance as never }));
    assert.ok(r.ok && JSON.stringify(r.quotePrefs) === JSON.stringify(parseQuotePrefs(finance)));
    const cash = { quoteType: "cash", cash: { zip: "07836", timeline: "asap" }, staged: true } as const;
    const c = formToPrefs(prefsToForm({ quotePrefs: cash as never }), { quotePrefs: cash as never });
    assert.ok(c.ok && c.quotePrefs?.quoteType === "cash" && c.quotePrefs.staged === true);
  });
  it("validates required fields per type", () => {
    const bad = formToPrefs({ ...emptyPrefsForm, type: "finance", zip: "123" });
    assert.ok(!bad.ok && bad.errors.length === 4);
    assert.ok(!formToPrefs({ ...emptyPrefsForm, type: "lease", zip: "07836", termMonths: "36" }).ok);
    assert.ok(!formToPrefs({ ...emptyPrefsForm, type: "cash" }).ok);
    assert.ok(!formToPrefs({ ...emptyPrefsForm, type: "lease", zip: "07836", termMonths: "37", milesPerYear: "10000" }).ok);
  });
  it("switching type nulls the other field; no change gives an empty patch", () => {
    const orig = { leasePrefs: lease as never };
    assert.deepEqual(prefsPatch(prefsToForm(orig), orig), { ok: true, patch: {} });
    const sw = prefsPatch({ ...emptyPrefsForm, type: "cash", zip: "07836" }, orig);
    assert.ok(sw.ok && sw.patch.leasePrefs === null && (sw.patch.quotePrefs as { quoteType: string }).quoteType === "cash");
  });
});

describe("EditSheet markup", () => {
  const rfq = { id: "r1", vin: "5N1BT3BA4TC737546", vehicleYear: 2026, vehicleMake: "Nissan", vehicleModel: "Rogue", vehicleTrim: "SV", leasePrefs: lease, quotePrefs: null } as never;
  const html = renderToStaticMarkup(<EditSheet rfq={rfq} onChanged={() => {}} onClose={() => {}} />);
  it("shows a quote-type dropdown and lease fields, with no raw JSON textarea", () => {
    assert.match(html, /data-testid="quote-type"/);
    assert.match(html, /Miles per year/);
    assert.doesNotMatch(html, /Down payment/);
    assert.doesNotMatch(html, /<textarea[^>]*Quote locks/);
    assert.match(html, /data-testid="advanced-toggle"/);
    assert.doesNotMatch(html, /data-testid="advanced-json"/);
  });
  it("Add dealer is a type-ahead with a state and an editable email; the old 'Nothing changed.' is gone", () => {
    assert.match(html, /data-testid="dealer-name"/);
    assert.match(html, /data-testid="dealer-email"/);
    const src = read("app/admin/approvals/ApprovalsClient.tsx");
    assert.doesNotMatch(src, /Nothing changed\./);
    assert.match(src, /Nothing was saved/);
    assert.match(src, /Add dealer needs a/);
  });
});

describe("admin Add dealer desk", () => {
  const rfq = (packageKind: string) => ({ id: "r1", packageKind, invites: [] }) as never;
  const row = (over: object = {}) => ({ id: "d1", dealerName: "Howell Nissan", city: "Butler", state: "NJ", contactName: "", contactEmail: null, emailOptOut: false, ...over }) as never;
  const input = { dealerName: "Howell Nissan", dealerState: "NJ", providedEmail: "jane.doe@howellnissan.com" };
  it("accepts a typed email when the directory has none, on any package kind", async () => {
    for (const kind of ["links", "search", ""]) {
      const r = await resolveAdminInviteDesk(rfq(kind), input, [row()]);
      assert.ok(r.ok && r.desk?.email === "jane.doe@howellnissan.com", kind);
    }
  });
  it("accepts a typed email for a dealer not in the directory", async () => {
    const r = await resolveAdminInviteDesk(rfq("links"), input, []);
    assert.ok(r.ok && r.desk?.email === "jane.doe@howellnissan.com");
  });
  it("a typed shared mailbox is allowed for an admin; no email at all still routes to the rooftop desk", async () => {
    const g = await resolveAdminInviteDesk(rfq("links"), { ...input, providedEmail: "sales@howellnissan.com" }, [row()]);
    assert.ok(g.ok && g.desk?.email === "sales@howellnissan.com" && !g.desk.knownNamed);
    const n = await resolveAdminInviteDesk(rfq("links"), { ...input, providedEmail: "" }, [row()]);
    assert.ok(n.ok && n.desk?.email === "");
  });
  it("still refuses an opted-out dealer", async () => {
    const r = await resolveAdminInviteDesk(rfq("links"), input, [row({ emailOptOut: true })]);
    assert.ok(!r.ok && r.code === "dealer_opted_out");
  });
  it("the route requires name + state and a valid email, and uses the admin resolver", () => {
    const src = read("app/api/admin/rfqs/[id]/invites/route.ts");
    assert.match(src, /A dealer name is required/);
    assert.match(src, /2-letter dealer state is required/);
    assert.match(src, /doesn't look valid/);
    assert.match(src, /resolveAdminInviteDesk/);
    assert.match(read("app/api/admin/dealer-search/route.ts"), /requireAdminSession/);
  });
});

describe("SAFE MODE is untouched", () => {
  it(`the sender posts only to ${SAFE_MODE_RECIPIENT}`, async () => {
    const original = globalThis.fetch; const prevKey = process.env.RESEND_API_KEY; const bodies: Array<{ to: string[] }> = [];
    process.env.RESEND_API_KEY = "re_test_key";
    globalThis.fetch = (async (_u: unknown, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as never;
    try {
      assert.equal(await sendQuoteInviteEmail("s", "<p>x</p>"), true);
      assert.deepEqual(bodies.map((b) => b.to), [[SAFE_MODE_RECIPIENT]]);
    } finally {
      globalThis.fetch = original; if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    }
    assert.equal(SAFE_MODE_RECIPIENT, "pausmi@outlook.com");
    assert.match(read("lib/dealerEmail.ts"), /to: \[SAFE_MODE_RECIPIENT\]/);
  });
});
