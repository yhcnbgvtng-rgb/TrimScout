// The "Accept and share my info" confirm step: nothing that picks a winner or releases the buyer's details runs before the
// buyer confirms, "Go back" runs nothing, the dialog shows the buyer's own full details, and every acceptance site goes through it.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { acceptShareBody, createAcceptGate, guestEmailFromBuyerId, sharedFields, CONTACT_SHARED_LINE } from "./acceptShare";
import { AcceptShareDialog } from "../components/AcceptShareConfirm";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const CONTACT = { name: "Pat Buyer", email: "pat@outlook.com", phone: "(973) 555-0142" };

describe("accept gate: release only after confirm", () => {
  it("request() runs nothing; confirm() runs the action exactly once", async () => {
    let released = 0;
    const gate = createAcceptGate(() => {});
    gate.request("Smith Ford", () => { released += 1; });
    assert.equal(released, 0);
    assert.deepEqual(gate.pending(), { dealerName: "Smith Ford", mode: "early" });
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

describe("full values and dialog", () => {
  it("returns trimmed raw values and null for blanks", () => {
    assert.deepEqual(sharedFields({ name: " Pat Buyer ", phone: "(973) 555-0142", email: "pat@outlook.com" }).map((f) => f.value), ["Pat Buyer", "(973) 555-0142", "pat@outlook.com"]);
    assert.deepEqual(sharedFields({ name: "  ", email: null }).map((f) => f.value), [null, null, null]);
    assert.equal(guestEmailFromBuyerId("guest:pat@outlook.com"), "pat@outlook.com");
    assert.equal(guestEmailFromBuyerId("42"), null);
  });

  it("signed-in: shows the exact copy, both buttons and the full name, phone and email", () => {
    const html = renderToStaticMarkup(<AcceptShareDialog dealerName="Smith Ford" contact={CONTACT} onConfirm={() => {}} onCancel={() => {}} />);
    assert.ok(html.includes("Accepting shares your name, phone and email with Smith Ford only. They&#x27;ll contact you directly to finish the deal. Other dealers won&#x27;t get your info."));
    assert.ok(html.includes("Accept and share my info"));
    assert.ok(html.includes("Go back"));
    for (const v of [CONTACT.name, CONTACT.phone, CONTACT.email]) assert.ok(html.includes(v), v);
    assert.ok(!html.includes("•••"), "nothing masked");
  });

  it("a partly-missing contact still lists the fields, with Not on file for the gap", () => {
    const html = renderToStaticMarkup(<AcceptShareDialog dealerName="X" contact={{ email: "a@b.co" }} onConfirm={() => {}} onCancel={() => {}} />);
    assert.ok(html.includes("Not on file") && html.includes("a@b.co"));
  });

  it("a guest sees exactly which email goes to the dealer, in both modes", () => {
    for (const mode of ["early", "final"] as const) {
      const html = renderToStaticMarkup(<AcceptShareDialog mode={mode} dealerName="Smith Ford" contact={{ email: "pat@outlook.com", guest: true }} onConfirm={() => {}} onCancel={() => {}} />);
      assert.ok(html.includes("Your email pat@outlook.com goes to Smith Ford"));
      assert.ok(!html.includes("We&#x27;ll ask") && !html.includes("Not on file"));
      assert.ok(html.includes(mode === "early" ? ">Continue<" : ">Accept and share my info<"));
    }
  });

  it('early mode (Choose / OTD accept): "Nothing is shared yet" copy, Continue + Go back', () => {
    const html = renderToStaticMarkup(<AcceptShareDialog mode="early" dealerName="Smith Ford" contact={CONTACT} onConfirm={() => {}} onCancel={() => {}} />);
    assert.ok(html.includes("Nothing is shared yet. When you accept the final deal, your name, phone and email go to Smith Ford only, and they&#x27;ll contact you directly. Other dealers won&#x27;t get your info."));
    assert.ok(html.includes(">Continue<") && html.includes(">Go back<"));
    assert.ok(!html.includes("Accept and share my info"));
    assert.ok(!html.includes("Accepting shares"));
  });

  it('final mode (Accept final deal): current copy and "Accept and share my info"', () => {
    const html = renderToStaticMarkup(<AcceptShareDialog mode="final" dealerName="Smith Ford" contact={CONTACT} onConfirm={() => {}} onCancel={() => {}} />);
    assert.ok(html.includes("Accepting shares your name, phone and email with Smith Ford only."));
    assert.ok(html.includes(">Accept and share my info<") && !html.includes(">Continue<"));
  });

  it("the gate defaults to early; only Accept final deal asks for final", async () => {
    const gate = createAcceptGate(() => {});
    gate.request("A", () => {});
    assert.equal(gate.pending()?.mode, "early");
    gate.request("A", () => {}, "final");
    assert.equal(gate.pending()?.mode, "final");
    const src = read("components/StagedDeals.tsx");
    assert.ok(/type: "accept_final" \}\), "final"\)/.test(src));
    assert.ok(!/type: "accept_otd" \}\), "final"\)/.test(src));
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
      const gated = src.match(new RegExp(`acceptShare\\.request\\([^;]*?\\(\\) => act\\(\\{ type: "${t}" \\}\\)(?:, "final")?\\)`, "g")) || [];
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
