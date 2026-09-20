#!/usr/bin/env node
// Persistent HTTP server for the Lightsail box: serves the crawler's most
// recent output as CSV at GET /export.csv, in the exact column format the
// Vercel app's /api/lightsail route already expects (app/api/lightsail/route.ts
// parses this by fixed column position, not by header name — see that file
// before changing the column order here).
//
// This is a separate, long-running process from the crawler itself. The
// crawler (standalone.js) runs periodically (e.g. via cron) and writes one
// shard per state under data/inventory/<state>.json (see
// inventory_shards.js) instead of one nationwide file — this server reads
// every shard fresh on every request and concatenates them, so restarting
// the crawler never requires restarting this, and the shape of what this
// endpoint returns hasn't changed even though the storage underneath it
// has (app/api/lightsail/route.ts on the Vercel side still gets the same
// flat, nationwide array of records).
//
// Run persistently, e.g.:
//   nohup node src/export_server.js > export_server.log 2>&1 &
// or under pm2:
//   pm2 start src/export_server.js --name porsche-export
//
// Also requires port 3000 to be open in the Lightsail instance's
// Networking tab (firewall) — it is not open by default.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { readAllInventoryShards, inventoryShardsDir } from "./inventory_shards.js";

const PORT = process.env.EXPORT_SERVER_PORT || 3000;

// Most recent mtime across every state's shard — stands in for the old
// single DATA_PATH's own mtime in the /health check below.
async function latestShardMtime() {
  const dir = inventoryShardsDir(process.cwd());
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return null;
  }
  let latest = null;
  for (const file of files) {
    try {
      const stat = await fs.stat(path.join(dir, file));
      if (!latest || stat.mtime > latest) latest = stat.mtime;
    } catch {
      // skip
    }
  }
  return latest;
}

const CSV_COLUMNS = [
  "vin", "dealerName", "state", "inventoryType", "year", "make", "model",
  "trim", "price", "oldPrice", "priceDiff", "mileage", "status",
  "changeType", "daysOnLot", "firstSeen", "lastSeen", "url",
];

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(records) {
  const header = CSV_COLUMNS.join(",");
  const rows = records.map((r) =>
    CSV_COLUMNS.map((col) => csvEscape(r[col])).join(",")
  );
  return [header, ...rows].join("\n");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/export.csv") {
    try {
      const records = await readAllInventoryShards(process.cwd());
      const csv = toCsv(records);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(csv);
      console.log(`${new Date().toISOString()} GET /export.csv -> 200 (${records.length} records)`);
    } catch (err) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end(`Inventory data not available: ${err.message}`);
      console.error(`${new Date().toISOString()} GET /export.csv -> 503: ${err.message}`);
    }
    return;
  }

  if (url.pathname === "/health") {
    let count = 0;
    let lastModified = null;
    try {
      const mtime = await latestShardMtime();
      lastModified = mtime ? mtime.toISOString() : null;
      count = (await readAllInventoryShards(process.cwd())).length;
    } catch {
      // no shards present yet
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", recordCount: count, dataLastModified: lastModified }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found. Try /export.csv or /health");
});

server.listen(PORT, () => {
  console.log(`Export server listening on port ${PORT}`);
  console.log(`  GET /export.csv - inventory as CSV`);
  console.log(`  GET /health     - status check`);
  console.log(`Reading shards from: ${inventoryShardsDir(process.cwd())}`);
});
