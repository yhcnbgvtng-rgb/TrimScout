// Backfill of dealer_inventory.vehicle_id for rows written before the id existed (see vehicleId.js). Used by
// scripts/box/2026-10-04-backfill-vehicle-id.mjs; kept here so the batch logic is unit-tested without a database.
//
// Resumable by construction: every batch only touches rows whose vehicle_id IS NULL, so a stopped or crashed run is
// continued by running it again (a saved cursor merely skips the already-finished prefix). Running it twice is harmless.
import { resolveVehicleIds } from "./vehicleId.js";

/** The next `limit` VINs after `afterVin` (in primary-key order) that still have at least one row without an id. */
export async function nextVinsWithoutId(pool, afterVin, limit) {
  // FORCE INDEX (PRIMARY): walks the table in (vin, dealer_id) order from the cursor and stops after `limit` VINs. Never a scan of the whole table per batch.
  const [rows] = await pool.query(
    "SELECT DISTINCT vin FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE vin > ? AND vehicle_id IS NULL ORDER BY vin LIMIT ?",
    [afterVin, limit]);
  return rows.map((r) => r.vin);
}

export const BACKFILL_UPDATE_SQL =
  "UPDATE dealer_inventory i FORCE INDEX (PRIMARY) JOIN vehicle_ids v ON v.vin = i.vin SET i.vehicle_id = v.vehicle_id WHERE i.vin IN (?) AND i.vehicle_id IS NULL";

/**
 * One batch: register the VINs that are new, then copy the registry id onto every still-NULL row of those VINs
 * (all stores that list the VIN get the same id). Returns the cursor to continue from.
 */
export async function backfillBatch(pool, afterVin, limit) {
  const vins = await nextVinsWithoutId(pool, afterVin, limit);
  if (!vins.length) return { vins: 0, updated: 0, nextCursor: afterVin, done: true };
  await resolveVehicleIds(pool, vins);
  const [res] = await pool.query(BACKFILL_UPDATE_SQL, [vins]);
  return { vins: vins.length, updated: Number(res.affectedRows), nextCursor: vins[vins.length - 1], done: vins.length < limit };
}
