// Every phone box in the app is the shared PhoneInput (rules: lib/phone.ts), saved numbers show formatted, and the offer-accept step still needs exactly 10 digits.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhoneInput } from "../components/PhoneInput";
import { AcceptShareDialog } from "../components/AcceptShareConfirm";
import { submitContactDraft, validateContactDraft } from "./acceptShare";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const attr = (html: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1];

describe("PhoneInput", () => {
  it("is a tel box with the phone keyboard and autofill, and shows what it is given formatted", () => {
    const html = renderToStaticMarkup(<PhoneInput value="5551234567" onChange={() => {}} />);
    assert.equal(attr(html, "type"), "tel");
    assert.equal(attr(html, "inputMode"), "tel");
    assert.equal(attr(html, "autoComplete"), "tel");
    assert.equal(attr(html, "value"), "(555) 123-4567");
  });
  it("shows a number saved in another shape exactly as saved, and an empty one empty", () => {
    assert.equal(attr(renderToStaticMarkup(<PhoneInput value="(555) 123-4567 x12" onChange={() => {}} />), "value"), "(555) 123-4567 x12");
    assert.equal(attr(renderToStaticMarkup(<PhoneInput value={null} onChange={() => {}} />), "value"), "");
  });
  it("passes id, name, required, aria and test ids through", () => {
    const html = renderToStaticMarkup(<PhoneInput id="p" name="phone" required aria-required="true" data-testid="t" value="" onChange={() => {}} />);
    for (const a of ['id="p"', 'name="phone"', "required", 'aria-required="true"', 'data-testid="t"']) assert.ok(html.includes(a), a);
  });
});

describe("offer-accept step: name, phone and email are all required, the phone as exactly 10 digits", () => {
  const ok = { name: "Pat Buyer", email: "pat@outlook.com" };
  it("accepts a whole number in any shape, with or without a leading 1 / +1", () => {
    for (const phone of ["(973) 555-0142", "9735550142", "+1 973 555 0142", "1-973-555-0142"]) assert.deepEqual(validateContactDraft({ ...ok, phone }), {}, phone);
  });
  it("blocks a partial number, a too-long one and an empty one, with the matching message", () => {
    for (const phone of ["973", "(973) 555-014", "97355501421"]) assert.equal(validateContactDraft({ ...ok, phone }).phone, "Enter a 10-digit phone number.", phone);
    assert.equal(validateContactDraft({ ...ok, phone: "  " }).phone, "Enter your phone number.");
  });
  it("Continue sends nothing until all three are valid, then hands on the trimmed, formatted number", () => {
    let sent: unknown = null;
    assert.ok(submitContactDraft({ ...ok, phone: "(973) 555-01" }, (c) => { sent = c; }).phone);
    assert.equal(sent, null);
    assert.deepEqual(submitContactDraft({ ...ok, phone: "(973) 555-0142" }, (c) => { sent = c; }), {});
    assert.deepEqual(sent, { name: "Pat Buyer", phone: "(973) 555-0142", email: "pat@outlook.com" });
  });
  it("the dialog's phone field is the shared PhoneInput: prefilled digits show formatted, Continue stays disabled while it is short", () => {
    const html = renderToStaticMarkup(<AcceptShareDialog dealerName="Smith Ford" contact={{ ...ok, phone: "9735550142" }} onConfirm={() => {}} onCancel={() => {}} />);
    assert.ok(html.includes('value="(973) 555-0142"'));
    assert.ok(html.includes('data-testid="accept-share-input-phone"') && html.includes('type="tel"') && html.includes('inputMode="tel"'));
    const short = renderToStaticMarkup(<AcceptShareDialog dealerName="Smith Ford" contact={{ ...ok, phone: "973555" }} onConfirm={() => {}} onCancel={() => {}} />);
    assert.match(short, /<button[^>]*disabled=""[^>]*data-testid="accept-share-confirm"|<button[^>]*data-testid="accept-share-confirm"[^>]*disabled=""/);
  });
});

describe("every phone input in the app uses PhoneInput", () => {
  const FILES: Record<string, string> = {
    "buyer offer-accept step": "components/AcceptShareConfirm.tsx",
    "buyer sign-up": "components/SignupView.tsx",
    "dealer profile (Direct Phone)": "components/DealerPortal.tsx",
    "admin dealerships": "app/admin/dealerships/DealershipsClient.tsx",
  };
  for (const [what, file] of Object.entries(FILES)) {
    it(`${what} (${file})`, () => {
      const src = read(file);
      assert.match(src, /import \{ PhoneInput \} from ".*PhoneInput"/);
      assert.match(src, /<PhoneInput\b/);
    });
  }
  it("no other input in the app is a phone box built by hand", () => {
    const hand = /<input[^>]*(type="tel"|salesRepPhone|form\.phone|setPhone)/;
    for (const file of Object.values(FILES)) assert.ok(!hand.test(read(file).replace(/<PhoneInput\b[^>]*>/g, "")), file);
  });
  it("sign-up keeps the phone optional but blocks a half-typed number", () => {
    const src = read("components/SignupView.tsx");
    assert.ok(src.includes('phone.trim() && !isCompletePhone(phone)'));
    assert.ok(src.includes("or leave it blank"));
  });
  it("saved numbers are shown formatted on the buyer reveal page, dealer voucher, admin lists and the compare sheet", () => {
    for (const file of ["app/quote-request/buyer-contact/page.tsx", "components/VoucherModal.tsx", "components/AdminPortal.tsx", "components/OfferCompareView.tsx", "app/admin/dealerships/DealershipsClient.tsx"]) {
      assert.ok(read(file).includes("formatPhoneDisplay("), file);
    }
  });
});
