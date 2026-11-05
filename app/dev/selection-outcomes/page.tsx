// FIXTURES ONLY. Renders the real selection-outcome components over static sample requests so a reviewer can see
// complete success, a partial/blocked result, an older request with no recorded reasons, and the pre-submit review.
// Not linked from anywhere, no API calls, no data from any real request.
import React from "react";
import { SelectionOutcomes } from "../../../components/SelectionOutcomes";
import { SelectionPreview } from "../../../components/SelectionPreview";
import { vehicleRows, type SelectionOutcome } from "../../../lib/selectionOutcomes";
import { planSelectionPreview } from "../../../lib/selectionPreview";
import type { RfqInvite, RfqRequest } from "../../../lib/rfq";

const V = ["1GNS6MKD2TR280381", "1GNS6NKD5TR434507", "1GNS6PKD1TR111222"];
const paste = (vin: string, dealerName: string | null, state: string, trim: string) => ({ vin, year: 2026, make: "Chevrolet", model: "Tahoe", trim, dealerName, dealerState: dealerName ? state : null, vdpUrl: null, buildConfidence: "dealer_listing_only", condition: "new" });
const pastes = [paste(V[0], "Scott Chevrolet", "PA", "LT"), paste(V[1], "Schumacher Chevrolet of Denville", "NJ", "LS"), paste(V[2], "Bayway Chevrolet", "NJ", "Z71")];
const base = { id: "900", buyerUserId: "u", status: "collecting", pickedQuoteId: null, createdAt: "2026-11-05T12:00:00Z", vin: V[0], stockNumber: null, vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LT", mustHaves: [], packageKind: "links", linkPastes: pastes } as unknown as RfqRequest;
const inv = (id: string, vin: string, dealerName: string, extra: Record<string, unknown> = {}) =>
  ({ id, dealerName, status: "invited", deliveryStatus: "queued", vehicle: { vin, year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LT", vdpUrl: null }, quote: null, ...extra }) as unknown as RfqInvite;
const at = "2026-11-05T12:00:00Z";
const out = (vin: string, dealerName: string, over: Partial<SelectionOutcome>): SelectionOutcome => ({ vin, dealerName, dealerState: "NJ", status: "excluded", code: null, message: "", inviteId: null, recordedAt: at, ...over });

const success: RfqRequest = {
  ...base,
  invites: [
    inv("1", V[0], "Scott Chevrolet", { deliveryStatus: "sent" }),
    inv("2", V[1], "Schumacher Chevrolet of Denville", { status: "quoted", deliveryStatus: "sent", quote: { id: "q2", inviteId: "2", dealerName: "Schumacher Chevrolet of Denville", price: 51200, totalOtdPrice: 55480, fees: [], vin: V[1] } }),
    inv("3", V[2], "Bayway Chevrolet"),
  ],
  selectionOutcomes: pastes.map((p, i) => out(p.vin, p.dealerName!, { status: "invited", inviteId: String(i + 1) })),
};
const partial: RfqRequest = {
  ...base,
  invites: [inv("1", V[0], "Scott Chevrolet")],
  selectionOutcomes: [
    out(V[0], "Scott Chevrolet", { status: "invited", inviteId: "1" }),
    out(V[1], "Schumacher Chevrolet of Denville", { code: "sister_store" }),
    out(V[2], "Bayway Chevrolet", { code: "invite_creation_failed" }),
  ].map((o) => ({ ...o, message: o.status === "excluded" ? "x" : "" })),
};
const older: RfqRequest = { ...base, invites: [inv("1", V[0], "Scott Chevrolet", { deliveryStatus: "sent" })] };

const preview = planSelectionPreview([
  { vin: V[0], title: "2026 Chevrolet Tahoe LT", dealerName: "Scott Chevrolet", dealerState: "PA", deskKey: "a", checked: true, optedOut: false, adviserAdded: false, emailMasked: "s•••••@scottcars.example" },
  { vin: V[1], title: "2026 Chevrolet Tahoe LS", dealerName: "Schumacher Chevrolet of Denville", dealerState: "NJ", deskKey: "b", checked: false, optedOut: false, adviserAdded: false, emailMasked: null },
  { vin: V[2], title: "2026 Chevrolet Tahoe Z71", dealerName: "Scott Chevrolet", dealerState: "PA", deskKey: "a", checked: true, optedOut: false, adviserAdded: false, emailMasked: null },
]);

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 sm:p-8">
      <section className="space-y-2" data-testid="fixture-success">
        <h2 className="text-sm font-bold text-ink-faint">Complete success (tracker view)</h2>
        <SelectionOutcomes rows={vehicleRows(success)} />
      </section>
      <section className="space-y-2" data-testid="fixture-partial">
        <h2 className="text-sm font-bold text-ink-faint">Partial / blocked (buyer results and admin diagnostic)</h2>
        <SelectionOutcomes rows={vehicleRows(partial)} title="What happened to each vehicle" showCodes />
      </section>
      <section className="space-y-2" data-testid="fixture-older">
        <h2 className="text-sm font-bold text-ink-faint">Older request, no recorded reasons</h2>
        <SelectionOutcomes rows={vehicleRows(older)} />
      </section>
      <section className="space-y-2" data-testid="fixture-preview">
        <h2 className="text-sm font-bold text-ink-faint">Before submitting</h2>
        <SelectionPreview rows={preview} />
      </section>
    </main>
  );
}
