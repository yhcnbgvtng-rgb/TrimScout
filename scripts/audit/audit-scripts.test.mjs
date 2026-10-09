// Tests for the audit cleanup + seed scripts (no database: `query` is faked).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLEANUP_TABLES, CLEANUP_WHERE, countSql, parseArgs, runCleanup, updateSql } from "./audit-cleanup.mjs";
import { TEST_DEALERS, seedTestDealers } from "./seed-test-dealers.mjs";

const fakeDb = (counts) => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    const t = CLEANUP_TABLES.find((x) => sql.includes(` ${x} `));
    if (sql.startsWith("SELECT COUNT")) return [[{ n: counts[t] ?? 0 }]];
    return [{ affectedRows: counts[t] ?? 0 }];
  };
  return { query, calls };
};
const quiet = () => {};

describe("cleanup: SQL only ever touches expired, un-deleted audit rows", () => {
  it("every statement carries the audit = 1 / not deleted / older-than-N-days predicate and sets only deleted_at", () => {
    assert.match(CLEANUP_WHERE, /audit = 1/);
    assert.match(CLEANUP_WHERE, /deleted_at IS NULL/);
    assert.match(CLEANUP_WHERE, /audit_at < \(NOW\(\) - INTERVAL \? DAY\)/);
    for (const t of CLEANUP_TABLES) {
      assert.ok(countSql(t).endsWith(CLEANUP_WHERE));
      assert.equal(updateSql(t), `UPDATE ${t} SET deleted_at = NOW() WHERE ${CLEANUP_WHERE}`);
      assert.doesNotMatch(updateSql(t), /DELETE FROM|audit = 0/);
    }
  });
  it("covers every audit-flagged table and refuses any other", () => {
    assert.deepEqual([...CLEANUP_TABLES].sort(), ["deal_bids", "deal_requests", "deals", "rfq_events", "rfq_invites", "rfq_quotes", "rfq_requests"]);
    assert.throws(() => updateSql("users"), /unknown table/);
    assert.throws(() => countSql("dealership_contacts"), /unknown table/);
  });
});

describe("cleanup: dry run first", () => {
  it("default is a dry run: counts only, no UPDATE", async () => {
    const db = fakeDb({ rfq_requests: 3, deal_bids: 2 });
    const r = await runCleanup({ query: db.query, args: parseArgs([]), log: quiet });
    assert.equal(r.applied, false);
    assert.equal(r.total, 5);
    assert.ok(db.calls.every((c) => c.sql.startsWith("SELECT COUNT")));
    assert.ok(db.calls.every((c) => c.params[0] === 7), "7-day default");
  });
  it("--apply without a matching --expect-total refuses and writes nothing", async () => {
    for (const argv of [["--apply"], ["--apply", "--expect-total", "4"]]) {
      const db = fakeDb({ rfq_requests: 3, deal_bids: 2 });
      await assert.rejects(runCleanup({ query: db.query, args: parseArgs(argv), log: quiet }), /refusing to apply/);
      assert.ok(db.calls.every((c) => c.sql.startsWith("SELECT COUNT")));
    }
  });
  it("--apply --expect-total <dry-run total> soft-deletes only the tables that have rows", async () => {
    const db = fakeDb({ rfq_requests: 3, deal_bids: 2 });
    const r = await runCleanup({ query: db.query, args: parseArgs(["--apply", "--expect-total", "5"]), log: quiet });
    assert.equal(r.applied, true);
    const updates = db.calls.filter((c) => c.sql.startsWith("UPDATE"));
    assert.deepEqual(updates.map((c) => c.sql.split(" ")[1]).sort(), ["deal_bids", "rfq_requests"]);
  });
  it("argument parsing rejects junk", () => {
    assert.throws(() => parseArgs(["--days", "0"]), /--days/);
    assert.throws(() => parseArgs(["--hard-delete"]), /unknown argument/);
    assert.equal(parseArgs(["--days", "14"]).days, 14);
  });
});

describe("seed: three test dealerships, dry run first, never a real dealer", () => {
  it("defines exactly 3 distinctly named dealers on the reserved .test domain", () => {
    assert.equal(TEST_DEALERS.length, 3);
    assert.equal(new Set(TEST_DEALERS.map((d) => d.dealer_name)).size, 3);
    for (const d of TEST_DEALERS) {
      assert.match(d.dealer_name, /^AUDIT TEST Dealer \d$/);
      assert.match(d.contact_email, /@audit\.trimscout\.test$/);
    }
  });
  const seedDb = (existing = {}) => {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT id, is_test")) return [existing[params[0]] ? [existing[params[0]]] : []];
      if (sql.startsWith("SELECT COUNT")) return [[{ n: 3 }]];
      return [{}];
    };
    return { query, calls };
  };
  it("dry run inserts nothing", async () => {
    const db = seedDb();
    await seedTestDealers({ query: db.query, apply: false, log: quiet });
    assert.ok(!db.calls.some((c) => c.sql.startsWith("INSERT")));
  });
  it("apply inserts the missing ones with is_test = 1 and skips existing test rows", async () => {
    const db = seedDb({ "AUDIT TEST Dealer 2": { id: 5, is_test: 1 } });
    await seedTestDealers({ query: db.query, apply: true, log: quiet });
    const inserts = db.calls.filter((c) => c.sql.startsWith("INSERT"));
    assert.equal(inserts.length, 2);
    assert.ok(inserts.every((c) => /, 1\)$/.test(c.sql)));
    assert.ok(!inserts.some((c) => c.params[0] === "AUDIT TEST Dealer 2"));
  });
  it("aborts, writing nothing, if a REAL dealership already has one of these names", async () => {
    const db = seedDb({ "AUDIT TEST Dealer 1": { id: 9, is_test: 0 } });
    await assert.rejects(seedTestDealers({ query: db.query, apply: true, log: quiet }), /real dealership/);
    assert.ok(!db.calls.some((c) => c.sql.startsWith("INSERT")));
  });
});
