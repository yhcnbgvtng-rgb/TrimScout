/**
 * What happens to saved picks when the search page loads (pure; the hook in components/search/useBuyerSearchState.ts
 * does the storage and network). Same rules for a guest (this browser) and a signed-in buyer (their account):
 *   1. choose which copy wins — a local clear/remove the account never heard about beats the account's older copy;
 *   2. picks saved before expiry existed are stamped "saved now" (they get a fresh 7 days, they are not deleted);
 *   3. picks saved more than 7 days ago are dropped.
 * The car-no-longer-listed check needs the network, so it is a second step (dropGone in lib/buyerPicks.ts).
 */
import { dropExpired, stampSaved, type BuyerSearchState, type PickedVehicle } from "@/lib/buyerPicks";

export interface Reconciled {
  state: BuyerSearchState;
  expired: PickedVehicle[];
  /** The account store should be written with `state.picks` (a local change it never received, or picks that were dropped). */
  pushToAccount: boolean;
}

export function reconcileLoaded({ local, server, now }: { local: BuyerSearchState; server: BuyerSearchState | null; now: number }): Reconciled {
  let picks = local.picks;
  let pushToAccount = false;
  if (server) {
    const serverNewest = server.picks.reduce((m, p) => Math.max(m, p.savedAt ?? 0), 0);
    const localEdited = local.picksEditedAt ?? 0;
    if (localEdited > 0 && localEdited > serverNewest) {
      // The buyer cleared / removed / saved here after the account's copy was written, and the account never got it.
      picks = local.picks;
      pushToAccount = server.picks.length !== local.picks.length || server.picks.some((p) => !local.picks.some((q) => q.key === p.key));
    } else {
      picks = server.picks.length ? server.picks : local.picks;
    }
  }
  // Picks the account holds without a save time (saved before expiry existed) get stamped now; push that back so the clock
  // starts once, not on every load.
  if (server && picks === server.picks && picks.some((p) => !p.savedAt)) pushToAccount = true;
  const stamped = stampSaved(picks, now);
  const { live, expired } = dropExpired(stamped, now);
  if (expired.length > 0 && server) pushToAccount = true;
  const viewed = Array.from(new Set([...(server?.viewed ?? []), ...local.viewed]));
  return { state: { picks: live, viewed, picksEditedAt: local.picksEditedAt ?? null }, expired, pushToAccount };
}
