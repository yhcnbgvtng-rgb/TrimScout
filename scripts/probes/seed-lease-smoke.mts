/**
 * Seeds LEASE smoke requests under a real buyer account, each already
 * quoted by its dealers through the same calculator math the dealer page
 * uses — so the buyer can go straight to Compare → Counter → the
 * before/after page. Requests are marked approved (already released) so
 * quotes make sense; invites are marked sent/viewed; nothing is emailed.
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/probes/seed-lease-smoke.mts <buyerUserId>
 */
import { createRfq, createRfqInvite, markRfqInviteDelivery, setRfqApproval, submitRfqQuote } from "../../lib/rfqApi";
import { dueAtSigningFrom, monthlyPreTax, monthlyWithTax } from "../../lib/leaseMath";
import { validateLeaseQuote, type LeaseQuote, type LeaseRequestPrefs } from "../../lib/leaseQuote";

const buyerUserId = process.argv[2];
if (!buyerUserId) throw new Error("pass the buyerUserId");
const now = new Date().toISOString();
const stamp = () => Date.now().toString(36).slice(-4).toUpperCase();
const expires = new Date(Date.now() + 10 * 86400e3).toISOString();

/** A dealer's lease as their calculator would write it: cap already nets incentives; add-ons listed outside the payment. */
function leaseQuote(d: { msrp: number; sellingPrice: number; incentives: { name: string; amount: number }[]; residualPct: number; mf: number; term: number; miles: number; capReduction: number; acq: number; taxRate: number; docFee: number; addOns: { name: string; amount: number }[]; notes?: string }): LeaseQuote {
  const incentivesTotal = d.incentives.reduce((t, i) => t + i.amount, 0);
  const capCost = Math.round((d.sellingPrice - incentivesTotal) * 100) / 100;
  const residualAmount = Math.round(d.msrp * d.residualPct / 100);
  const netCap = capCost - d.capReduction;
  const monthly = monthlyPreTax({ netCap, residualAmount, moneyFactor: d.mf, termMonths: d.term })!;
  const taxed = monthlyWithTax(monthly, d.taxRate)!;
  const das = dueAtSigningFrom({ monthly, monthlyTaxed: taxed, acquisitionFee: d.acq, capReduction: d.capReduction, taxesOverride: null, taxRate: d.taxRate, otherFees: [{ name: "Doc fee", amount: d.docFee }, { name: "Title & registration", amount: 395 }] })!;
  return { capCost, residualPercent: d.residualPct, residualAmount, moneyFactor: d.mf, termMonths: d.term, milesPerYear: d.miles, capReduction: d.capReduction, monthlyPaymentPreTax: monthly, monthlyPaymentWithEstTax: taxed, dueAtSigning: das, incentives: d.incentives, addOns: d.addOns, expiresAt: expires, notes: d.notes ?? null, counter: { counterOffer: false, note: "" } };
}

const seeds: Array<{ label: string; vin: string; year: number; make: string; model: string; trim: string; msrp: number; prefs: LeaseRequestPrefs; dealers: Array<{ name: string; state: string; contact: string; role: string; url: string; quote: Parameters<typeof leaseQuote>[0] | null }> }> = [
  {
    label: "Lexus NX 350 — two quotes, one with a $899 add-on and a fat doc fee (counter target #1)",
    vin: "2T2HGCEZ9TC38B302", year: 2026, make: "Lexus", model: "NX", trim: "350 Luxury", msrp: 52750,
    prefs: { termMonths: 36, milesPerYear: 12000, zip: "07981", timeline: "this_month", creditBand: "excellent", dueAtSigningIntent: "first_month_only" },
    dealers: [
      { name: "Lexus of Route 10", state: "NJ", contact: "E. Ruby", role: "internet", url: "https://www.lexusofroute10.com/new-Whipanny+-2026-Lexus-NX-350+LUXURY+AWD-2T2HGCEZ9TC38B302",
        quote: { msrp: 52750, sellingPrice: 51200, incentives: [{ name: "Lexus lease cash", amount: 1000 }], residualPct: 58, mf: 0.00215, term: 36, miles: 12000, capReduction: 0, acq: 995, taxRate: 0.06625, docFee: 799, addOns: [{ name: "Wheel & tire protection", amount: 899 }], notes: "In stock, Caviar. Loyalty available if you're coming out of a Lexus." } },
      { name: "Bob Johnson Lexus", state: "NY", contact: "Sales desk", role: "sales", url: "https://www.bobjohnsonlexus.com/new-Henrietta+NY-2026-Lexus-NX+HYBRID-NX+350h+PREMIUM+AWD-2T2GKCEZXTC39B377",
        quote: { msrp: 52750, sellingPrice: 50900, incentives: [{ name: "Lexus lease cash", amount: 1000 }], residualPct: 58, mf: 0.00215, term: 36, miles: 12000, capReduction: 1500, acq: 995, taxRate: 0.08, docFee: 175, addOns: [], notes: "NY doc fee is capped at $175." } },
    ],
  },
  {
    label: "Toyota RAV4 — one quote, no add-ons, cash down (counter target #2: ask for lower cap + more cash down)",
    vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", msrp: 36410,
    prefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: "this_week", creditBand: "good", dueAtSigningIntent: "cash_down" },
    dealers: [
      { name: "Route 22 Toyota", state: "NJ", contact: "Sales desk", role: "sales", url: "https://www.route22toyota.com/viewdetails/new/2t36cravxtc39j403/2026-toyota-rav4-sport-utility",
        quote: { msrp: 36410, sellingPrice: 35900, incentives: [], residualPct: 62, mf: 0.00275, term: 36, miles: 10000, capReduction: 2500, acq: 650, taxRate: 0.06625, docFee: 799, addOns: [], notes: null } },
    ],
  },
  {
    label: "Toyota Corolla Cross — one dealer still waiting (no quote yet), so the compare shows a Waiting row",
    vin: "7MUDAABG0TV38A676", year: 2026, make: "Toyota", model: "Corolla Cross", trim: "XLE", msrp: 30245,
    prefs: { termMonths: 39, milesPerYear: 12000, zip: "10469", timeline: "this_month", creditBand: "excellent", dueAtSigningIntent: "first_month_only" },
    dealers: [
      { name: "City World Toyota", state: "NY", contact: "Robert Tineo", role: "gsm", url: "https://www.cityworldtoyota.com/new/Toyota/2026-Toyota-Corolla-Cross-1c065ae4ac185c3035c89e23357eea3c.htm", quote: null },
    ],
  },
];

const out: Array<Record<string, unknown>> = [];
for (const s of seeds) {
  const ref = `TS-L${stamp()}${String(out.length + 1)}`.slice(0, 9);
  const rfq = await createRfq({
    buyerUserId, vin: s.vin, stockNumber: null, vehicleYear: s.year, vehicleMake: s.make, vehicleModel: s.model, vehicleTrim: s.trim, mustHaves: [], packageKind: "links",
    linkPastes: s.dealers.map((d) => ({ vin: s.vin, year: s.year, make: s.make, model: s.model, trim: s.trim, dealerName: d.name, dealerState: d.state, vdpUrl: d.url, buildConfidence: "dealer_listing_only", resolvedAt: now, condition: "new", msrp: s.msrp })),
    dealReference: ref, leasePrefs: s.prefs, quotePrefs: null, buyerNote: "Quoting to my locks please — 36/39 mo as requested, itemized DAS.", tradeInExpected: false,
  });
  // Already released, so the dealers "have it" and quotes make sense.
  await setRfqApproval(rfq.id, { decision: "approved", by: "seed-lease-smoke" });
  const dealers: Array<Record<string, unknown>> = [];
  for (const d of s.dealers) {
    const invite = await createRfqInvite(rfq.id, {
      dealerName: d.name, dealerContactEmail: `smoke.${d.name.replace(/\W+/g, "").toLowerCase()}@example.com`,
      desk: { contactName: d.contact, role: d.role, emailMasked: `s••••@example.com`, source: d.contact === "Sales desk" ? "rooftop" : "directory" },
      vehicle: { vin: s.vin, year: s.year, make: s.make, model: s.model, trim: s.trim, vdpUrl: d.url },
    });
    await markRfqInviteDelivery(rfq.id, invite.id, "sent").catch(() => null);
    if (!d.quote) { dealers.push({ dealer: d.name, inviteId: invite.id, quoted: false }); continue; }
    await markRfqInviteDelivery(rfq.id, invite.id, "viewed").catch(() => null);
    const lease = leaseQuote(d.quote);
    const v = validateLeaseQuote(lease, s.prefs, { vin: s.vin });
    if (v.errors.length) throw new Error(`${d.name}: ${v.errors.join("; ")}`);
    await submitRfqQuote(rfq.id, invite.id, { price: lease.capCost, fees: [], vin: s.vin, stockNumber: null, expiresAt: lease.expiresAt, mustHaveAcknowledgement: true, notes: lease.notes, lease });
    dealers.push({ dealer: d.name, inviteId: invite.id, quoted: true, monthly: lease.monthlyPaymentPreTax, das: lease.dueAtSigning });
  }
  out.push({ rfqId: rfq.id, ref, kind: s.label, dealers, open: `https://www.trimscout.com/rfq/${rfq.id}` });
}
console.log(JSON.stringify({ buyerUserId, requests: out }, null, 1));
