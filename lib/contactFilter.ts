/**
 * The buyer search's "Dealer contact on file" filter. The set of dealers it keeps is decided HERE, by the same shared function behind
 * the search Contact column (contactStatus -> isReachableState) and Step 3's desk lookup, so the three cannot drift: a dealer is in the
 * set exactly when the Contact column would say Yes for one of its cars (a reachable email, named or not: isReachableState). The box
 * (deals-api) only applies the resulting id list.
 */
import type { Dealership } from "./dealershipsApi";
import { contactStatus, type ContactIndex } from "./dealerContactIndex";

/** Test dealers (audit harness) never appear in buyer results. The directory API already leaves them out; this is the belt to that brace. */
function isTestDealer(r: Dealership): boolean {
  return Boolean((r as { isTest?: boolean }).isTest);
}

/** Directory row ids whose cars pass the filter, ascending. Resolves each row the way a vehicle of that dealer is resolved on /search. */
export function contactOnFileDealerIds(index: ContactIndex): string[] {
  const ids: string[] = [];
  for (const rows of index.values()) {
    for (const r of rows) {
      if (isTestDealer(r)) continue;
      if (contactStatus(index, { dealerId: r.id, dealerName: r.dealerName, dealerState: r.state }) === true) ids.push(r.id);
    }
  }
  return ids.sort((a, b) => Number(a) - Number(b));
}

/**
 * The page-side half of the filter. The box can only apply a dealer-id list, so a car whose dealer id is missing or not in the directory
 * is judged there by id alone, while the Contact column resolves it by name + state. The rows the search returns already carry the
 * column's answer (dealerHasContact, from isReachableState); with the filter on, only rows where that answer is Yes stay, so the column
 * and the filter cannot disagree on a row. Unknown (null) is not Yes.
 */
export function rowsPassingContactFilter<T extends { dealerHasContact?: boolean | null }>(rows: T[], filterOn: boolean): T[] {
  return filterOn ? rows.filter((r) => r.dealerHasContact === true) : rows;
}
