import { createRfq, createRfqInvite, markRfqInviteDelivery } from "../../lib/rfqApi";
import { quoteInviteHtml, quoteInviteSubject } from "../../lib/quoteInviteEmail";
import { sendQuoteInviteEmail, SAFE_MODE_RECIPIENT } from "../../lib/dealerEmail";
import { DEALER_EMAIL_BASE_URL } from "../../lib/dealerUnsubscribe";
import { formatBuyerAlias } from "../../lib/buyerAlias";

const vin = "1GNS6MKD2TR280381"; // real Tahoe so the dealer page shows a real build
const rfq = await createRfq({
  buyerUserId: "smoke-dealer-2026-09-13",
  vin, stockNumber: null, vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LS",
  mustHaves: [],
  packageKind: "links",
  linkPastes: [{ vin, year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", dealerName: "Smoke Test Desk", dealerState: "NJ", vdpUrl: null, buildConfidence: "verified_factory", resolvedAt: new Date().toISOString() }],
  dealReference: "TS-TRYME2",
  leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: "this_month", maxCashDueAtSigning: 1500 },
} as any);
const invite = await createRfqInvite(rfq.id, {
  dealerName: "Smoke Test Desk",
  dealerContactEmail: "smoke.desk@example.com",
  desk: { contactName: "Sam Smoke", role: "gsm", emailMasked: "s••••@example.com", source: "directory" },
  vehicle: { vin, year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", vdpUrl: null },
} as any);
const viewUrl = `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken || "")}`;
const input = {
  dealerName: "Smoke Test Desk", contactName: "Sam Smoke", role: "gsm",
  vehicle: { vin, year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", vdpUrl: null },
  buyerAlias: formatBuyerAlias(rfq.buyerUserId), dealReference: rfq.dealReference || null, viewUrl, unsubscribeUrl: null,
  paymentLabel: "Lease", purchaseTimelineLabel: "Within the month", leasePrefs: rfq.leasePrefs, vehicleFacts: { drivetrain: "4WD", exteriorColor: "Lakeshore Blue" },
} as any;
const ok = await sendQuoteInviteEmail(quoteInviteSubject(input), quoteInviteHtml(input));
if (ok) await markRfqInviteDelivery(rfq.id, invite.id, "sent").catch(() => null);
console.log(JSON.stringify({ rfqId: rfq.id, dealReference: rfq.dealReference, inviteId: invite.id, emailAccepted: ok, sentTo: SAFE_MODE_RECIPIENT, subject: quoteInviteSubject(input) }, null, 1));
