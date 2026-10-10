// Buyer dropdown counts without wholesale lots. The buyer search leaves cond = 'wholesale' cars out of its results (inventoryListQuery
// retailOnly=1); the State / Make / Model / Trim dropdown counts must agree with those results, or a make shows "Mercedes-Benz (4,100)" and
// the list under it has 1,300 cars.
//
// Why a subtraction and not a WHERE clause: the facet queries are index-only GROUP BYs over indexes that do not contain `cond`
// (idx_inv_facet_make_state_model etc.) and a cond predicate forces a row lookup for every counted row — the shape that already blew the 20 s
// statement cap on Ford (187k rows). Wholesale cars are ~1.5% of stock (24,254 of 2.2M, 532 dealers), so the counts are computed exactly as
// before and the wholesale cars are subtracted bucket by bucket from a small cached aggregate (make, state, model, trim -> n).
// Pure: no I/O.

/** @typedef {{ make: string|null, state: string|null, model: string|null, trim: string|null, n: number }} WholesaleBucket */

const sumBy = (rows, keyOf, keep) => {
  const m = new Map();
  for (const r of rows) { if (!keep(r)) continue; const k = keyOf(r); if (k == null || k === "") continue; m.set(k, (m.get(k) || 0) + Number(r.n || 0)); }
  return m;
};
const subtract = (list, key, take) => {
  if (!take.size) return list;
  const out = [];
  list.forEach((row, i) => { const n = Number(row.n) - (take.get(row[key]) || 0); if (n > 0) out.push({ row: { ...row, n }, i }); });
  return out.sort((a, b) => b.row.n - a.row.n || a.i - b.i).map((x) => x.row);
};

/**
 * @param {{ states: Array<{state:string,n:number}>, makes: Array<{make:string,n:number}>, models: Array<{model:string,n:number}>, trims: Array<{trim:string,n:number}> }} lists
 * @param {WholesaleBucket[]} wholesale
 * @param {{ state?: string, make?: string, model?: string }} f  the same scoping the queries used: states by make; makes by state; models by make (+state); trims by make+model (+state)
 */
export function adjustFacetLists(lists, wholesale, f = {}) {
  const { state = "", make = "", model = "" } = f;
  const w = Array.isArray(wholesale) ? wholesale : [];
  return {
    states: subtract(lists.states, "state", sumBy(w, (r) => r.state, (r) => !make || r.make === make)),
    makes: subtract(lists.makes, "make", sumBy(w, (r) => r.make, (r) => !state || r.state === state)),
    models: make ? subtract(lists.models, "model", sumBy(w, (r) => r.model, (r) => r.make === make && (!state || r.state === state))) : lists.models,
    trims: make && model ? subtract(lists.trims, "trim", sumBy(w, (r) => r.trim, (r) => r.make === make && r.model === model && (!state || r.state === state))) : lists.trims,
  };
}

/** /api/inventory/makes: make counts across all states. */
export function adjustMakeList(makes, wholesale) {
  return subtract(makes, "make", sumBy(Array.isArray(wholesale) ? wholesale : [], (r) => r.make, () => true));
}

/** Dealer ids per query when the wholesale aggregate is read (each query is a small multi-range scan of idx_inv_by_dealer_covering). */
export const WHOLESALE_DEALERS_PER_QUERY = 10;
