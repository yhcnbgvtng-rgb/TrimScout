/**
 * Throwaway NEW-CAR CASH quote request → one dealer invite → the real
 * dealer email. SAFE MODE in lib/dealerEmail.ts routes the send to
 * pausmi@outlook.com; nothing reaches a dealer. Needs RESEND_API_KEY +
 * LIGHTSAIL_API_KEY in the environment (local .env.local has no Resend key):
 *
 *   vercel env pull .env.production.local --environment=production --yes
 *   set -a; . ./.env.production.local; set +a; npx tsx scripts/probes/send-throwaway-cash-invite.mts
 */
import { createRfq, createRfqInvite, markRfqInviteDelivery } from "../../lib/rfqApi";
import { quoteInviteHtml, quoteInviteSubject } from "../../lib/quoteInviteEmail";
import { sendQuoteInviteEmail, SAFE_MODE_RECIPIENT } from "../../lib/dealerEmail";
import { DEALER_EMAIL_BASE_URL } from "../../lib/dealerUnsubscribe";
import { formatBuyerAlias } from "../../lib/buyerAlias";

const vin = "3GNAXPEG1VL131423"; // the user's own Equinox VIN — a real build on the dealer page
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const rfq = await createRfq({
  buyerUserId: `smoke-cash-${new Date().toISOString().slice(0, 10)}`,
  vin, stockNumber: null, vehicleYear: 2027, vehicleMake: "Chevrolet", vehicleModel: "Equinox", vehicleTrim: "2LT",
  mustHaves: [],
  packageKind: "links",
  linkPastes: [{ vin, year: 2027, make: "Chevrolet", model: "Equinox", trim: "2LT", dealerName: "Smoke Cash Desk", dealerState: "NJ", vdpUrl: null, buildConfidence: "verified_factory", resolvedAt: new Date().toISOString() }],
  dealReference: `TS-CASH${stamp}`,
  leasePrefs: null,
} as any);
const invite = await createRfqInvite(rfq.id, {
  dealerName: "Smoke Cash Desk",
  dealerContactEmail: `smoke.cash.${stamp.toLowerCase()}@example.com`,
  desk: { contactName: "Sam Smoke", role: "gsm", emailMasked: "s••••@example.com", source: "directory" },
  vehicle: { vin, year: 2027, make: "Chevrolet", model: "Equinox", trim: "2LT", vdpUrl: null },
} as any);
const viewUrl = `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken || "")}`;
const input = {
  dealerName: "Smoke Cash Desk", contactName: "Sam Smoke", role: "gsm",
  vehicle: { vin, year: 2027, make: "Chevrolet", model: "Equinox", trim: "2LT", vdpUrl: null },
  buyerAlias: formatBuyerAlias(rfq.buyerUserId), dealReference: rfq.dealReference || null, viewUrl, unsubscribeUrl: null,
  quoteType: "cash", rooftop: { city: "Little Falls", state: "NJ", address: null }, buyerZip: "07405", purchaseTimelineLabel: "Within the month", leasePrefs: null, vehicleFacts: { drivetrain: "AWD", exteriorColor: "Sterling Gray Metallic" },
} as any;
const ok = await sendQuoteInviteEmail(quoteInviteSubject(input), quoteInviteHtml(input));
if (ok) await markRfqInviteDelivery(rfq.id, invite.id, "sent").catch(() => null);
console.log(JSON.stringify({ rfqId: rfq.id, dealReference: rfq.dealReference, inviteId: invite.id, emailAccepted: ok, sentTo: SAFE_MODE_RECIPIENT, subject: quoteInviteSubject(input) }, null, 1));
