// Applies scripts/box/2026-10-08-rfq-trade-in.sh to a copy of the repo's box-server mirror, then runs the new
// handlers against an in-memory fake pool. Covers what can only be proven on the box side: the six-photo rule
// the client can't skip, the one-notice-per-change-batch rule, and the photo-request round trip.
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const REQUIRED = ["front", "rear", "driver_side", "passenger_side", "odometer", "interior"];
const photos = (rfqId: string, slots = REQUIRED) => slots.map((slot) => ({ slot, required: REQUIRED.includes(slot), storageKey: `trade/${rfqId}/${slot}.jpg`, width: 2048, height: 1536 }));

type Row = Record<string, any>;
function makeEnv(patched: string) {
  const db = { rfq: { id: 7, status: "collecting", trade_in_json: null as string | null, trade_in_expected: null as number | null } as Row, invites: [] as Row[] };
  const calls: Array<{ status: number; body: any }> = [];
  const pool = {
    async query(sql: string, params: any[] = []) {
      if (/^SELECT \* FROM rfq_requests/.test(sql)) return [[db.rfq]];
      if (/^SELECT \* FROM rfq_invites WHERE id = \? AND rfq_id = \?/.test(sql)) return [db.invites.filter((i) => i.id === params[0])];
      if (/^SELECT id, status, trade_seen_at/.test(sql)) return [db.invites];
      if (/^SELECT id, trade_photo_request_json FROM rfq_invites/.test(sql)) return [db.invites.filter((i) => i.trade_photo_request_json)];
      if (/^UPDATE rfq_requests SET trade_in_json = \?, trade_in_expected = 1/.test(sql)) { db.rfq.trade_in_json = params[0]; db.rfq.trade_in_expected = 1; return [{}]; }
      if (/^UPDATE rfq_requests SET trade_in_json = \?/.test(sql)) { db.rfq.trade_in_json = params[0]; return [{}]; }
      if (/^UPDATE rfq_invites SET trade_photos_notified_at = NOW\(\)/.test(sql)) { db.invites.find((i) => i.id === params[0])!.trade_photos_notified_at = new Date(); return [{}]; }
      if (/^UPDATE rfq_invites SET trade_appraisal_json/.test(sql)) { db.invites.find((i) => i.id === params[1])!.trade_appraisal_json = params[0]; return [{}]; }
      if (/^UPDATE rfq_invites SET trade_photo_request_json/.test(sql)) { db.invites.find((i) => i.id === params[1])!.trade_photo_request_json = params[0]; return [{}]; }
      if (/^UPDATE rfq_invites SET trade_seen_at = NOW\(\)/.test(sql)) { db.invites.find((i) => i.id === params[0])!.trade_seen_at = new Date(Date.now() + 1000); return [{}]; }
      throw new Error("unexpected SQL: " + sql);
    },
  };
  // Pull the new helpers + handlers out of the patched file and bind them to stubs.
  const start = patched.indexOf("const TRADE_REQUIRED_SLOTS");
  const end = patched.indexOf("// POST /api/rfqs/:id/invites/:inviteId/buyer-counter");
  const src = patched.slice(start, end);
  const parseJsonCol = (v: any) => (v == null || v === "" ? null : typeof v !== "string" ? v : JSON.parse(v));
  const factory = new Function("getPool", "ensureQuotePackageColumns", "readBody", "sendJson", "badRequest", "parseJsonCol", "loadRfqInvitesWithQuotes", "publicRfqRequest",
    `${src}; return { handleRfqTradeIn, handleRfqTradePhotos, handleTradeAppraisal, handleTradePhotoRequest, handleTradePhotoRequestsFulfil, handleTradeSeen, tradePhotosProblem };`);
  let body: any = {};
  const h = factory(() => pool, async () => undefined, async () => body, (_res: any, status: number, b: any) => calls.push({ status, body: b }), (_res: any, msg: string) => calls.push({ status: 400, body: { error: msg } }), parseJsonCol, async () => [], (row: Row) => ({ id: String(row.id), tradeIn: parseJsonCol(row.trade_in_json) }));
  const call = async (fn: string, b: any, ...args: any[]) => { body = b; calls.length = 0; await h[fn]({}, {}, ...args); return calls[0]; };
  return { db, call, h };
}

describe("box patch: rfq trade-in", () => {
  let patched = "";
  before(() => {
    const dir = mkdtempSync(join(tmpdir(), "boxpatch-"));
    const copy = join(dir, "deals_api_server.js");
    copyFileSync(join(ROOT, "scrapers/lightsail-crawler/src/deals_api_server.js"), copy);
    const run = () => execFileSync("bash", [join(ROOT, "scripts/box/2026-10-08-rfq-trade-in.sh")], { env: { ...process.env, TEST_ONLY: "1", FILE: copy }, encoding: "utf8" });
    assert.match(run(), /applied: columns, invite mapper, request mapper, handlers, routes/);
    assert.match(run(), /applied: nothing \(already present\)/, "idempotent");
    patched = readFileSync(copy, "utf8");
  });

  it("wires the columns, mappers and routes", () => {
    for (const needle of ["trade_in_json MEDIUMTEXT", "trade_appraisal_json TEXT", "tradeAppraisal: parseJsonCol", "tradeIn: parseJsonCol(row.trade_in_json)", "/trade-in\\/photos$/", "/trade-photo-requests\\/fulfil$/", "trade-appraisal|trade-photo-request|trade-seen"]) assert.ok(patched.includes(needle), needle);
  });

  it("refuses a trade-in with fewer than 6 required photos (422), whatever the client sent", async () => {
    const { call, db } = makeEnv(patched);
    const bad = await call("handleRfqTradeIn", { tradeIn: { photos: photos("7", REQUIRED.slice(0, 5)) } }, 7);
    assert.equal(bad.status, 422); assert.match(bad.body.error, /missing interior/); assert.equal(db.rfq.trade_in_json, null);
    const ok = await call("handleRfqTradeIn", { tradeIn: { photos: photos("7") } }, 7);
    assert.equal(ok.status, 200); assert.ok(db.rfq.trade_in_json);
  });
  it("refuses duplicate/unknown slots and photo keys outside the request", async () => {
    const { h } = makeEnv(patched);
    assert.match(h.tradePhotosProblem("7", [...photos("7"), photos("7", ["front"])[0]]), /duplicate/);
    assert.match(h.tradePhotosProblem("7", [...photos("7"), { slot: "trunk", storageKey: "trade/7/trunk.jpg" }]), /unknown/);
    assert.match(h.tradePhotosProblem("7", photos("8")), /outside this request/);
    assert.equal(h.tradePhotosProblem("7", [...photos("7"), ...photos("7", ["damage_1"] as any)]), null);
  });
  it("replacing a photo can't drop below 6 required, and is refused once the request is closed", async () => {
    const e = makeEnv(patched);
    await e.call("handleRfqTradeIn", { tradeIn: { photos: photos("7") } }, 7);
    assert.equal((await e.call("handleRfqTradePhotos", { photos: photos("7", REQUIRED.slice(1)) }, 7)).status, 422);
    assert.equal((await e.call("handleRfqTradePhotos", { photos: [...photos("7"), ...photos("7", ["tire_tread"] as any)] }, 7)).status, 200);
    e.db.rfq.status = "picked";
    assert.equal((await e.call("handleRfqTradePhotos", { photos: photos("7") }, 7)).status, 409, "locked once a quote is picked");
  });

  it("notifies each invited dealer ONCE per batch of photo changes; again only after they've looked", async () => {
    const e = makeEnv(patched);
    e.db.invites.push({ id: 1, status: "invited" }, { id: 2, status: "quoted" }, { id: 3, status: "declined" });
    await e.call("handleRfqTradeIn", { tradeIn: { photos: photos("7") } }, 7);
    const first = await e.call("handleRfqTradePhotos", { photos: photos("7") }, 7);
    assert.deepEqual(first.body.notifyInviteIds, ["1", "2"], "declined desks are never notified");
    const second = await e.call("handleRfqTradePhotos", { photos: photos("7") }, 7);
    assert.deepEqual(second.body.notifyInviteIds, [], "a second change before they looked earns nothing");
    await e.call("handleTradeSeen", {}, 7, 1);
    const third = await e.call("handleRfqTradePhotos", { photos: photos("7") }, 7);
    assert.deepEqual(third.body.notifyInviteIds, ["1"], "desk 1 looked, so a new change earns a new notice; desk 2 didn't");
  });

  it("appraisal: > 0, single or range, preliminary|firm, good-until; stored per desk; refused for a declined desk", async () => {
    const e = makeEnv(patched);
    e.db.invites.push({ id: 1, status: "quoted" }, { id: 3, status: "declined" });
    await e.call("handleRfqTradeIn", { tradeIn: { photos: photos("7") } }, 7);
    const base = { basis: "preliminary", goodUntil: "2026-12-01T00:00:00Z" };
    assert.equal((await e.call("handleTradeAppraisal", { appraisal: { ...base, allowanceSingle: 0 } }, 7, 1)).status, 400);
    assert.equal((await e.call("handleTradeAppraisal", { appraisal: { ...base, allowanceLow: 20000, allowanceHigh: 16000 } }, 7, 1)).status, 400);
    assert.equal((await e.call("handleTradeAppraisal", { appraisal: { ...base, allowanceSingle: 5000, basis: "maybe" } }, 7, 1)).status, 400);
    assert.equal((await e.call("handleTradeAppraisal", { appraisal: { ...base, allowanceSingle: 18000 } }, 7, 1)).status, 200);
    assert.equal(JSON.parse(e.db.invites[0].trade_appraisal_json).allowanceSingle, 18000);
    assert.equal((await e.call("handleTradeAppraisal", { appraisal: { ...base, allowanceSingle: 18000 } }, 7, 3)).status, 409);
  });

  it("photo-request round trip: ask (optional slots only) → one open at a time → fulfilled when the buyer adds those photos", async () => {
    const e = makeEnv(patched);
    e.db.invites.push({ id: 1, status: "quoted" }, { id: 2, status: "invited" });
    await e.call("handleRfqTradeIn", { tradeIn: { photos: photos("7") } }, 7);
    assert.equal((await e.call("handleTradePhotoRequest", { photoRequest: { slots: ["front"] } }, 7, 1)).status, 400, "core six are never requestable");
    assert.equal((await e.call("handleTradePhotoRequest", { photoRequest: { slots: [] } }, 7, 1)).status, 400, "an empty ask is refused");
    assert.equal((await e.call("handleTradePhotoRequest", { photoRequest: { slots: ["tire_tread", "damage_1"], note: "curb rash?" } }, 7, 1)).status, 200);
    assert.equal(JSON.parse(e.db.invites[0].trade_photo_request_json).status, "open");
    assert.equal((await e.call("handleTradePhotoRequest", { photoRequest: { slots: ["rear_cargo"] } }, 7, 1)).status, 409, "one open ask per desk");
    // The buyer adds one of the two → still open.
    await e.call("handleRfqTradePhotos", { photos: [...photos("7"), ...photos("7", ["tire_tread"] as any)] }, 7);
    await e.call("handleTradePhotoRequestsFulfil", { slots: ["tire_tread"] }, 7);
    assert.equal(JSON.parse(e.db.invites[0].trade_photo_request_json).status, "open");
    // …then the second → fulfilled, with a timestamp.
    await e.call("handleRfqTradePhotos", { photos: [...photos("7"), ...photos("7", ["tire_tread", "damage_1"] as any)] }, 7);
    const done = await e.call("handleTradePhotoRequestsFulfil", { slots: ["damage_1"] }, 7);
    assert.equal(done.body.closed, 1);
    const stored = JSON.parse(e.db.invites[0].trade_photo_request_json);
    assert.equal(stored.status, "fulfilled"); assert.ok(stored.fulfilledAt);
  });
});
