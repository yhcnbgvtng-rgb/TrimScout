// SAFE MODE test deal, end to end, against the deals API on box2 (buyer test mode: audit = 1, fake dealer whose contact is the owner's own inbox).
//
//   TRIMSCOUT_API_KEY=... PHOTO=/path/to/real.jpg node safe-mode-test-deal.mjs [--draft-only] [--no-chat]
//     run it ON box2 (BOX defaults to http://127.0.0.1:3004). The key is read from the env, never printed.
//     PHOTO: any real JPEG, short side >= 1024 px and long side <= 4096 px (a phone photo is fine).
//     SITE (default https://www.trimscout.com), CONTACT (default pausmi@outlook.com).
//
// The trade-in is built the way a buyer builds one: a real draft through POST /api/trade/draft, the six required photos
// uploaded through the site's presigned-PUT flow (sign -> PUT to S3 -> confirm), the details saved with PUT /api/trade/draft/:id,
// and then a COMPLETE record (every TradeInFields key, photos from the draft) attached to the request. The earlier version of this
// script attached a hand-made partial record, which crashed the buyer's trade summary (see lib/trade/partialRecords.test.tsx).
//
// Known limit: the app copies the draft's photos to trade/{requestId}/ when the BUYER adopts the draft (a signed-in buyer session), and a
// script has none. So the photos in the draft are real objects in S3, but the copies the request points at (trade/{requestId}/...) do not
// exist: a dealer-side gallery for this test request shows broken images. Everything else (stages, counters, release, chat filter) is real.
// --draft-only runs just the draft + photo part against the site (creates a draft that the bucket's lifecycle expires after 30 days).
import fs from "node:fs";

const SITE = (process.env.SITE || "https://www.trimscout.com").replace(/\/$/, "");
const BOX = (process.env.BOX || "http://127.0.0.1:3004").replace(/\/$/, "");
const KEY = process.env.TRIMSCOUT_API_KEY;
const CONTACT = process.env.CONTACT || "pausmi@outlook.com";
const PHOTO = process.env.PHOTO;
const DRAFT_ONLY = process.argv.includes("--draft-only");
const NO_CHAT = process.argv.includes("--no-chat");
const REQUIRED = ["front", "rear", "driver_side", "passenger_side", "odometer", "interior"];

const results = [];
function step(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
  if (!ok) { console.log("STOPPED at first failure. No retry."); process.exit(2); }
}
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } };
const short = (j) => JSON.stringify(j).slice(0, 160);

if (!PHOTO || !fs.existsSync(PHOTO)) { console.log("FAIL set PHOTO=/path/to/a/real.jpg (short side >= 1024 px)"); process.exit(1); }
if (!DRAFT_ONLY && !KEY) { console.log("FAIL set TRIMSCOUT_API_KEY (run this on box2)"); process.exit(1); }
const jpg = fs.readFileSync(PHOTO);

// JPEG dimensions from the first SOF marker (no image library needed).
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("no size in JPEG");
}
const { width, height } = jpegSize(jpg);
step("photo is a usable JPEG", Math.min(width, height) >= 1024 && Math.max(width, height) <= 4096, `${width}x${height}, ${jpg.length} bytes`);

// The complete set of details a buyer fills in (all validated by parseTradeFields on the site side when a request is sent).
const VIN = "1HGCM82633A004352";
const fields = {
  vin: VIN, year: 2019, make: "Toyota", model: "Camry", trim: "SE", decodedFromVin: false, mileage: 48000, zip: "07030",
  conditionBand: "good", titleStatus: "clean", ownership: "financed", lenderName: "Safe Mode Test Bank", payoffEstimate: 4000,
  keys: "2+", historyFlag: "no", historyNotes: null, drivetrain: "2wd", options: ["sunroof"], optionsOther: null,
  extColor: "Silver", intColor: "Black", serviceHistory: "dealer", serviceNotes: null, tireBrake: "good", mods: null,
  warningLights: { on: false, which: null }, intent: "apply_to_deal", odometerConfirmed: true,
};

// ---- 1. a real draft with real photos, through the site ----
let r = await fetch(`${SITE}/api/trade/draft`, { method: "POST" });
let d = await json(r);
step("site: create trade draft", r.status === 200 && d.draftId && d.token, `HTTP ${r.status} ${d.draftId ? "draft=" + d.draftId : short(d)}`);
const draftUrl = `${SITE}/api/trade/draft/${d.draftId}?k=${encodeURIComponent(d.token)}`;
const photoUrl = `${SITE}/api/trade/draft/${d.draftId}/photos?k=${encodeURIComponent(d.token)}`;
const photoPost = async (body) => { const x = await fetch(photoUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: x.status, j: await json(x) }; };

r = await fetch(draftUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
step("site: save trade details on the draft", r.status === 200, `HTTP ${r.status}`);

let photos = [];
for (const slot of REQUIRED) {
  const s = await photoPost({ op: "sign", slot });
  step(`site: sign ${slot}`, s.status === 200 && s.j.uploadUrl, `HTTP ${s.status}`);
  const put = await fetch(s.j.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg", Origin: SITE }, body: jpg });
  step(`S3: PUT ${slot}`, put.status === 200, `HTTP ${put.status}${put.status === 200 ? "" : " " + (await put.text()).slice(0, 200)}`);
  const c = await photoPost({ op: "confirm", slot, width, height, capturedAt: new Date().toISOString() });
  step(`site: confirm ${slot}`, c.status === 200 && c.j.photos?.some((p) => p.slot === slot), `HTTP ${c.status}`);
  photos = c.j.photos;
}
step("draft holds all 6 required photos", REQUIRED.every((s) => photos.some((p) => p.slot === s)), `${photos.length} photos`);
r = await fetch(draftUrl);
d = await json(r);
step("site: draft reads back with fields and photos", r.status === 200 && d.draft?.photos?.length >= 6 && d.draft?.fields?.vin === VIN, `HTTP ${r.status}`);
const signed = (d.signed || [])[0]?.url;
if (signed) {
  const g = await fetch(signed);
  const buf = Buffer.from(await g.arrayBuffer());
  step("site: a draft photo reads back through its signed URL (identical bytes)", g.status === 200 && buf.equals(jpg), `HTTP ${g.status}`);
}
const draftPhotos = d.draft.photos;
if (DRAFT_ONLY) { console.log(JSON.stringify({ draftId: d.draft.id, summary: results.length + " steps passed (draft only)" })); process.exit(0); }

// ---- 2. the request on the deals box ----
const call = async (method, path, body) => {
  const x = await fetch(BOX + path, { method, headers: { "X-Trimscout-Api-Key": KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: x.status, j: await json(x) };
};
const stage = (rfq, inv, actor, action, extra = {}) => call("POST", `/api/rfqs/${rfq}/invites/${inv}/stage`, { actor, action, state: "NJ", ...extra });
const VEH_VIN = "1HGCM82633A004352";
let x = await call("POST", "/api/rfqs", {
  buyerUserId: `safe-mode-test-buyer-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`, buyerTestMode: true, vin: VEH_VIN, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "Accord", vehicleTrim: "EX",
  packageKind: "links", linkPastes: [{ url: "https://example.com/safe-mode-test-listing", vin: VEH_VIN }], tradeInExpected: true,
  quotePrefs: { quoteType: "cash", staged: true }, buyerNote: "SAFE MODE TEST DEAL - ignore",
});
step("create RFQ (buyerTestMode, audit=1)", x.status === 201 && x.j.rfq?.id && x.j.rfq.audit === true, `HTTP ${x.status} ${x.j.rfq ? "id=" + x.j.rfq.id : short(x.j)}`);
const rfq = Number(x.j.rfq.id);

const now = new Date().toISOString();
const record = { ...fields, photos: draftPhotos.map((p) => ({ ...p, storageKey: `trade/${rfq}/${p.slot}.jpg` })), createdAt: now, updatedAt: now };
x = await call("POST", `/api/rfqs/${rfq}/trade-in`, { tradeIn: record });
step("attach the complete trade-in record", x.status === 200 && x.j.rfq?.tradeIn?.conditionBand === "good" && Array.isArray(x.j.rfq.tradeIn.options), `HTTP ${x.status}`);
console.log("WARN the request's photo copies (trade/" + rfq + "/...) are not in S3: only the buyer-adoption path copies them.");
x = await call("POST", `/api/rfqs/${rfq}/trade-in`, { tradeIn: { ...record, photos: record.photos.slice(0, 5) } });
step("trade-in refuses 5 photos (422)", x.status === 422, `HTTP ${x.status}`);

x = await call("POST", `/api/rfqs/${rfq}/approval`, { decision: "approved", by: "safe-mode-test" });
step("approve RFQ", x.status === 200, `HTTP ${x.status}`);
x = await call("POST", `/api/rfqs/${rfq}/invites`, { dealerName: "ZZ SAFE MODE TEST DEALER", dealerContactEmail: CONTACT, desk: { name: "Test Desk" }, vehicle: { vin: VEH_VIN } });
step("invite fake dealer (contact = owner's inbox)", x.status === 201 && x.j.invite?.id, `HTTP ${x.status}`);
const inv = Number(x.j.invite.id);
x = await call("POST", `/api/rfqs/${rfq}/invites/${inv}/quotes`, {
  price: 30000, fees: [{ label: "Sales tax", amount: 1987.5 }, { label: "Doc fee", amount: 400 }], vin: VEH_VIN, expiresAt: new Date(Date.now() + 3 * 86400e3).toISOString(), mustHaveAcknowledgement: true, notes: "SAFE MODE test quote",
  used: { kind: "cash", sellingPrice: 30000, dueAtSigning: [{ name: "Sales tax", amount: 1987.5 }, { name: "Doc fee", amount: 400 }], addOns: [], rebates: [] },
});
step("dealer quote (cash OTD 32387.50)", x.status === 201 || x.status === 200, `HTTP ${x.status}`);

const flow = [
  ["stage1 buyer accept_otd", "buyer", { type: "accept_otd" }],
  ["stage2 dealer trade_offer 12000", "dealer", { type: "trade_offer", value: 12000, basis: "preliminary" }],
  ["stage2 buyer trade_counter 14000", "buyer", { type: "trade_counter", value: 14000, note: "safe mode counter" }],
  ["stage2 dealer trade_hold", "dealer", { type: "trade_hold" }],
  ["stage2 buyer trade_accept (offer)", "buyer", { type: "trade_accept" }],
  ["stage3 buyer request_finance", "buyer", { type: "request_finance", downPayment: 3000, termMonths: 60, creditRange: null, outsideFinancing: false }],
  ["stage3 dealer finance_quote apr 7.9", "dealer", { type: "finance_quote", apr: 7.9, termMonths: 60, lenderName: "Safe Mode Test Bank" }],
  ["stage3 buyer finance_counter apr 6.9", "buyer", { type: "finance_counter", apr: 6.9, termMonths: 60, note: "safe mode apr counter" }],
  ["stage3 dealer finance_accept_counter", "dealer", { type: "finance_accept_counter" }],
];
for (const [name, actor, action] of flow) { x = await stage(rfq, inv, actor, action); step(name, x.status === 200, `HTTP ${x.status}${x.status === 200 ? "" : " " + short(x.j)}`); }
x = await stage(rfq, inv, "buyer", { type: "accept_final" }, { buyerContact: { name: "Safe Mode Buyer", email: CONTACT, phone: "5550100", zip: "07030" } });
step("stage4 buyer accept_final + buyerContact", x.status === 200, `HTTP ${x.status}`);
x = await call("GET", `/api/rfqs/${rfq}`);
step("request status picked", x.j.rfq?.status === "picked", `status=${x.j.rfq?.status}`);
step("trade-in on the request is a complete record", Array.isArray(x.j.rfq?.tradeIn?.options) && x.j.rfq.tradeIn.conditionBand && x.j.rfq.tradeIn.titleStatus, "");

if (!NO_CHAT) {
  x = await call("POST", `/api/rfqs/${rfq}/invites/${inv}/messages`, { kind: "message", from: "dealer", text: "Happy to hold the car until Friday." });
  step("chat: clean dealer message delivered", x.status === 200 && !["blocked", "held", "needs_review"].includes(x.j.status), `HTTP ${x.status} ${x.j.status}`);
  x = await call("POST", `/api/rfqs/${rfq}/invites/${inv}/messages`, { kind: "message", from: "dealer", text: "call me at 973-555-0142 or email sales@example.com" });
  step("chat: phone+email message blocked/held", x.status === 200 && ["blocked", "held", "needs_review"].includes(x.j.status), `HTTP ${x.status} ${x.j.status}`);
}
console.log(JSON.stringify({ rfq, inv, draft: d.draft.id, summary: results.length + " steps passed" }));
