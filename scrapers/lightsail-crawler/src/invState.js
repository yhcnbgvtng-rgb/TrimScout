// The crawl's own state on a vehicle record -> the 2-letter code dealer_inventory.state stores, or null.
// Only ever a fallback: the directory's state wins whenever the row has a matched store (trg_inv_rev_insert/update).
export function normalizeState(v) {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(s) ? s : null;
}
