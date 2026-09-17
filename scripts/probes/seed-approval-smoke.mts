/**
 * Seeds smoke quote requests for the admin approval desk — one cash, one
 * finance, one lease — under a real buyer account, on real NJ rooftops from
 * our crawl, with invites queued by the same desk rules as a buyer's send
 * (lib/inviteDesk.ts) and the admin alert email sent for each (SAFE MODE:
 * it lands in the safe-mode inbox). Nothing goes to a dealer: every request
 * starts "pending" on the box and the outbox refuses unreleased requests.
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/probes/seed-approval-smoke.mts <buyerUserId>
 */
import { createRfq, getRfq } from "../../lib/rfqApi";
import { queueInvite, resolveInviteDesk } from "../../lib/inviteDesk";
import { approvalAlertHtml, approvalAlertSubject } from "../../lib/approvalAlertEmail";
import { sendAdminApprovalAlert } from "../../lib/dealerEmail";
import { inviteRouting } from "../../lib/quotePackage";

const buyerUserId = process.argv[2];
if (!buyerUserId) throw new Error("pass the buyerUserId");
const now = new Date().toISOString();
const ref = (p: string) => `TS-${p}${Date.now().toString(36).slice(-5).toUpperCase()}`.slice(0, 9);

const seeds = [
  {
    label: "cash — Toyota RAV4 at Route 22 Toyota (no named contact → dealership sales desk)",
    vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE",
    dealers: [{ name: "Route 22 Toyota", state: "NJ", url: "https://www.route22toyota.com/viewdetails/new/2t36cravxtc39j403/2026-toyota-rav4-sport-utility" }],
    quotePrefs: { quoteType: "cash" as const, cash: { zip: "07405", timeline: "this_month" as const } }, leasePrefs: null,
    buyerNote: "No dealer add-ons please — happy to buy this week if the number works.", tradeInExpected: false, dealReference: ref("C"),
  },
  {
    label: "finance — Acura ADX at Key Acura of Atlantic City (factory build pending)",
    vin: "3HDSA2H70TM713712", year: 2026, make: "Acura", model: "ADX", trim: "A-Spec Advance",
    dealers: [{ name: "Key Acura of Atlantic City", state: "NJ", url: "https://www.keyacuraofatlanticcity.com/new/Acura/2026-Acura-ADX-02f345d1ac18490df7541314c9cd097e.htm" }],
    quotePrefs: { quoteType: "finance" as const, finance: { termMonths: 60, downPayment: 5000, creditBand: "excellent" as const, zip: "08234", timeline: "this_week" as const } }, leasePrefs: null,
    buyerNote: null, tradeInExpected: true, dealReference: ref("F"),
  },
  {
    label: "lease — Lexus NX 350 at Lexus of Route 10 (named contact on file) + Bob Johnson Lexus as an alternate",
    vin: "2T2HGCEZ9TC38B302", year: 2026, make: "Lexus", model: "NX", trim: "350 Luxury",
    dealers: [
      { name: "Lexus of Route 10", state: "NJ", url: "https://www.lexusofroute10.com/new-Whipanny+-2026-Lexus-NX-350+LUXURY+AWD-2T2HGCEZ9TC38B302" },
      { name: "Bob Johnson Lexus", state: "NY", url: "https://www.bobjohnsonlexus.com/new-Henrietta+NY-2026-Lexus-NX+HYBRID-NX+350h+PREMIUM+AWD-2T2GKCEZXTC39B377", vin: "2T2GKCEZXTC39B377", trim: "350h Premium" },
    ],
    quotePrefs: null, leasePrefs: { termMonths: 36 as const, milesPerYear: 12000 as const, zip: "07981", timeline: "this_month" as const, creditBand: "good" as const, dueAtSigningIntent: "first_month_only" as const },
    buyerNote: "Comparing two NX builds — quote the one you have.", tradeInExpected: false, dealReference: ref("L"),
  },
];

const out: Array<Record<string, unknown>> = [];
for (const s of seeds) {
  const rfq = await createRfq({
    buyerUserId, vin: s.vin, stockNumber: null, vehicleYear: s.year, vehicleMake: s.make, vehicleModel: s.model, vehicleTrim: s.trim,
    mustHaves: [], packageKind: "links",
    linkPastes: s.dealers.map((d) => ({ vin: d.vin || s.vin, year: s.year, make: s.make, model: s.model, trim: d.trim || s.trim, dealerName: d.name, dealerState: d.state, vdpUrl: d.url, buildConfidence: "dealer_listing_only", resolvedAt: now, condition: "new" })),
    dealReference: s.dealReference, leasePrefs: s.leasePrefs, quotePrefs: s.quotePrefs, buyerNote: s.buyerNote, tradeInExpected: s.tradeInExpected,
  });
  const invites: Array<Record<string, unknown>> = [];
  for (const d of s.dealers) {
    const fresh = (await getRfq(rfq.id))!;
    const desk = await resolveInviteDesk(fresh, { dealerName: d.name, dealerState: d.state });
    if (!desk.ok) { invites.push({ dealer: d.name, blocked: desk.code }); continue; }
    const q = await queueInvite(fresh, d.name, desk.desk);
    invites.push(q.ok ? { dealer: d.name, routing: inviteRouting(desk.desk), inviteId: q.invite.id } : { dealer: d.name, blocked: q.code });
  }
  const full = (await getRfq(rfq.id))!;
  const emailed = await sendAdminApprovalAlert(approvalAlertSubject(full), approvalAlertHtml(full)).catch(() => false);
  out.push({ rfqId: rfq.id, ref: rfq.dealReference, kind: s.label, approvalStatus: full.approvalStatus, invites, adminAlertEmailed: emailed });
}
console.log(JSON.stringify({ buyerUserId, requests: out, desk: "https://www.trimscout.com/admin/approvals" }, null, 1));
