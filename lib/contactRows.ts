// Client-safe (no server imports): the page-side half of the contact filter. lib/contactFilter.ts re-exports it.

/**
 * The page-side half of the filter. The box can only apply a dealer-id list, so a car whose dealer id is missing or not in the directory
 * is judged there by id alone, while the Contact column resolves it by name + state. The rows the search returns already carry the
 * column's answer (dealerHasContact, from isReachableState); with the filter on, only rows where that answer is Yes stay, so the column
 * and the filter cannot disagree on a row. Unknown (null) is not Yes.
 */
export function rowsPassingContactFilter<T extends { dealerHasContact?: boolean | null }>(rows: T[], filterOn: boolean): T[] {
  return filterOn ? rows.filter((r) => r.dealerHasContact === true) : rows;
}
