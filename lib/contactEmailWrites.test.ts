import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  bulkUpsertDealerships,
  createDealership,
  updateDealership,
  DealershipsApiError,
  type DealershipInput,
} from "./dealershipsApi";

function input(over: Partial<DealershipInput> = {}): DealershipInput {
  return { dealerName: "Plain Motors", address: null, city: null, state: "NJ", zipCode: null, phone: null, contactName: null, contactEmail: "jdoe@plainmotors.com", notes: null, website: null, domains: [], ...over };
}

describe("contact writes refuse addresses the quote flow could never use", () => {
  const realFetch = globalThis.fetch;
  const sent: Array<{ url: string; body: any }> = [];
  beforeEach(() => {
    sent.length = 0;
    process.env.LIGHTSAIL_API_KEY = "test-key";
    process.env.LIGHTSAIL_HOST = "127.0.0.1";
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      sent.push({ url: String(url), body });
      const json = String(url).endsWith("/bulk") ? { created: 0, updated: body.dealerships.length, skipped: 0, total: body.dealerships.length } : { dealership: { id: "1", dealerName: "Plain Motors", domains: [] } };
      return new Response(JSON.stringify(json), { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  for (const bad of ["accessibility@hmausa.com", "info@plainmotors.com", "customerservice@plainmotors.com", "bdc@plainmotors.com", "parts@plainmotors.com", "service@plainmotors.com", "noreply@plainmotors.com", "x@leadcrm.com", "x@eleadtrack.net", "x@dealeremail.com", "logo@2x.png", "ruben@houstonhyundai"]) {
    it(`create and update reject ${bad}`, async () => {
      await assert.rejects(createDealership(input({ contactEmail: bad })), (e: unknown) => e instanceof DealershipsApiError && e.status === 400 && /Contact email rejected/.test(e.message));
      await assert.rejects(updateDealership("7", input({ contactEmail: bad })), (e: unknown) => e instanceof DealershipsApiError && e.status === 400);
      assert.equal(sent.length, 0, "nothing reaches the box");
    });
  }

  it("create and update accept a good address and a blank one", async () => {
    await createDealership(input());
    await updateDealership("7", input({ contactEmail: "" }));
    assert.equal(sent.length, 2);
  });

  it("bulk import keeps the row but drops a refused email, and says how many", async () => {
    const result = await bulkUpsertDealerships([
      { dealerName: "A", contactEmail: "jdoe@a.com" },
      { dealerName: "B", contactEmail: "accessibility@hmausa.com" },
      { dealerName: "C", contactEmail: "logo@2x.png" },
      { dealerName: "D" },
    ]);
    const rows = sent[0].body.dealerships as Array<{ dealerName: string; contactEmail?: string | null }>;
    assert.deepEqual(rows.map((r) => [r.dealerName, r.contactEmail ?? null]), [["A", "jdoe@a.com"], ["B", null], ["C", null], ["D", null]]);
    assert.equal(result.emailsRejected, 2);
  });

  it("bulk import with nothing to refuse reports no rejection count", async () => {
    const result = await bulkUpsertDealerships([{ dealerName: "A", contactEmail: "jdoe@a.com" }]);
    assert.equal(result.emailsRejected, undefined);
  });
});

describe("the box server applies the same rule", () => {
  const src = fs.readFileSync(new URL("../scrapers/lightsail-crawler/src/auth_api_server.js", import.meta.url), "utf8");
  it("imports the shared check and calls it on create, update and bulk", () => {
    assert.match(src, /from "\.\/quoteReachable\.js"/);
    for (const handler of ["handleBulkUpsertDealerships", "handleCreateDealership", "handleUpdateDealership"]) {
      const start = src.indexOf(`async function ${handler}`);
      assert.ok(start > 0, handler);
      assert.match(src.slice(start, start + 2200), /contactEmailWriteProblem\(/, handler);
    }
  });
});
