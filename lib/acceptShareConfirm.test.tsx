// The "Accept and share my info" confirm step: nothing that picks a winner or releases the buyer's details runs before the
// buyer confirms, "Go back" runs nothing, the dialog shows masked fields only, and every acceptance site goes through it.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { acceptShareBody, createAcceptGate, maskEmail, maskName, maskPhone, sharedFields, CONTACT_SHARED_LINE } from "./acceptShare";
import { AcceptShareDialog } from "../components/AcceptShareConfirm";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const CONTACT = { name: "Pat Buyer", email: "pat@outlook.com", phone: "(973) 555-0142" };

describe("accept gate: release only after confirm", () => {
  it("request() runs nothing; confirm() runs the action exactly once", async () => {
    let released = 0;
    const gate = createAcceptGate(() => {});
    gate.request("Smith Ford", () => { released += 1; });
    assert.equal(released, 0);
    assert.deepEqual(gate.pending(), { dealerName: "Smith Ford" });
    await gate.confirm();
    assert.equal(released, 1);
    await gate.confirm();
    assert.equal(released, 1, "a second confirm has nothing parked");
    assert.equal(gate.pending(), null);
  });

  it('"Go back" releases nothing and drops the parked action', async () => {
    let released = 0;
    const gate = createAcceptGate(() => {});
    gate.request("Smith Ford", () => { released += 1; });
    gate.cancel();
    await gate.confirm();
    assert.equal(released, 0);
    assert.equal(gate.pending(), null);
  });

  it("a new request replaces the parked one: only the latest dealer is released", async () => {
    const ran: string[] = [];
    const gate = createAcceptGate(() => {});
    gate.request("A", () => { ran.push("A"); });
    gate.request("B", () => { ran.push("B"); });
    await gate.confirm();
    assert.deepEqual(ran, ["B"]);
  });
});

describe("masking and dialog", () => {
  it("masks email, phone and name", () => {
    assert.equal(maskEmail("pat@outlook.com"), "p•••@outlook.com");
    assert.equal(maskPhone("(973) 555-0142"), "•••-•••-0142");
    assert.equal(maskName("Pat Buyer"), "P••• B•••");
    assert.equal(maskEmail(null), null);
    assert.equal(maskPhone("12"), null);
    assert.equal(maskName("  "), null);
  });

  it("shows the exact copy, both buttons and masked fields only", () => {
    const html = renderToStaticMarkup(<AcceptShareDialog dealerName="Smith Ford" contact={CONTACT} onConfirm={() => {}} onCancel={() => {}} />);
    assert.ok(html.includes("Accepting shares your name, phone and email with Smith Ford only. They&#x27;ll contact you directly to finish the deal. Other dealers won&#x27;t get your info."));
    assert.ok(html.includes("Accept and share my info"));
    assert.ok(html.includes("Go back"));
    for (const m of ["P••• B•••", "•••-•••-0142", "p•••@outlook.com"]) assert.ok(html.includes(m), m);
    for (const raw of [CONTACT.name, CONTACT.email, CONTACT.phone, "555-0142"]) assert.ok(!html.includes(raw), `raw value leaked: ${raw}`);
  });

  it("says Not on file for a missing field instead of inventing one", () => {
    assert.equal(sharedFields({ email: "a@b.co" }).find((f) => f.key === "phone")?.masked, null);
    const html = renderToStaticMarkup(<AcceptShareDialog dealerName="X" contact={{ email: "a@b.co" }} onConfirm={() => {}} onCancel={() => {}} />);
    assert.ok(html.includes("Not on file"));
  });

  it("body copy names only the chosen dealer", () => {
    assert.ok(acceptShareBody("Smith Ford").includes("with Smith Ford only"));
  });
});

describe("every acceptance site goes through the dialog", () => {
  it("the RFQ page never hands the raw pick to a Choose button", () => {
    const page = read("app/rfq/[id]/page.tsx");
    assert.ok(!/onPick=\{handlePick\}/.test(page), "onPick must be requestPick");
    assert.ok(!/onPick=\{\(\) => invite\.quote && handlePick/.test(page));
    assert.equal((page.match(/onPick=\{requestPick\}/g) || []).length, 4);
    assert.ok(/acceptShare\.request\([^)]*\(\) => handlePick\(quoteId\)\)/.test(page));
    assert.ok(page.includes("{acceptShare.dialog}"));
  });

  it("staged accept_otd and accept_final only run inside the gate", () => {
    const src = read("components/StagedDeals.tsx");
    for (const t of ["accept_otd", "accept_final"]) {
      const calls = src.match(new RegExp(`act\\(\\{ type: "${t}" \\}\\)`, "g")) || [];
      const gated = src.match(new RegExp(`acceptShare\\.request\\([^;]*?\\(\\) => act\\(\\{ type: "${t}" \\}\\)\\)`, "g")) || [];
      assert.equal(calls.length, 1, t);
      assert.equal(gated.length, 1, `${t} must be wrapped`);
    }
  });

  it("each Choose button has the one-line reassurance", () => {
    for (const f of ["components/LeaseCompare.tsx", "components/UsedCompare.tsx", "app/rfq/[id]/page.tsx", "components/StagedDeals.tsx"]) {
      assert.ok(read(f).includes("CONTACT_SHARED_LINE"), f);
    }
    assert.equal(CONTACT_SHARED_LINE, "Your contact info is shared only with the dealer you choose.");
  });

  it("the server still releases only on accept_final to the winner (no new release path)", () => {
    const route = read("app/api/rfqs/[id]/invites/[inviteId]/stage/route.ts");
    assert.equal((route.match(/sendBuyerDetailsRelease/g) || []).length, 2); // import + the one call
    assert.ok(/action\.type === "accept_final" && result\.stage\.release/.test(route));
  });
});
