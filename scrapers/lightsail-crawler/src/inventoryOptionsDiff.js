// Decides which vehicles' factory-option facet rows (dealer_inventory_options) actually need rewriting on
// an upsert — pure, so it can be unit-tested without a database.
//
// handleInventoryBulk used to DELETE and re-INSERT every vehicle's whole option set on every nightly upsert,
// whether or not anything had changed. Measured from the 2026-09-30 box2 sync log: 283,873 vehicles carried
// options that night, 3,707,758 facet rows — written, deleted and written again, ~7.4M row operations on a
// two-index table, per box, per night, against ~0.7M main-table upserts. A vehicle's dealer-listed options
// almost never change from one night to the next, so almost all of that is rewriting identical data.
//
// The fix is a diff, not a skip: the rows a vehicle SHOULD have (derived from tonight's payload by the same
// rules as before) are compared with the rows it HAS, and only vehicles whose sets differ are replaced, with
// the exact DELETE + INSERT that always did it. The end state is identical to rewriting everything; when
// the derivation rules change (an allowlist, a new junk filter) the comparison simply finds differences and
// rewrites them — there is no version marker to forget to bump.

const sameText = (a, b) => (a == null ? "" : String(a)) === (b == null ? "" : String(b));

export const pairKey = (vin, dealerId) => `${vin}|${dealerId}`;

/**
 * Group rows read back from dealer_inventory_options by vehicle.
 * @param {{vin: string, dealer_id: number, canonical_key: string, label: string, code: string|null}[]} dbRows
 * @returns {Map<string, {key: string, label: string, code: string|null}[]>} keyed by pairKey(vin, dealer_id)
 */
export function groupExistingOptionRows(dbRows) {
  const byPair = new Map();
  for (const r of dbRows) {
    const k = pairKey(r.vin, r.dealer_id);
    let list = byPair.get(k);
    if (!list) byPair.set(k, (list = []));
    list.push({ key: r.canonical_key, label: r.label, code: r.code ?? null });
  }
  return byPair;
}

/** True when the two sets hold the same keys with the same label and code (order-insensitive). */
export function optionSetsEqual(existing, desired) {
  if (existing.length !== desired.length) return false;
  const byKey = new Map();
  for (const e of existing) byKey.set(e.key, e);
  if (byKey.size !== existing.length) return false;
  for (const d of desired) {
    const e = byKey.get(d.key);
    if (!e || !sameText(e.label, d.label) || !sameText(e.code, d.code)) return false;
  }
  return true;
}

/**
 * @param {{ pair: string, rows: {key: string, label: string, code: string|null}[] }[]} desired per vehicle: the facet rows tonight's payload yields
 * @param {Map<string, {key: string, label: string, code: string|null}[]>} existing from groupExistingOptionRows (a vehicle with no rows is simply absent)
 * @returns {{ changed: string[], unchanged: number }} pairKeys that need the DELETE + INSERT, and how many were left alone
 */
export function diffOptionSets(desired, existing) {
  const changed = [];
  let unchanged = 0;
  for (const d of desired) {
    if (optionSetsEqual(existing.get(d.pair) || [], d.rows)) unchanged++;
    else changed.push(d.pair);
  }
  return { changed, unchanged };
}
