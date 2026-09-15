import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { quoteInviteSubject, quoteInviteHtml, quoteInviteTitle, areaLabel, prefsLine, QUOTE_EMAIL_COPY, type QuoteInviteEmailInput } from "./quoteInviteEmail";

const base: QuoteInviteEmailInput = {
  quoteType: "cash",
  dealerName: "Bachrodt BMW",
  contactName: "Jane Doe",
  role: "sales_manager",
  rooftop: { city: "Rockford", state: "IL", address: "5290 E State St" },
  vehicle: { year: 2026, make: "BMW", model: "X3", trim: "30 xDrive", vin: "5UX53GP01T9190742", vdpUrl: "https://www.loubachrodtbmw.com/vdp/1" },
  dealReference: "TS-ABC234",
  viewUrl: "https://www.trimscout.com/api/quote-invite/view?t=tok123",
  unsubscribeUrl: "https://www.trimscout.com/unsubscribe/1?t=x",
  purchaseTimelineLabel: "ASAP",
  buyerZip: "07405",
};
const lease: QuoteInviteEmailInput = { ...base, quoteType: "lease", buyerZip: null, leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: "this_month" }, purchaseTimelineLabel: "Within the month", vehicleFacts: { drivetrain: "4X4", exteriorColor: "Cactus Gray" } };
const finance: QuoteInviteEmailInput = { ...base, quoteType: "finance", financePrefs: { termMonths: 60, downPayment: 3000, creditBand: "good" } };

// The card's row labels, in order, as the email renders them.
const rowLabels = (html: string) => [...html.matchAll(/<td style="padding:5px 0;color:#64748b[^>]*>([A-Za-z]+)<\/td>/g)].map((m) => m[1]);
const stripped = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("quote-request email — one template for Cash / Lease / Finance", () => {
  it("title: '{type} quote request — {year model trim} · {pay} · {area}'; subject adds the VIN tail", () => {
    assert.equal(quoteInviteTitle(base), "OTD quote request — 2026 X3 30 xDrive · Cash · Butler, NJ (07405)");
    assert.equal(quoteInviteTitle(lease), "Lease quote request — 2026 X3 30 xDrive · Lease · Butler, NJ (07405)");
    assert.equal(quoteInviteTitle(finance), "Finance quote request — 2026 X3 30 xDrive · Finance · Butler, NJ (07405)");
    assert.equal(quoteInviteSubject(base), "OTD quote request — 2026 X3 30 xDrive · Cash · Butler, NJ (07405) · VIN …190742");
  });

  it("area: exact ZIP → 'City, ST (ZIP)'; unknown ZIP → 'ST (ZIP)'; no ZIP → omitted", () => {
    assert.equal(areaLabel("07405"), "Butler, NJ (07405)");
    assert.equal(areaLabel("07999"), "NJ (07999)");
    assert.equal(areaLabel(""), null);
    assert.equal(areaLabel(null), null);
    assert.doesNotMatch(quoteInviteHtml({ ...base, buyerZip: null }), />Area</);
  });

  it("prefs row: lease term·miles; finance term·down(·credit); cash has no prefs row", () => {
    assert.equal(prefsLine(lease), "36 mo · 10,000 mi/yr");
    assert.equal(prefsLine(finance), "60 mo · $3,000 down · credit: Good");
    assert.equal(prefsLine({ ...finance, financePrefs: { termMonths: 72, downPayment: 0 } }), "72 mo · $0 down");
    assert.equal(prefsLine(base), null);
    assert.deepEqual(rowLabels(quoteInviteHtml(base)), ["Pay", "Area", "Timeline", "Rooftop"]);
    assert.deepEqual(rowLabels(quoteInviteHtml(lease)), ["Pay", "Prefs", "Area", "Timeline", "Rooftop"]);
    assert.deepEqual(rowLabels(quoteInviteHtml({ ...finance, purchaseTimelineLabel: null })), ["Pay", "Prefs", "Area", "Rooftop"]);
  });

  it("identical structure across types — only pay / prefs / CTA / helper differ", () => {
    const shape = (html: string) => html.replace(/>[^<]*</g, "><").replace(/href="[^"]*"/g, 'href=""').replace(/src="[^"]*"/g, 'src=""');
    const cash = quoteInviteHtml(base);
    const fin = quoteInviteHtml({ ...finance, financePrefs: null });
    assert.equal(shape(cash), shape(fin), "cash and finance (no prefs) render the same skeleton");
    for (const [type, input] of [["cash", base], ["lease", lease], ["finance", finance]] as const) {
      const html = quoteInviteHtml(input);
      const copy = QUOTE_EMAIL_COPY[type];
      assert.match(html, new RegExp(`>${copy.cta}</a>`));
      assert.match(html, new RegExp(copy.helper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(html, new RegExp(`>Pay</td><td[^>]*>${copy.pay}</td>`));
      assert.match(html, new RegExp(`a buyer wants a <strong>${type}</strong> quote on this unit\\. Submit in TrimScout — don&#39;t reply to this email\\.`));
    }
  });

  it("CTA is the first action and goes to the tracked link; 'View request details' is the secondary link", () => {
    const html = quoteInviteHtml(base);
    const cta = html.indexOf("Submit OTD quote");
    const card = html.indexOf("VIN 5UX53GP01T9190742");
    assert.ok(cta > 0 && cta < card, "CTA renders before the card");
    assert.match(html, /<a href="https:\/\/www\.trimscout\.com\/api\/quote-invite\/view\?t=tok123"[^>]*>Submit OTD quote<\/a>/);
    assert.match(html, /<a href="https:\/\/www\.trimscout\.com\/api\/quote-invite\/view\?t=tok123"[^>]*>View request details<\/a>/);
    assert.doesNotMatch(html, /answer this email|reply with|out-the-door price|Open the lease calculator/);
  });

  it("rooftop is named in the card (name · city, ST · address) and in the footer (Sent to … · rooftop · ref)", () => {
    const html = quoteInviteHtml(base);
    assert.match(html, />Rooftop<\/td><td[^>]*>Bachrodt BMW · Rockford, IL · 5290 E State St<\/td>/);
    assert.match(html, /Sent to Jane Doe, Sales Manager · Bachrodt BMW · TS-ABC234/);
    assert.match(html, />Unsubscribe this rooftop</);
    // State-only rooftop (buyer-typed desk, no directory row) still names the store.
    assert.match(quoteInviteHtml({ ...base, rooftop: { state: "NJ" } }), />Rooftop<\/td><td[^>]*>Bachrodt BMW · NJ<\/td>/);
  });

  it("one card, no icon grid, skinny footer: one short legal line + Terms link", () => {
    const html = quoteInviteHtml(lease);
    assert.equal((html.match(/border-radius:12px/g) || []).length, 1, "exactly one card");
    assert.doesNotMatch(html, /grid|<td[^>]*width:33%/);
    assert.match(html, /Non-binding quote request — not an auction, not a bid, no deadline on you\. <a href="https:\/\/www\.trimscout\.com\/terms"/);
    assert.ok(stripped(html).split("Sent to")[1].length < 260, "footer stays short");
    assert.match(html, /max-width:600px/);
  });

  it("opens with the TrimScout mark + wordmark (Trim green / Scout dark), linked home", () => {
    const html = quoteInviteHtml(base);
    assert.match(html, /<img src="https:\/\/[^"]+\/scoutmark\.png"[^>]*alt="TrimScout"/);
    assert.match(html, /<span style="color:#059669">Trim<\/span>Scout/);
  });

  it("card: car, facts, full VIN, 'Your listing' link (only when there is a listing), optional thumb", () => {
    const html = quoteInviteHtml(lease);
    assert.match(html, /2026 BMW X3 30 xDrive/);
    assert.match(html, /4X4 · Cactus Gray/);
    assert.match(html, /VIN 5UX53GP01T9190742/);
    assert.match(html, /<a href="https:\/\/www\.loubachrodtbmw\.com\/vdp\/1"[^>]*>Your listing<\/a>/);
    assert.doesNotMatch(quoteInviteHtml({ ...base, vehicle: { ...base.vehicle, vdpUrl: null } }), /Your listing/);
    assert.match(quoteInviteHtml({ ...base, vehicle: { ...base.vehicle, imageUrl: "https://img.example/x.jpg" } }), /<img src="https:\/\/img\.example\/x\.jpg"/);
  });

  it("soft identity: no buyer name/email, no alias, no auction language beyond the disclaimer", () => {
    const html = quoteInviteHtml({ ...lease, buyerAlias: "Buyer #K7M3Q" });
    assert.doesNotMatch(html, /Buyer #|@outlook|@gmail|pausmi|buyer@/i);
    assert.doesNotMatch(html.replace(/not an auction, not a bid/g, ""), /anonymous|auction|\bbid\b|reverse|lock-in|live/i);
    assert.doesNotMatch(stripped(html), /transparent quote|no add-ons/i, "no invented must-haves");
  });

  it("carries the buyer's note as a 'Buyer says' row, escaped, only when there is one", () => {
    assert.doesNotMatch(quoteInviteHtml(base), /Buyer says/);
    const html = quoteInviteHtml({ ...base, buyerNote: "Flexible on color <b>bold</b>\nNeed it by the 30th" });
    assert.match(html, />Buyer says<\/td>/);
    assert.match(html, /Flexible on color &lt;b&gt;bold&lt;\/b&gt;/);
    assert.match(html, /white-space:pre-wrap/);
  });

  it("says a trade-in is coming (handled after the OTD price) only when the buyer said so", () => {
    assert.doesNotMatch(quoteInviteHtml(base), /Trade-in/);
    assert.doesNotMatch(quoteInviteHtml({ ...base, tradeInExpected: false }), /Trade-in/);
    assert.match(quoteInviteHtml({ ...base, tradeInExpected: true }), />Trade-in<\/td><td[^>]*>Coming .*handled after the out-the-door price is agreed/);
  });

  it("escapes what it interpolates", () => {
    const html = quoteInviteHtml({ ...base, dealerName: 'Evil <script>alert("x")</script> Motors' });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });
});

describe("wiring — the send route feeds the one template", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("quote type comes from stored prefs first (lease / used finance) then the client's ask; rooftop from the directory row; ZIP from stored prefs then the wizard", () => {
    const r = read("app/api/rfqs/[id]/invites/route.ts");
    assert.match(r, /const quoteType: QuoteEmailType = rfq\.leasePrefs\s*\? "lease"/);
    assert.match(r, /rooftop: directoryRow\s*\? \{ city: directoryRow\.city, state: directoryRow\.state, address: directoryRow\.address \}/);
    assert.match(r, /const buyerZip = storedZip \|\| \(typeof body\?\.buyerZip === "string"/);
    assert.doesNotMatch(r, /paymentLabel|formatDealStructures/);
  });
  it("wizard sends buyerZip + finance prefs with each invite; dealer landing for a new-car cash/finance request points at log in / sign up", () => {
    const w = read("components/BiddingWizard.tsx");
    assert.match(w, /buyerZip: zipOk \? huntZip : null,/);
    assert.match(w, /financePrefs:\s*quoteType === "finance"\s*\? \{ termMonths: financeTerm \|\| 60, downPayment/);
    const page = read("app/quote-request/received/page.tsx");
    assert.match(page, /data-testid="login-to-quote"/);
    assert.match(page, /href="\/\?login=1"/);
    assert.match(page, /href="\/signup"/);
    assert.doesNotMatch(page, /from "\.\.\/\.\.\/\.\.\/lib\/quoteInviteEmail"/, "client page must not import the server-only email module");
  });
});
