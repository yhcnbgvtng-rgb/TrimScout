import { inventoryVin, inventoryVinSuffix, type InventoryVehicle } from "./inventoryApi";
import { loadContactIndex } from "./dealerContactIndex";
import { collapseByVin } from "./onePerVin";
import { toBuyerVehicle, type BuyerVehicle } from "./buyerSearch";
import type { VinQuery } from "./inventoryVinQuery";

/**
 * Cars in current inventory (not removed) for a normalized VIN query. A full VIN uses the box's existing exact-VIN endpoint;
 * the last 6-8 characters use /api/inventory/vin-search (docs/box-patches/2026-10-31-vin-search), which a box without that patch
 * answers with a 404 that inventoryApi turns into an error. One row per VIN, shaped like a buyer search row (no seen dates).
 */
export async function findByVin(q: Extract<VinQuery, { ok: true }>): Promise<{ vehicles: BuyerVehicle[]; truncated: boolean }> {
  let rows: InventoryVehicle[];
  let truncated = false;
  if (q.kind === "full") {
    rows = (await inventoryVin(q.vin)).listings;
  } else {
    const r = await inventoryVinSuffix(q.vin);
    rows = r.vehicles;
    truncated = r.truncated;
  }
  const current = rows.filter((v) => !v.removedAt);
  const contacts = await loadContactIndex();
  const vehicles = collapseByVin(current, null).rows.map((v) => toBuyerVehicle(v, null, contacts));
  return { vehicles, truncated };
}
