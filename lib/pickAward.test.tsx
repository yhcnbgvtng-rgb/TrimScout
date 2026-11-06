// "Choose this quote" on a non-staged request is the acceptance: the box records the release on the winner (releaseOnPick), the app
// queues the same "Your offer was accepted" email accept_final sends (awardWinnerOnPick -> sendBuyerDetailsRelease, SAFE MODE routing),
// and a later accept_final can never introduce the buyer a second time. Staged requests keep "Accept final deal" as their only send.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { applyStageAction, initialStageState, releaseOnPick, type DealStageState } from "./dealStages";
import { awardWinnerOnPick } from "./inviteOutbox";
import { sendQuoteInviteEmail } from "./dealerEmail";
import type { RfqInvite, RfqRequest } from "./rfq";

process.env.LIGHTSAIL_API_KEY ||= "test-signing-key";
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const CONTACT = { name: "Pat Buyer", email: "pat.buyer@example.com", phone: "555-0142", zip: "07030" };
const NOW = new Date("2026-11-05T15:00:00Z");

const invite = (id: string, stage: DealStageState | null, over: Partial<RfqInvite> = {}): RfqInvite =>
  ({ id, dealerName: "Test Motors", dealerContactEmail: `desk${id}@testmotors.example`, status: "quoted", declineReason: null, invitedAt: "2026-11-05T00:00:00Z", respondedAt: "2026-11-05T01:00:00Z", deliveryStatus: "sent", viewToken: `tok${id}abcdefgh`,
    quote: { id: `q${id}`, inviteId: id, dealerName: "Test Motors", price: 40000, fees: [], totalOtdPrice: 43749, vin: "V", stockNumber: null, expiresAt: "2099-01-01T00:00:00Z", submittedAt: "2026-11-05T01:00:00Z" },
    stage, ...over }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "7", buyerUserId: "2", status: "picked", pickedQuoteId: "q11", createdAt: "2026-11-05T00:00:00Z", vin: "VIN", stockNumber: null, vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", mustHaves: [], approvalStatus: "approved",
    quotePrefs: { quoteType: "cash", staged: false, cash: { zip: "07030" } }, invites, ...over }) as unknown as RfqRequest;
const released = () => {
  const r = releaseOnPick(null, { otd: 43749, contact: CONTACT, now: NOW });
  assert.equal(r.ok, true); return (r as { ok: true; state: DealStageState }).state;
};
const calls = () => { const c: Array<[string, string]> = []; return { c, send: (async (s: string, h: string) => { c.push([s, h]); return true; }) as typeof sendQuoteInviteEmail }; };

describe("releaseOnPick (box rule)", () => {
  it("closes and releases the winner's deal with the quote's OTD, and logs it without the contact details", () => {
    const s = released();
    assert.equal(s.stage, "closed"); assert.equal(s.final?.status, "accepted"); assert.equal(s.final?.summary?.otd, 43749);
    assert.deepEqual(s.release?.contact, CONTACT);
    assert.ok(!JSON.stringify(s.log).includes(CONTACT.email));
  });
  it("is idempotent: an already-released deal comes back untouched with released:false", () => {
    const s = released(); const again = releaseOnPick(s, { otd: 43749, contact: CONTACT, now: new Date("2026-11-06T00:00:00Z") });
    assert.deepEqual(again, { ok: true, released: false, state: s });
  });
  it("needs a reachable buyer email", () => {
    const r = releaseOnPick(null, { otd: 43749, contact: { name: "Pat", email: "nope" } });
    assert.equal(r.ok, false);
  });
  it("a later accept_final cannot release again: the deal is closed", () => {
    const r = applyStageAction(released(), { type: "accept_final", actor: "buyer" }, { buyerContact: CONTACT, now: NOW });
    assert.equal(r.ok, false);
  });
});

describe("awardWinnerOnPick (app)", () => {
  it("queues one 'Your offer was accepted' email to the winner, SAFE MODE tagged, with a reveal link and no contact details", async () => {
    const r = calls(); const rfq = rfqOf([invite("11", released())]);
    assert.equal(await awardWinnerOnPick(rfq, "11", { send: r.send, emailEnabled: () => true }), "sent");
    assert.equal(r.c.length, 1);
    assert.match(r.c[0][0], /^\[SAFE MODE · Test Motors\] Your offer was accepted/);
    assert.match(r.c[0][1], /buyer-contact\?t=/);
    for (const secret of [CONTACT.email, CONTACT.phone, CONTACT.name]) assert.ok(!r.c[0][1].includes(secret));
  });
  it("sends nothing for a staged request (Accept final deal sends it), an unapproved one, the switch off, or a winner with no fresh release", async () => {
    for (const [label, rfq, enabled, want] of [
      ["staged", rfqOf([invite("11", released())], { quotePrefs: { quoteType: "cash", staged: true, cash: { zip: "07030" } } } as never), true, "staged"],
      ["unapproved", rfqOf([invite("11", released())], { approvalStatus: "pending" } as never), true, "held_for_approval"],
      ["switch off", rfqOf([invite("11", released())]), false, "parked_switch_off"],
      ["no release", rfqOf([invite("11", null)]), true, "no_release"],
      ["released invite not the winner", rfqOf([invite("11", released()), invite("12", null)]), true, "no_release"],
    ] as const) {
      const r = calls();
      assert.equal(await awardWinnerOnPick(rfq, label.startsWith("released") ? "12" : "11", { send: r.send, emailEnabled: () => enabled }), want, label);
      assert.equal(r.c.length, 0, label);
    }
  });
});

describe("wiring", () => {
  it("the pick route sends the buyer's contact for non-staged requests only and queues the award after closeOutLosers", () => {
    const src = read("app/api/rfqs/[id]/pick/route.ts");
    assert.match(src, /!isStagedRfq\(existing\)/);
    assert.match(src, /pickRfqQuote\(id, body\.quoteId, contact\)/);
    assert.ok(src.indexOf("closeOutLosers(existing") < src.indexOf("awardWinnerOnPick(pickedRfq"));
    assert.equal(read("app/api/rfqs/[id]/invites/[inviteId]/stage/route.ts").includes("awardWinnerOnPick"), false, "the staged route keeps its own send");
  });
});
