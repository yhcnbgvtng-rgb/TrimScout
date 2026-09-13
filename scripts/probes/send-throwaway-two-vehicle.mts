// Throwaway lease request with TWO vehicles at two desks, for dealer-side
// testing. Smoke buyer id; real GM VINs so the dealer pages show real builds.
import { createRfq, createRfqInvite } from "../../lib/rfqApi";

const cars = [
  { vin: "1GNS6MKD2TR280381", year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", dealerName: "Smoke Desk A (Scott)", state: "PA", contact: "Ava Smoke" },
  { vin: "1GNS6NKD5TR434507", year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LT", dealerName: "Smoke Desk B (Schumacher)", state: "NJ", contact: "Ben Smoke" },
];
const rfq = await createRfq({
  buyerUserId: "smoke-dealer-2026-09-13",
  vin: cars[0].vin, stockNumber: null, vehicleYear: cars[0].year, vehicleMake: cars[0].make, vehicleModel: cars[0].model, vehicleTrim: cars[0].trim,
  mustHaves: [], packageKind: "links",
  linkPastes: cars.map((c) => ({ vin: c.vin, year: c.year, make: c.make, model: c.model, trim: c.trim, dealerName: c.dealerName, dealerState: c.state, vdpUrl: null, buildConfidence: "verified_factory", resolvedAt: new Date().toISOString() })),
  dealReference: "TS-TRYME3",
  leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: "this_month" },
} as any);
const links: string[] = [];
for (const c of cars) {
  const invite = await createRfqInvite(rfq.id, {
    dealerName: c.dealerName, dealerContactEmail: `${c.contact.split(" ")[0].toLowerCase()}@example.com`,
    desk: { contactName: c.contact, role: "gsm", emailMasked: `${c.contact[0].toLowerCase()}••••@example.com`, source: "directory" },
    vehicle: { vin: c.vin, year: c.year, make: c.make, model: c.model, trim: c.trim, vdpUrl: null },
  } as any);
  links.push(`${c.dealerName} — ${c.year} ${c.make} ${c.model} ${c.trim} (${c.vin})\n  https://www.trimscout.com/api/quote-invite/view?t=${invite.viewToken}`);
}
console.log(`rfq #${rfq.id} ${rfq.dealReference}\n` + links.join("\n"));
