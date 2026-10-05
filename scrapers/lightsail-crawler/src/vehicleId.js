// Stable numeric vehicle id: one integer per VIN, shared by every dealer_inventory row of that VIN.
//
// dealer_inventory is keyed (vin, dealer_id) because one car can be listed at several stores, so the id cannot be an
// AUTO_INCREMENT on that table. It lives in its own registry, vehicle_ids (vehicle_id AUTO_INCREMENT, vin UNIQUE),
// and dealer_inventory.vehicle_id is a copy written at upsert time:
//   - a VIN never seen before gets the next id;
//   - a VIN already registered keeps its id (the upsert only fills vehicle_id when it is NULL);
//   - registry rows are never deleted or updated, so an id is never reused.
// Ids never repeat; they are not promised to be gap-free.

export const VEHICLE_IDS_DDL = `CREATE TABLE IF NOT EXISTS vehicle_ids (
    vehicle_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    vin CHAR(17) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (vehicle_id),
    UNIQUE KEY uq_vehicle_ids_vin (vin)
  ) ENGINE=InnoDB`;

// Nullable, no default, no index: an instant metadata-only ALTER on MariaDB 10.3+ (the live table is ~3.2M rows). Rows written before
// this column existed stay NULL until the backfill script fills them.
export const VEHICLE_ID_COLUMN_DDL = "ADD COLUMN IF NOT EXISTS vehicle_id INT UNSIGNED NULL";

const READ_CHUNK = 500;

/**
 * Returns Map<vin, vehicleId> for every VIN given (VINs must already be trimmed and upper-cased), registering the ones
 * that are new. Only VINs missing from the registry are INSERTed: in steady state nearly every VIN already exists, so the
 * nightly sync's ~270k-640k rows per box become reads, not a few hundred thousand pointless duplicate-key INSERT IGNOREs.
 * Two writers racing on the same new VIN is safe: the UNIQUE key lets one INSERT win and the follow-up read returns its id.
 */
export async function resolveVehicleIds(pool, vins) {
  const unique = [...new Set(vins)].sort(); // sorted: concurrent writers take unique-index locks in the same order
  const ids = new Map();
  const read = async (list) => {
    for (let i = 0; i < list.length; i += READ_CHUNK) {
      const [rows] = await pool.query("SELECT vin, vehicle_id FROM vehicle_ids WHERE vin IN (?)", [list.slice(i, i + READ_CHUNK)]);
      for (const r of rows) ids.set(r.vin, Number(r.vehicle_id));
    }
  };
  await read(unique);
  const missing = unique.filter((v) => !ids.has(v));
  if (missing.length) {
    await pool.query("INSERT IGNORE INTO vehicle_ids (vin) VALUES ?", [missing.map((v) => [v])]);
    await read(missing);
  }
  const unresolved = unique.filter((v) => !ids.has(v));
  if (unresolved.length) throw new Error(`vehicle id registry returned no id for ${unresolved.length} VIN(s), e.g. ${unresolved[0]}`);
  return ids;
}
