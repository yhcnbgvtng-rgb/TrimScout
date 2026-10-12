// The conversation identity filter: nobody can be identified through a message — no names, no email, no phone number in any form
// (not even spelled out), no handles, messengers or street addresses — while ordinary deal talk (prices, VINs, terms) still goes through.
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { findIdentityInfo } from "./identityFilter";
import { buildThread, REDACTED_BUYER_TEXT } from "./dealThread";
import { findIdentityInfo as boxFilter } from "../scrapers/lightsail-crawler/src/identityFilter.js";
import type { RfqInvite, RfqRequest } from "./rfq";

const BLOCKED: Array<[string, string]> = [
  // phone numbers, every way of writing one
  ["call me at 201-555-0147", "phone"], ["201.555.0147", "phone"], ["(201) 555 0147", "phone"], ["+1 201 555 0147", "phone"], ["2015550147", "phone"],
  ["my phone 5551234", "phone"], ["555-1234", "phone"], ["5 5 5 1 2 3 4", "phone"], ["2 0 1 five five five", "number"],
  ["my number is five five five one two three four", "number"], ["five five five", "number"], ["five-five-five", "number"], ["double five one", "number"],
  ["triple five", "number"], ["555 one two three 4567", "number"], ["one two three", "number"], ["nine one seven", "number"], ["oh one oh", "number"],
  ["area code two zero one", "number"],
  // email, any disguise
  ["jane@gmail.com", "email"], ["john.smith@x.com", "email"], ["jane at gmail dot com", "email"], ["jane (at) gmail (dot) com", "email"], ["my gmail is jane", "email"],
  // handles, messengers, links, addresses, every social platform
  ["follow me on twitter", "social"], ["I'm on Facebook", "social"], ["message me on Meta", "social"], ["dm me on X", "social"], ["my X handle", "social"], ["x.com/jane", "social"], ["find me on IG", "social"], ["tiktok", "social"], ["discord", "social"], ["on Instagram", "social"], ["add me on snap", "social"], ["youtube channel", "social"], ["venmo me", "social"],
  ["find me on instagram", "social"], ["whatsapp me", "social"], ["reach me on signal", "social"], ["@jane_doe", "handle"], ["facebook.com/jane", "link"], ["www.example.com", "link"],
  ["I live at 12 Main Street", "address"], ["ship it to 450 Oak Ave", "address"],
  // names
  ["my name is Jane", "name"], ["Hi, I'm John, interested in the RAV4", "name"], ["This is Maria speaking", "name"], ["I am Dave", "name"], ["call me Bob", "name"],
  ["Mr. Rivera will pick it up", "name"], ["Dr Patel here", "name"], ["ask for Dave when you arrive", "name"], ["Thanks,\nJohn Smith", "name"], ["Best regards,\nMaria", "name"], ["- Dave", "name"],
  ["they call me Chip", "name"], ["last name Nguyen", "name"],
  // instructions to take it elsewhere
  ["text me", "contact"], ["call us", "contact"], ["my cell is on the card", "contact"],
];
const ALLOWED = [
  "Can you hold it until Friday?", "The price is $44,000 out the door", "I'm interested in the XLE", "It's Friday so I can come Saturday", "This is great",
  "Is the 2026 RAV4 VIN 2T36CRAVXTC39J403 still available?", "Can you do 38,500 with the doc fee at 799?", "I need 36 months at 5.9%", "Stock number S12345 please",
  "Thanks, that works", "Thanks!", "I am ready to buy this week", "Please send two quotes, one with and one without nitrogen", "Can you do 3 or 4 percent off?",
  "Down payment of $3,000 and 60 months", "one or two options is fine", "The doc fee is $799 and tax is $2,650", "Best price you can do?", "Please talk to Sales", "I'm Ready to sign",
  "Yes, the sales tax is $2,750 and title is $700.", "Can you take 1,500 off?", "Is the nitrogen fill $400?", "It's a 4x4 with X package", "Do you have the Model X in stock?", "Is the roof rack metal or aluminum?", "I want trim X or Y",
];

describe("blocked: every way of saying who you are", () => {
  for (const [text, kind] of BLOCKED) it(`${kind}: ${JSON.stringify(text)}`, () => assert.ok(findIdentityInfo(text), `should be blocked: ${text}`));
});
describe("allowed: ordinary deal talk", () => {
  for (const text of ALLOWED) it(JSON.stringify(text), () => assert.equal(findIdentityInfo(text), null));
});
describe("one rule set everywhere", () => {
  it("the app and the deals-server module are the same function and agree on every fixture", () => {
    for (const [text] of BLOCKED) assert.equal(boxFilter(text), findIdentityInfo(text));
    for (const text of ALLOWED) assert.equal(boxFilter(text), findIdentityInfo(text));
  });
  it("is enforced on send in the panel, both routes and the box, and the box patch installs the module", () => {
    for (const f of ["components/DealThreadPanel.tsx", "app/api/quote-invite/thread/route.ts", "app/api/rfqs/[id]/invites/[inviteId]/thread/route.ts"]) assert.match(fs.readFileSync(f, "utf8"), /findIdentityInfo\(text\)/, f);
    assert.match(fs.readFileSync("scrapers/lightsail-crawler/src/rfqMessages.js", "utf8"), /findIdentityInfo\(String\(body\.text/);
    assert.match(fs.readFileSync("scripts/box/2026-10-11-rfq-messages.sh", "utf8"), /for m in identityFilter\.js rfqMessages\.js/);
  });
  it("older text already on the deal (notes, counter notes) is blanked for the dealer with the same rule — names and spelled-out numbers included", () => {
    const inv = (note: string) => ({ id: "1", dealerName: "Alpha", status: "quoted", quote: null, buyerCounter: { againstQuoteId: "q", note, sentAt: "2026-10-11T10:00:00Z", sheet: null }, messages: [{ id: "m", from: "buyer", text: "my name is Jane", at: "2026-10-11T11:00:00Z" }] }) as unknown as RfqInvite;
    const rfq = { id: "1", createdAt: "2026-10-10T00:00:00Z", status: "collecting", pickedQuoteId: null, buyerNote: "five five five one two three four", invites: [] } as unknown as RfqRequest;
    const t = buildThread(rfq, inv("This is Maria speaking"), "dealer");
    assert.equal(t.filter((e) => e.text === REDACTED_BUYER_TEXT).length, 3);
    assert.match(JSON.stringify(buildThread(rfq, inv("This is Maria speaking"), "buyer")), /Maria speaking/, "the buyer still sees their own words");
  });
});
