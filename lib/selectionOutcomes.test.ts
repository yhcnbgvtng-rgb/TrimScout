// Every selected vehicle ends in a durable, explained outcome (request #62 follow-up).
// Fixtures and a fake box only: no network (blockLiveHttp), no production data, no real email.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import type { RfqInvite, RfqRequest } from "./rfq";
import { createSelectionInvites, withRequestLock, type SelectionChoice, type SelectionDeps } from "./selectionInvites";
import { resolveAdminInviteDesk, inviteVehicleFor } from "./inviteDesk";
import { sendQueuedInvite } from "./inviteOutbox";
import {
  coerceSelectionOutcomes,
  deliveryLine,
  hasUnexplainedGap,
  isPartial,
  scrubDiagnostic,
  selectionApplies,
  summarizeRows,
  summaryHeadline,
  vehicleRows,
  type SelectionOutcome,
} from "./selectionOutcomes";
import { planSelectionPreview, type PreviewVehicle } from "./selectionPreview";
import type { DealerDesk } from "./quotePackage";

const paste = (vin: string, dealerName: string | null, state = "NJ", trim = "LT") => ({ vin, year: 2026, make: "Chevrolet", model: "Tahoe", trim, dealerName, dealerState: dealerName ? state : null, vdpUrl: null, buildConfidence: "dealer_listing_only", condition: "new" });
const V1 = "1GNS6MKD2TR280381";
const V2 = "1GNS6NKD5TR434507";
const V3 = "1GNS6PKD1TR111222";

function buildRfq(pastes: ReturnType<typeof paste>[], over: Partial<RfqRequest> = {}): RfqRequest {
  return {
    id: "62", buyerUserId: "u1", invites: [], status: "collecting", pickedQuoteId: null, createdAt: "2026-11-04T12:00:00Z",
    vin: pastes[0].vin, stockNumber: null, vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LT",
    mustHaves: [], packageKind: "links", linkPastes: pastes, approvalStatus: "pending", ...over,
  } as unknown as RfqRequest;
}

/** A tiny stand-in for the box: stores invites, 409s a second open invite to the same address, reuses a dealership's live invite. */
function fakeBox(initial: RfqRequest, opts: { failFor?: string[]; typedEmail?: Record<string, string> } = {}) {
  const box = { rfq: initial, queueCalls: [] as Array<{ dealerName: string; vin: string }>, seq: 100 };
  const deps: SelectionDeps = {
    // The REAL desk rules (opt-out, sister store by dealer-group domain); only the directory is a fixture.
    resolveDesk: (rfq, input) => resolveAdminInviteDesk(rfq, { ...input, providedEmail: opts.typedEmail?.[input.dealerName] ?? input.providedEmail }, []),
    queue: async (rfq, dealerName, desk: DealerDesk | null, vin) => {
      box.queueCalls.push({ dealerName, vin });
      if (opts.failFor?.includes(dealerName)) throw new Error("ECONNRESET to 10.0.0.5 for jane.doe@example.com");
      const email = desk?.email || null;
      if (email && box.rfq.invites.some((i) => i.status === "invited" && i.dealerContactEmail === email)) {
        return { ok: false as const, code: "desk_already_invited" as const, error: "x", status: 409 };
      }
      const live = box.rfq.invites.find((i) => i.dealerName.toLowerCase() === dealerName.toLowerCase() && i.status !== "declined");
      if (live) return { ok: true as const, invite: live };
      const invite = { id: String(++box.seq), dealerName, dealerContactEmail: email, status: "invited", deliveryStatus: "queued", viewToken: "tok", vehicle: inviteVehicleFor(rfq, dealerName, vin), desk: desk ? { contactName: desk.contactName, role: desk.role, emailMasked: "x", source: desk.source } : null, quote: null } as unknown as RfqInvite;
      box.rfq = { ...box.rfq, invites: [...box.rfq.invites, invite] };
      return { ok: true as const, invite };
    },
    deskCapAllows: () => true,
    maxInvites: null,
    now: () => "2026-11-04T12:00:00Z",
  };
  return { box, deps };
}
const tick = (...vins: string[]): SelectionChoice[] => vins.map((vin) => ({ vin, checked: true }));

async function run(pastes: ReturnType<typeof paste>[], choices: SelectionChoice[], opts: Parameters<typeof fakeBox>[1] = {}) {
  const { box, deps } = fakeBox(buildRfq(pastes), opts);
  const result = await createSelectionInvites(box.rfq, choices, deps);
  const stored = buildRfq(pastes, { invites: box.rfq.invites, selectionOutcomes: JSON.parse(JSON.stringify(result.outcomes)) });
  return { box, result, stored };
}

const codes = (o: SelectionOutcome[]) => o.map((x) => x.code ?? "invited");

describe("every selected vehicle gets an outcome", () => {
  it("three distinct dealers: three invitations, each linked to its own vehicle", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Schumacher Chevrolet", "NJ"), paste(V3, "Bayway Chevrolet", "NJ")];
    const { result, stored, box } = await run(pastes, tick(V1, V2, V3), { typedEmail: { "Scott Chevrolet": "a.one@scott.example", "Schumacher Chevrolet": "b.two@schumacher.example", "Bayway Chevrolet": "c.three@bayway.example" } });
    assert.deepEqual(codes(result.outcomes), ["invited", "invited", "invited"]);
    const rows = vehicleRows(stored);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.inviteId), box.rfq.invites.map((i) => i.id));
    assert.deepEqual(box.rfq.invites.map((i) => i.vehicle?.vin), [V1, V2, V3], "each invitation carries its own vehicle");
    assert.equal(summaryHeadline(summarizeRows(rows)), "3 vehicles saved · 3 invitations created");
    assert.equal(isPartial(summarizeRows(rows)), false);
  });

  it("several vehicles at one dealership: one invitation, the others excluded with a reason, and the invitation carries the right car", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Scott Chevrolet", "PA", "LS"), paste(V3, "Bayway Chevrolet", "NJ")];
    const { result, stored, box } = await run(pastes, tick(V1, V2, V3), { typedEmail: { "Scott Chevrolet": "a.one@scott.example", "Bayway Chevrolet": "c.three@bayway.example" } });
    assert.deepEqual(codes(result.outcomes), ["invited", "same_dealer_other_vehicle", "invited"]);
    assert.equal(box.rfq.invites.length, 2, "never a second invitation to the same dealership");
    assert.equal(box.rfq.invites[0].vehicle?.vin, V1);
    const rows = vehicleRows(stored);
    assert.equal(rows[1].status, "excluded");
    assert.match(rows[1].reason, /already has an invitation for another vehicle/);
    assert.equal(summaryHeadline(summarizeRows(rows)), "3 vehicles saved · 2 invitations created · 1 blocked");
  });

  it("the invitation carries the vehicle that was meant, not just the first car at that dealership", () => {
    const rfq = buildRfq([paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Scott Chevrolet", "PA", "LS")]);
    assert.equal(inviteVehicleFor(rfq, "Scott Chevrolet", V2).vin, V2);
    assert.equal(inviteVehicleFor(rfq, "Scott Chevrolet").vin, V1, "name-only callers keep the old behavior");
  });

  it("shared dealer-group domain: the second store is excluded as a sister store, the first stays", async () => {
    const pastes = [paste(V1, "Group Chevrolet North"), paste(V2, "Group Chevrolet South"), paste(V3, "Independent Chevrolet")];
    const { result, stored } = await run(pastes, tick(V1, V2, V3), { typedEmail: { "Group Chevrolet North": "n.sales@lithiagroup.example", "Group Chevrolet South": "s.sales@lithiagroup.example", "Independent Chevrolet": "i.sales@indie.example" } });
    assert.deepEqual(codes(result.outcomes), ["invited", "sister_store", "invited"]);
    assert.match(vehicleRows(stored)[1].reason, /Same dealer group/);
  });

  it("shared mailbox: the box refuses a second open invite to the same desk and the vehicle says so", async () => {
    const pastes = [paste(V1, "Alpha Chevrolet"), paste(V2, "Beta Chevrolet")];
    const { result, stored } = await run(pastes, tick(V1, V2), { typedEmail: { "Alpha Chevrolet": "desk@alpha.example", "Beta Chevrolet": "desk@alpha.example" } });
    // Different dealership names but the same address: the first is invited, the second is held back (sister domain or open desk).
    assert.equal(result.outcomes[0].status, "invited");
    assert.equal(result.outcomes[1].status, "excluded");
    assert.ok(["sister_store", "desk_already_invited"].includes(result.outcomes[1].code!), String(result.outcomes[1].code));
    assert.equal(vehicleRows(stored).length, 2);
  });

  it("an open request to the same desk from another package comes back as desk_already_invited", async () => {
    const { box, deps } = fakeBox(buildRfq([paste(V1, "Alpha Chevrolet")]), { typedEmail: { "Alpha Chevrolet": "p.person@alpha.example" } });
    box.rfq = { ...box.rfq, invites: [{ id: "9", dealerName: "Other Package Alpha", dealerContactEmail: "p.person@alpha.example", status: "invited" } as unknown as RfqInvite] };
    // The other package's invite is a different dealership name on this rfq copy, so only the box-level 409 can catch it.
    const r = await createSelectionInvites({ ...box.rfq, invites: [] }, tick(V1), deps);
    assert.equal(r.outcomes[0].code, "desk_already_invited");
  });

  it("an unchecked dealership is recorded as unchecked, not dropped", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Bayway Chevrolet")];
    const { result, stored } = await run(pastes, [{ vin: V1, checked: true }, { vin: V2, checked: false }], { typedEmail: { "Scott Chevrolet": "a.one@scott.example" } });
    assert.deepEqual(codes(result.outcomes), ["invited", "dealer_unchecked"]);
    assert.match(vehicleRows(stored)[1].reason, /unticked/);
  });

  it("an ineligible vehicle (no dealership on the listing) is excluded with its reason", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA"), paste(V2, null)];
    const { result } = await run(pastes, tick(V1, V2), { typedEmail: { "Scott Chevrolet": "a.one@scott.example" } });
    assert.deepEqual(codes(result.outcomes), ["invited", "ineligible_vehicle"]);
  });

  it("a vehicle the browser never mentioned is recorded as not attempted", async () => {
    const { result } = await run([paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Bayway Chevrolet")], tick(V1), { typedEmail: { "Scott Chevrolet": "a.one@scott.example" } });
    assert.deepEqual(codes(result.outcomes), ["invited", "not_attempted"]);
  });

  it("partial invitation-creation failure: the rest are still handled, the failure is recorded, and no address or error text leaks", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Schumacher Chevrolet"), paste(V3, "Bayway Chevrolet")];
    const { result, stored } = await run(pastes, tick(V1, V2, V3), { failFor: ["Schumacher Chevrolet"], typedEmail: { "Scott Chevrolet": "a.one@scott.example", "Schumacher Chevrolet": "b.two@schumacher.example", "Bayway Chevrolet": "c.three@bayway.example" } });
    assert.deepEqual(codes(result.outcomes), ["invited", "invite_creation_failed", "invited"]);
    const summary = summarizeRows(vehicleRows(stored));
    assert.equal(summaryHeadline(summary), "3 vehicles saved · 2 invitations created · 1 blocked");
    assert.equal(isPartial(summary), true, "a failure never looks like complete success");
    const blob = JSON.stringify([result.outcomes, vehicleRows(stored).map((r) => r.reason)]);
    assert.doesNotMatch(blob, /@|ECONNRESET|10\.0\.0\.5/);
  });

  it("queued vs sent: creating an invitation is not delivering it; a failed send leaves it queued and visible", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA")];
    const { stored, box } = await run(pastes, tick(V1), { typedEmail: { "Scott Chevrolet": "a.one@scott.example" } });
    let s = summarizeRows(vehicleRows(stored));
    assert.equal(s.invitations, 1);
    assert.equal(s.queued, 1);
    assert.equal(s.sent, 0);
    assert.match(deliveryLine(s), /1 queued · 0 quotes received/);
    // Request not released yet: the outbox holds it, nothing is sent.
    const sent: string[] = [];
    const deps = { directory: [], send: async (subject: string) => { sent.push(subject); return false; }, mark: (async () => {}) as never, emailEnabled: () => true };
    assert.equal(await sendQueuedInvite(stored, box.rfq.invites[0], deps), "held_for_approval");
    // Released, but the provider fails: still queued, never reported as sent.
    const released = { ...stored, approvalStatus: "approved" } as RfqRequest;
    assert.equal(await sendQueuedInvite(released, released.invites[0], deps), "failed");
    s = summarizeRows(vehicleRows(released));
    assert.deepEqual([s.queued, s.sent, s.quoted], [1, 0, 0]);
    // Sent and then answered are separate facts too.
    const answered = { ...released, invites: [{ ...released.invites[0], deliveryStatus: "sent", status: "quoted", quote: { id: "q", inviteId: released.invites[0].id, dealerName: "Scott Chevrolet", price: 50000, totalOtdPrice: 54000, fees: [], vin: V1 } }] } as unknown as RfqRequest;
    s = summarizeRows(vehicleRows(answered));
    assert.deepEqual([s.queued, s.sent, s.quoted], [0, 0, 1]);
  });
});

describe("repeat submissions are idempotent", () => {
  it("a retry after success links the same invitations; nothing is created twice", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Bayway Chevrolet")];
    const { box, deps } = fakeBox(buildRfq(pastes), { typedEmail: { "Scott Chevrolet": "a.one@scott.example", "Bayway Chevrolet": "c.three@bayway.example" } });
    const first = await createSelectionInvites(box.rfq, tick(V1, V2), deps);
    const again = await createSelectionInvites(box.rfq, tick(V1, V2), deps);
    assert.equal(box.rfq.invites.length, 2);
    assert.equal(first.created.length, 2);
    assert.equal(again.created.length, 0);
    assert.deepEqual(again.outcomes.map((o) => [o.status, o.reused]), [["invited", true], ["invited", true]]);
    assert.deepEqual(again.outcomes.map((o) => o.inviteId), first.outcomes.map((o) => o.inviteId));
  });

  it("a double click (two concurrent submissions) still produces one invitation per dealership", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Bayway Chevrolet")];
    const { box, deps } = fakeBox(buildRfq(pastes), { typedEmail: { "Scott Chevrolet": "a.one@scott.example", "Bayway Chevrolet": "c.three@bayway.example" } });
    const submit = () => withRequestLock("62", async () => createSelectionInvites(box.rfq, tick(V1, V2), deps));
    const [a, b] = await Promise.all([submit(), submit()]);
    assert.equal(box.rfq.invites.length, 2);
    assert.equal(a.created.length + b.created.length, 2);
    assert.equal(box.queueCalls.length, 2, "the second submission never even asked the box to create anything");
  });

  it("a retry after a failure re-attempts only the failed vehicle", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Bayway Chevrolet")];
    const failing = fakeBox(buildRfq(pastes), { failFor: ["Bayway Chevrolet"], typedEmail: { "Scott Chevrolet": "a.one@scott.example", "Bayway Chevrolet": "c.three@bayway.example" } });
    const first = await createSelectionInvites(failing.box.rfq, tick(V1, V2), failing.deps);
    assert.deepEqual(codes(first.outcomes), ["invited", "invite_creation_failed"]);
    const healed = fakeBox(failing.box.rfq, { typedEmail: { "Bayway Chevrolet": "c.three@bayway.example" } });
    const second = await createSelectionInvites(failing.box.rfq, tick(V1, V2), healed.deps);
    assert.deepEqual(codes(second.outcomes), ["invited", "invited"]);
    assert.equal(healed.box.queueCalls.length, 1);
    assert.equal(second.created.length, 1);
  });
});

describe("accounted for, and still visible after a reload", () => {
  it("rows equal saved selections and every row has a status and (when not invited) a coded reason", async () => {
    const pastes = [paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Scott Chevrolet", "PA", "LS"), paste(V3, null)];
    const { stored } = await run(pastes, tick(V1, V2, V3), { typedEmail: { "Scott Chevrolet": "a.one@scott.example" } });
    // "Reload": everything goes through JSON and the defensive coercion, as the box round trip does.
    const reloaded = JSON.parse(JSON.stringify(stored)) as RfqRequest;
    const rows = vehicleRows(reloaded);
    assert.equal(rows.length, (reloaded.linkPastes || []).length);
    assert.deepEqual(rows.map((r) => r.vehicle.vin), [V1, V2, V3]);
    for (const r of rows) assert.ok(r.status !== "unrecorded", `${r.vehicle.vin} must have an outcome`);
    assert.ok(rows.filter((r) => r.status === "excluded").every((r) => r.code && r.reason));
    assert.equal(hasUnexplainedGap(rows), false);
  });

  it("exact build and alternates stay separate, and each quote belongs to its own vehicle", () => {
    const inv = (id: string, vin: string, dealerName: string, otd?: number) =>
      ({ id, dealerName, status: otd ? "quoted" : "invited", deliveryStatus: "sent", vehicle: { vin, year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LT", vdpUrl: null }, quote: otd ? { id: `q${id}`, inviteId: id, dealerName, price: otd - 4000, totalOtdPrice: otd, fees: [], vin } : null }) as unknown as RfqInvite;
    const rfq = buildRfq([paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Bayway Chevrolet"), paste(V3, "Third Chevrolet")], { invites: [inv("1", V1, "Scott Chevrolet", 54000), inv("2", V2, "Bayway Chevrolet", 51000), inv("3", V3, "Third Chevrolet")] });
    const rows = vehicleRows(rfq);
    assert.deepEqual(rows.map((r) => r.role), ["exact", "alternate", "alternate"]);
    assert.equal(rows[0].quote?.totalOtdPrice, 54000);
    assert.equal(rows[1].quote?.totalOtdPrice, 51000, "the alternate's quote is its own, not folded into the exact build");
    assert.equal(rows[2].quote, null, "a vehicle without a quote stays listed");
  });

  it("an older request with no recorded reasons says 'Reason unavailable' and invents nothing", () => {
    const rfq = buildRfq([paste(V1, "Scott Chevrolet", "PA"), paste(V2, "Bayway Chevrolet"), paste(V3, "Third Chevrolet")], {
      invites: [{ id: "1", dealerName: "Scott Chevrolet", status: "invited", deliveryStatus: "sent", quote: null } as unknown as RfqInvite],
    });
    const rows = vehicleRows(rfq);
    assert.equal(rows[0].status, "sent", "an older invite with no vehicle still links by dealership name");
    assert.deepEqual(rows.slice(1).map((r) => [r.status, r.code, r.reason]), [["unrecorded", "reason_unavailable", "Reason unavailable"], ["unrecorded", "reason_unavailable", "Reason unavailable"]]);
    assert.equal(hasUnexplainedGap(rows), true);
    assert.equal(summaryHeadline(summarizeRows(rows)), "3 vehicles saved · 1 invitation created · 2 with no invitation on record");
  });

  it("selection outcomes only apply to pasted-vehicle packages", () => {
    assert.equal(selectionApplies(buildRfq([paste(V1, "A")])), true);
    assert.equal(selectionApplies({ ...buildRfq([paste(V1, "A")]), packageKind: "match" } as RfqRequest), false);
    assert.equal(selectionApplies({ ...buildRfq([paste(V1, "A")]), lane: "alternate" } as RfqRequest), false);
  });
});

describe("no addresses or tokens in what a buyer can see", () => {
  it("stored outcomes are re-derived from the code, so free text (an address) in a stored row is dropped", () => {
    const dirty = [{ vin: V1, status: "excluded", code: "invite_creation_failed", message: "failed for jane@x.com token abcdefghijklmnopqrstuvwxyz0123456789", dealerName: "A", dealerState: "NJ", inviteId: null, recordedAt: "t" }, { vin: V2, status: "excluded", code: "made_up_code" }, { nope: true }];
    const out = coerceSelectionOutcomes(dirty);
    assert.equal(out.length, 1);
    assert.doesNotMatch(JSON.stringify(out), /@|abcdefghijkl/);
    assert.equal(out[0].message, "We couldn't create the invitation for this vehicle because of a service error. Nothing was sent to the dealership.");
  });
  it("scrubDiagnostic removes addresses and token-like strings", () => {
    assert.equal(scrubDiagnostic("send to jane.doe@dealer.com now"), "send to [email removed] now");
    assert.match(scrubDiagnostic("t=abcdefghijklmnopqrstuvwxyz0123456789ABCD"), /\[token removed\]/);
  });
});

describe("pre-submit review", () => {
  const pv = (over: Partial<PreviewVehicle> & { vin: string }): PreviewVehicle => ({ title: "2026 Chevrolet Tahoe LT", dealerName: "Scott Chevrolet", dealerState: "PA", deskKey: "k:scott", checked: true, optedOut: false, adviserAdded: false, emailMasked: null, ...over });
  it("shows every vehicle with a verdict, and separates what is known now from what only completes on submit", () => {
    const rows = planSelectionPreview([
      pv({ vin: V1 }),
      pv({ vin: V2, dealerName: "Bayway Chevrolet", deskKey: "k:bayway", checked: false }),
      pv({ vin: V3, dealerName: null, deskKey: null }),
    ]);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => [r.verdict, r.code]), [["will_invite", null], ["restricted", "dealer_unchecked"], ["restricted", "ineligible_vehicle"]]);
    assert.equal(rows[0].certainty, "on_submit", "an invitation that will be attempted is still subject to submit-time checks");
    assert.ok(rows.slice(1).every((r) => r.certainty === "known" && r.reason));
    assert.equal(rows[1].resolvable, true);
  });
  it("a second car at the same dealership and a dealer-group domain already in use are known restrictions", () => {
    const rows = planSelectionPreview([
      pv({ vin: V1, deskKey: "k:a", dealerName: "North", emailMasked: "n•••••@lithiagroup.example" }),
      pv({ vin: V2, deskKey: "k:a", dealerName: "North" }),
      pv({ vin: V3, deskKey: "k:b", dealerName: "South", emailMasked: "s•••••@lithiagroup.example" }),
    ]);
    assert.deepEqual(rows.map((r) => r.code), [null, "same_dealer_other_vehicle", "sister_store"]);
  });
  it("an opted-out dealership is restricted unless the buyer's own adviser takes the request", () => {
    assert.equal(planSelectionPreview([pv({ vin: V1, optedOut: true })])[0].code, "dealer_opted_out");
    assert.equal(planSelectionPreview([pv({ vin: V1, optedOut: true, adviserAdded: true })])[0].verdict, "will_invite");
  });
});

describe("reading never sends", () => {
  const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  it("the deal read, the tracker, the diagnostic route and the outcome modules never touch the outbox or the mailer", () => {
    for (const file of ["app/api/rfqs/[id]/route.ts", "app/api/admin/rfqs/[id]/selections/route.ts", "lib/selectionOutcomes.ts", "lib/selectionPreview.ts", "components/SelectionOutcomes.tsx", "components/DealTrackerDashboard.tsx", "app/rfq/[id]/page.tsx"]) {
      const src = read(file);
      assert.doesNotMatch(src, /drainQueuedInvites|sendQueuedInvite|sendQuoteInviteEmail|inviteOutbox/, file);
    }
    assert.doesNotMatch(read("app/api/admin/rfqs/[id]/selections/route.ts"), /export async function (POST|PUT|PATCH|DELETE)/);
  });
  it("the invitation step creates queued invitations only; it does not import the outbox either", () => {
    for (const file of ["app/api/rfqs/[id]/selection-invites/route.ts", "lib/selectionInvites.ts"]) assert.doesNotMatch(read(file), /drainQueuedInvites|sendQueuedInvite|sendQuoteInviteEmail|inviteOutbox/, file);
  });
  it("sending queued invitations is an explicit admin POST that goes through the gated outbox", () => {
    const route = read("app/api/admin/rfqs/[id]/send-queued/route.ts");
    assert.match(route, /requireAdminSession/);
    assert.match(route, /export async function POST/);
    assert.doesNotMatch(route, /export async function GET/);
    assert.match(route, /drainQueuedInvites\(\[rfq\]\)/);
  });
  it("the release still drains through the outbox", () => {
    assert.match(read("app/api/admin/rfqs/[id]/approval/route.ts"), /drainQueuedInvites\(\[fresh\]\)/);
  });
});

describe("the wizard", () => {
  const wizard = fs.readFileSync(new URL("../components/BiddingWizard.tsx", import.meta.url), "utf8");
  it("settles the whole selection in one server call instead of a browser loop, and a partial result stays on screen", () => {
    assert.match(wizard, /\/api\/rfqs\/\$\{rfqId\}\/selection-invites/);
    assert.doesNotMatch(wizard, /\/api\/rfqs\/\$\{rfqId\}\/invites`/);
    assert.match(wizard, /fullSuccess/);
    assert.match(wizard, /<SelectionPreview rows=\{selectionPreviewRows\}/);
  });
  it("gives each distinct desk its own row (same-named stores in different states no longer merge)", () => {
    assert.match(wizard, /deskKey\(other\) === deskKey\(target\)/);
  });
});
