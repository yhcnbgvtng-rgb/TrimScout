import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planDeskSelection, type SelectionDesk } from "./deskSelection";

// Step 3 · "Request a quote from this dealership". The P0 that shipped twice:
// NJ buyer (ZIP 07405), Scott Chevrolet in Allentown PA is the only desk,
// named contact on file. It must be ticked and Continue live on entry —
// no ZIP change, no "Include dealerships in other states" click.
const named = { knownNamed: true, blockedReason: null };
// A known rooftop with no named person: the request goes to its sales desk (shared inbox or the ops queue).
const generic = { knownNamed: false, blockedReason: null, routing: "rooftop_inbox" as const };
const unassigned = { knownNamed: false, blockedReason: null, routing: "unassigned" as const };
const scott: SelectionDesk = { dealerName: "Scott Chevrolet", state: "PA", desk: named };
const healey: SelectionDesk = { dealerName: "Healey Chevrolet, INC.", state: "NY", desk: named };
const malouf: SelectionDesk = { dealerName: "Malouf Chevrolet", state: "NJ", desk: named };

const nj = (desks: SelectionDesk[], extra: Partial<Parameters<typeof planDeskSelection>[0]> = {}) =>
  planDeskSelection({ buyerState: "NJ", sameStateOnly: true, primaryDealerName: "Scott Chevrolet", desks, confirmed: {}, ...extra });

describe("planDeskSelection — primary desk outside the buyer's state", () => {
  it("regression: out-of-state primary is auto-ticked and Continue is enabled on entry", () => {
    const plan = nj([scott]);
    const row = plan.rows["Scott Chevrolet"];
    assert.equal(row.selectable, true, "checkbox must be enabled");
    assert.equal(row.checked, true, "auto-ticked without any buyer action");
    assert.equal(row.heldByState, false);
    assert.equal(row.keptOutOfState, true);
    assert.equal(plan.canContinue, true);
    assert.deepEqual(plan.sendTo, ["Scott Chevrolet"]);
    assert.equal(plan.gate.shouldOfferExpand, false, "no expand CTA needed for primary-only");
  });

  it("the auto-tick doesn't depend on the confirmed map having been seeded by the lookup", () => {
    // confirmed is empty (lookup hasn't written its defaults yet) — still ticked.
    assert.equal(nj([scott], { confirmed: {} }).rows["Scott Chevrolet"].checked, true);
    // The buyer's own untick wins.
    const plan = nj([scott], { confirmed: { "Scott Chevrolet": false } });
    assert.equal(plan.rows["Scott Chevrolet"].checked, false);
    assert.equal(plan.canContinue, false);
    // And their re-tick.
    assert.equal(nj([scott], { confirmed: { "Scott Chevrolet": true } }).canContinue, true);
  });

  it("other out-of-state desks stay held until expanded; primary is still live meanwhile", () => {
    const plan = nj([scott, healey, malouf]);
    assert.equal(plan.rows["Scott Chevrolet"].checked, true);
    assert.equal(plan.rows["Malouf Chevrolet"].checked, true);
    assert.equal(plan.rows["Healey Chevrolet, INC."].heldByState, true);
    assert.equal(plan.rows["Healey Chevrolet, INC."].selectable, false);
    assert.equal(plan.rows["Healey Chevrolet, INC."].checked, false);
    assert.deepEqual(plan.sendTo, ["Scott Chevrolet", "Malouf Chevrolet"]);
    assert.equal(plan.canContinue, true);
    assert.equal(plan.gate.shouldOfferExpand, true);
  });

  it("one expand action (same-state off) enables AND ticks the held desks — no second click", () => {
    const plan = nj([scott, healey], { sameStateOnly: false });
    assert.equal(plan.rows["Healey Chevrolet, INC."].selectable, true);
    assert.equal(plan.rows["Healey Chevrolet, INC."].checked, true);
    assert.equal(plan.rows["Scott Chevrolet"].keptOutOfState, false, "nothing to keep once the gate is off");
    assert.deepEqual(plan.sendTo, ["Scott Chevrolet", "Healey Chevrolet, INC."]);
  });

  // Live QA (2026-09-16): a VDP link attached the right rooftop, the directory had no named
  // person, and Continue sat dead until a test adviser address was typed. A known store
  // routes to its own sales desk instead — never a hard block.
  it("a primary desk without a named contact is tickable and auto-ticked: the request goes to the dealership's sales desk", () => {
    const plan = nj([{ ...scott, desk: generic }]);
    assert.equal(plan.rows["Scott Chevrolet"].selectable, true);
    assert.equal(plan.rows["Scott Chevrolet"].checked, true);
    assert.equal(plan.rows["Scott Chevrolet"].routing, "rooftop_inbox");
    assert.equal(plan.canContinue, true);
    const queued = nj([{ ...scott, desk: unassigned }]);
    assert.equal(queued.rows["Scott Chevrolet"].selectable, true);
    assert.equal(queued.rows["Scott Chevrolet"].routing, "unassigned", "no inbox on file → ops routes it; still not a dead end");
    assert.equal(queued.canContinue, true);
    assert.equal(nj([{ ...scott, desk: named }]).rows["Scott Chevrolet"].routing, "named");
  });

  // The Freedom Ford (Iselin, NJ) case: directory has no named contact, the
  // buyer types their adviser's address, the badge said "Adviser added" — and
  // the checkbox stayed disabled with Continue dead.
  it("a buyer-typed adviser address stands in for a missing contact: tickable, auto-ticked, Continue live", () => {
    const freedom: SelectionDesk = { dealerName: "Freedom Ford (Iselin, NJ)", state: "NJ", desk: generic, buyerEmail: "jane.doe@freedomford.com" };
    const plan = planDeskSelection({ buyerState: "NJ", sameStateOnly: true, primaryDealerName: freedom.dealerName, desks: [freedom], confirmed: {} });
    const row = plan.rows[freedom.dealerName];
    assert.equal(row.adviserAdded, true);
    assert.equal(row.routing, "adviser", "the adviser takes it instead of the desk");
    assert.equal(row.selectable, true);
    assert.equal(row.checked, true);
    assert.equal(plan.canContinue, true);
  });

  it("a shared-inbox or half-typed adviser address is ignored (the desk still takes it); an opted-out desk stays locked", () => {
    const base = { buyerState: "NJ", sameStateOnly: true, primaryDealerName: "Freedom Ford", confirmed: {} };
    for (const buyerEmail of ["sales@freedomford.com", "info@freedomford.com", "jane@freedomford", "jane"]) {
      const plan = planDeskSelection({ ...base, desks: [{ dealerName: "Freedom Ford", state: "NJ", desk: generic, buyerEmail }] });
      assert.equal(plan.rows["Freedom Ford"].adviserAdded, false, buyerEmail);
      assert.equal(plan.rows["Freedom Ford"].routing, "rooftop_inbox", buyerEmail);
      assert.equal(plan.canContinue, true, buyerEmail);
    }
    const optedOut = planDeskSelection({
      ...base,
      desks: [{ dealerName: "Freedom Ford", state: "NJ", desk: { knownNamed: true, blockedReason: "dealer_opted_out" }, buyerEmail: "jane.doe@freedomford.com" }],
    });
    assert.equal(optedOut.rows["Freedom Ford"].selectable, false);
    assert.equal(optedOut.canContinue, false);
  });

  it("while the lookup is still loading nothing is tickable and Continue waits", () => {
    const plan = nj([{ ...scott, desk: undefined }]);
    assert.equal(plan.rows["Scott Chevrolet"].selectable, false);
    assert.equal(plan.canContinue, false);
  });

  it("an unknown buyer state never holds anyone back", () => {
    const plan = planDeskSelection({ buyerState: "USA", sameStateOnly: true, primaryDealerName: "Scott Chevrolet", desks: [scott, healey], confirmed: {} });
    assert.equal(plan.rows["Healey Chevrolet, INC."].checked, true);
    assert.equal(plan.canContinue, true);
  });
});
