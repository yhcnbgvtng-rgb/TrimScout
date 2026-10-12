// The conversation identity filter: nobody can be identified through a message — no names, no email, no phone number in any form (digits,
// spelled out, split across words or messages, look-alike characters, emoji digits), no handles, platforms, other links, files or street
// addresses — while ordinary deal talk (prices, VINs, stock numbers, APRs, dates, mileage) goes straight through.
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { findAcrossMessages, findContactVector, findIdentityInfo, hasAttachment, riskScore, RISK_THRESHOLD, screenMessage } from "./identityFilter";
import { findIdentityInfo as boxFilter, fold, spoken, views } from "../scrapers/lightsail-crawler/src/identityFilter.js";
import { buildThread, REDACTED_BUYER_TEXT } from "./dealThread";
import { BLOCK, PASS } from "./testdata/chatFixtures";
import type { RfqInvite, RfqRequest } from "./rfq";

describe("the fixed lists", () => {
  it("has at least 40 disguises and at least 20 normal deal messages", () => {
    assert.ok(BLOCK.length >= 40, `block list has ${BLOCK.length}`);
    assert.ok(PASS.length >= 20, `pass list has ${PASS.length}`);
  });
  for (const text of BLOCK) {
    it(`blocks: ${JSON.stringify(text)}`, () => {
      const r = screenMessage({ text });
      assert.equal(r.verdict, "block", `should be blocked by the rules alone: ${text}`);
      assert.ok(r.reason);
    });
  }
  for (const text of PASS) {
    it(`passes (no AI check needed): ${JSON.stringify(text)}`, () => {
      const r = screenMessage({ text });
      assert.equal(r.verdict, "pass", `${text} => ${r.verdict} ${r.reason}`);
      assert.equal(findIdentityInfo(text), null);
    });
  }
  it("counts: every disguise blocked, every normal message passed", () => {
    const blocked = BLOCK.filter((t) => screenMessage({ text: t }).verdict === "block").length;
    const passed = PASS.filter((t) => screenMessage({ text: t }).verdict === "pass").length;
    assert.equal(blocked, BLOCK.length);
    assert.equal(passed, PASS.length);
  });
});

describe("normalization", () => {
  it("folds look-alikes, fullwidth, math, keycap-emoji and other-script digits to ASCII", () => {
    assert.equal(fold("５５５"), "555");
    assert.equal(fold("𝟓𝟓𝟓"), "555");
    assert.equal(fold("٥٥٥"), "555");
    assert.equal(fold("5️⃣5️⃣5️⃣"), "555");
    assert.equal(fold("jаne＠gmail.com"), "jane@gmail.com");
    assert.equal(fold("f​a​c​e"), "face");
    assert.equal(fold("café"), "cafe");
  });
  it("turns number words into digits: 'five five five', 'double five', 'triple seven', 'oh' for zero", () => {
    assert.equal(spoken("five five five").replace(/\s/g, ""), "555");
    assert.equal(spoken("double five"), "55");
    assert.equal(spoken("triple seven"), "777");
    assert.equal(spoken("nine oh one"), "9 0 1");
    assert.equal(spoken("oh great"), "oh great", "'oh' is only a zero beside other digits");
    assert.equal(spoken("5ive 5ive"), "5 5");
  });
  it("rejoins spaced-out characters and runs rules on the raw and the normalized views", () => {
    assert.match(views("j a n e @ g m a i l . c o m").joined, /^jane@gmail/);
    assert.equal(views("5 . 5 . 5 - 1 2 3 4").joined.replace(/\D/g, ""), "5551234");
    assert.notEqual(views("５５５１２３４").folded, "５５５１２３４");
  });
  it("the app and the deals-server module are the same function and agree on every fixture", () => {
    for (const t of [...BLOCK, ...PASS]) assert.equal(boxFilter(t), findIdentityInfo(t));
  });
});

describe("across messages: the sender's last five, joined", () => {
  it("blocks the message that completes a phone number, email or handle", () => {
    assert.ok(findAcrossMessages(["five five five", "one two"], "three four"));
    assert.ok(findAcrossMessages(["5", "5", "5", "1"], "2 3 4"));
    assert.ok(findAcrossMessages(["jane at", "acme"], "dot com"));
    assert.ok(findAcrossMessages(["my handle is"], "@jane_doe"));
    assert.ok(findAcrossMessages(["555", "123"], "4567"));
  });
  it("uses only the last five messages, so an old fragment far back does not count", () => {
    assert.equal(findAcrossMessages(["555", "ok", "thanks", "sure", "fine", "great"], "123"), null);
    assert.ok(findAcrossMessages(["ok", "thanks", "sure", "fine", "555"], "123 4567"), "but the same fragment inside the last five does");
  });
  it("lets ordinary runs of short deal messages through", () => {
    assert.equal(findAcrossMessages(["36 months", "5.9", "3000 down", "60", "10/15"], "2650"), null);
    assert.equal(findAcrossMessages(["38,500", "799", "2,650", "660"], "44,609"), null);
    assert.equal(findAcrossMessages(["hold it", "until friday"], "thanks"), null);
    assert.equal(findAcrossMessages([], "five five five one two three four") , null, "no history: nothing to join (the message itself is checked on its own)");
  });
  it("screenMessage applies it", () => {
    assert.equal(screenMessage({ text: "three four", previous: ["five five five", "one two"] }).verdict, "block");
    assert.equal(screenMessage({ text: "three four" }).verdict, "pass");
  });
  it("finds contact vectors only (not names) for the cross-message join", () => {
    assert.ok(findContactVector("5551234567"));
    assert.equal(findContactVector("my name is Jane"), null);
  });
});

describe("links and files", () => {
  it("no images or files in chat", () => {
    for (const body of [{ attachments: ["a.png"] }, { image: "x" }, { files: [{}] }, { photo: "p" }, { upload: "u" }]) assert.equal(hasAttachment(body), true);
    for (const body of [{ text: "hi" }, { attachments: [] }, { files: null }, null]) assert.equal(hasAttachment(body), false);
    assert.ok(findIdentityInfo("data:image/png;base64,AAAA"), "an embedded image is refused");
    assert.ok(findIdentityInfo("![me](x.png)"), "markdown images are refused");
  });
  it("no URLs except trimscout.com", () => {
    for (const t of ["see https://example.com/me", "www.example.org", "bit.ly/x", "evil.co", "http://trimscout.com.evil.io/a", "https://nottrimscout.com/x"]) assert.ok(findIdentityInfo(t), t);
    for (const t of ["details at https://trimscout.com/rfq/17", "https://www.trimscout.com/d/abc", "app.trimscout.com is the tracker"]) assert.equal(findIdentityInfo(t), null, t);
  });
});

describe("the risk score sends borderline messages to the AI check", () => {
  it("scores digit density, odd spacing, mixed letters and numbers and look-alikes; ordinary talk scores ~0", () => {
    for (const t of ["x y z w v u t", "5551234", "a1b2c3 d4e5f6 g7h8i9", "8 8 8 8 8 8", "ΑΒΓ 7 2 0 4 5 1 8"]) assert.ok(riskScore(t) >= 1, t);
    for (const t of PASS) assert.ok(riskScore(t) < RISK_THRESHOLD, `${t} scored ${riskScore(t)}`);
  });
  it("above the threshold and clear of every rule -> 'review' (hold for the AI)", () => {
    assert.equal(screenMessage({ text: "x y z w v u t" }).verdict, "review");
    assert.equal(screenMessage({ text: "5551234" }).verdict, "review", "one plain 7-digit token could be a stock number");
    assert.equal(screenMessage({ text: "Stock number 1234567 please" }).verdict, "review", "asked of the AI, not guessed");
  });
});

describe("older text on the deal is blanked for the dealer with the same rules", () => {
  const inv = (note: string) => ({ id: "1", dealerName: "Alpha", status: "quoted", quote: null, buyerCounter: { againstQuoteId: "q", note, sentAt: "2026-10-11T10:00:00Z", sheet: null }, messages: [{ id: "m", from: "buyer", text: "my name is Jane", at: "2026-10-11T11:00:00Z" }] }) as unknown as RfqInvite;
  const rfq = { id: "1", createdAt: "2026-10-10T00:00:00Z", status: "collecting", pickedQuoteId: null, buyerNote: "five five five one two three four", invites: [] } as unknown as RfqRequest;
  it("names, spelled-out numbers and look-alike emails are replaced for the dealer; the buyer still sees their own words", () => {
    const t = buildThread(rfq, inv("This is Maria speaking"), "dealer");
    assert.equal(t.filter((e) => e.text === REDACTED_BUYER_TEXT).length, 3);
    assert.match(JSON.stringify(buildThread(rfq, inv("This is Maria speaking"), "buyer")), /Maria speaking/);
    assert.equal(buildThread(rfq, inv("jаne＠gmail.com"), "dealer").some((e) => /gm/.test(e.text)), false);
  });
  it("a message an admin blocked is gone from both sides", () => {
    const hidden = { ...inv("ok"), messages: [{ id: "m", from: "dealer", text: "", hidden: true, at: "2026-10-11T11:00:00Z" }, { id: "n", from: "dealer", text: "still here", at: "2026-10-11T11:01:00Z" }] } as unknown as RfqInvite;
    for (const viewer of ["buyer", "dealer"] as const) assert.deepEqual(buildThread(rfq, hidden, viewer).filter((e) => e.kind === "message").map((e) => e.text), ["still here"]);
  });
  it("the same module is what every layer runs", () => {
    assert.match(fs.readFileSync("scrapers/lightsail-crawler/src/rfqMessages.js", "utf8"), /from "\.\/identityFilter\.js"/);
    assert.match(fs.readFileSync("lib/identityFilter.ts", "utf8"), /scrapers\/lightsail-crawler\/src\/identityFilter\.js/);
  });
});
