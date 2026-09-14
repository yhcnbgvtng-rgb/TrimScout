/**
 * Throwaway CASH quote request under a real buyer's account, with two
 * dealer quotes already on it — so the buyer can open Deal Tracker and see
 * a cash compare with numbers. Nothing is emailed. Usage:
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/probes/send-throwaway-cash-buyer.mts <buyerUserId>
 */
import { createRfq, createRfqInvite, markRfqInviteDelivery, submitRfqQuote } from "../../lib/rfqApi";
import { validateUsedQuote, cashOutTheDoor, type UsedCashQuote } from "../../lib/usedQuote";

const buyerUserId = process.argv[2];
if (!buyerUserId) throw new Error("pass the buyerUserId");
const vin = "1GNS6MKD2TR280381"; // 2026 Tahoe LS — a real build on the dealer/deal pages
const stamp = Date.now().toString(36).slice(-5).toUpperCase(); // TS-C + 5 = the box's 6-char ref
const quotePrefs = { quoteType: "cash" as const, cash: { zip: "07405", timeline: "this_month" as const } };
const rfq = await createRfq({
  buyerUserId, vin, stockNumber: null, vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LS",
  mustHaves: [], packageKind: "links",
  linkPastes: [
    { vin, year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", dealerName: "Smoke Chevrolet of Butler", dealerState: "NJ", vdpUrl: null, buildConfidence: "verified_factory", resolvedAt: new Date().toISOString(), condition: "new" },
  ],
  dealReference: `TS-C${stamp}`, leasePrefs: null, quotePrefs,
} as any);

const desks = [
  { name: "Smoke Chevrolet of Butler", contact: "Dana Demo", price: 58900, tax: 3902, doc: 799, title: 420, addOns: [] as { name: string; amount: number }[], rebates: [{ name: "Bonus cash", amount: 1000 }], notes: "In stock, ready today." },
  { name: "Smoke Chevrolet of Wayne", contact: "Lee Sample", price: 58250, tax: 3859, doc: 799, title: 420, addOns: [{ name: "Nitrogen + etch", amount: 499 }], rebates: [], notes: null },
];
const out: Array<Record<string, unknown>> = [];
for (const d of desks) {
  const invite = await createRfqInvite(rfq.id, {
    dealerName: d.name, dealerContactEmail: `smoke.${stamp.toLowerCase()}.${d.name.split(" ").pop()!.toLowerCase()}@example.com`,
    desk: { contactName: d.contact, role: "sales_manager", emailMasked: `${d.contact[0].toLowerCase()}••••@example.com`, source: "directory" },
    vehicle: { vin, year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", vdpUrl: null },
  } as any);
  await markRfqInviteDelivery(rfq.id, invite.id, "sent").catch(() => null);
  await markRfqInviteDelivery(rfq.id, invite.id, "viewed").catch(() => null);
  const quote: UsedCashQuote = {
    kind: "cash", sellingPrice: d.price,
    dueAtSigning: [{ name: "Sales tax", amount: d.tax }, { name: "Doc fee", amount: d.doc }, { name: "Title & registration", amount: d.title }],
    addOns: d.addOns, noAddOns: d.addOns.length === 0, rebates: d.rebates,
    miles: null, stockNumber: `T${stamp}${d.name.length}`, cpo: false,
    expiresAt: new Date(Date.now() + 10 * 86400e3).toISOString(), notes: d.notes,
  };
  const v = validateUsedQuote(quote, quotePrefs, { vin, condition: "new" });
  if (v.errors.length) throw new Error(v.errors.join("; "));
  await submitRfqQuote(rfq.id, invite.id, { price: quote.sellingPrice, fees: quote.dueAtSigning.map((f) => ({ label: f.name, amount: f.amount })), vin, stockNumber: quote.stockNumber, expiresAt: quote.expiresAt, mustHaveAcknowledgement: true, notes: quote.notes, used: quote });
  out.push({ dealer: d.name, inviteId: invite.id, outTheDoor: cashOutTheDoor(quote) });
}
console.log(JSON.stringify({ rfqId: rfq.id, dealReference: rfq.dealReference, buyerUserId, quotes: out, open: `https://www.trimscout.com/rfq/${rfq.id}` }, null, 1));
