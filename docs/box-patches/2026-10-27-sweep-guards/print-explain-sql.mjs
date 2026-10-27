// Prints EXPLAIN UPDATE statements (read-only: EXPLAIN never changes a row) for the guarded sweep, built by the module that is installed on the box, with
// literal values, so STEPS.md can pipe them into mysql and check the plan before the client is switched on.
//   cd /opt/trimscout-deals/src && node /tmp/sweep-guards-stage/print-explain-sql.mjs | sudo mysql trimscout
const { parseSweepRequest, buildSweepStatement, buildMissStatements, buildFreshnessCountsStatement } = await import(process.env.SWEEP_MODULE || "/opt/trimscout-deals/src/inventorySweep.js");

const toInt = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);
const toStr = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const pad = (n) => String(n).padStart(2, "0");
const lit = (v) => {
  if (v instanceof Date) return `'${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}'`;
  if (Array.isArray(v)) return `(${v.map(lit).join(", ")})`;
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/[^A-Za-z0-9_ .:-]/g, "")}'`;
};
// "IN (?)" takes the parenthesised list itself; every other "?" is one scalar. Placeholders are filled strictly left to right.
const fill = (sql, args) => { let i = 0; return sql.replace(/IN \(\?\)|\?/g, (m) => (m === "?" ? lit(args[i++]) : `IN ${lit(args[i++])}`)); };

const parsed = parseSweepRequest({
  dealerIds: [5100, 12225, 12226], seenAfter: new Date(Date.now() - 3600_000).toISOString(), sources: ["nightly"],
  sourceBox: "box2", foreignBefore: new Date(Date.now() - 48 * 3600_000).toISOString(),
  minMisses: 2, protectElsewhere: true, minFreshRatio: 0.5, minLiveForRatio: 10,
}, { toInt, toStr });
if (!parsed.ok) throw new Error(parsed.error);
for (const st of [buildSweepStatement(parsed), ...buildMissStatements(parsed)]) console.log(`EXPLAIN ${fill(st.sql, st.args)}\\G`);
const c = buildFreshnessCountsStatement(parsed);
console.log(`EXPLAIN ${fill(c.sql, c.args)}\\G`);
