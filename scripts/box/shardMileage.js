// Shard files written before PR #384 hold `mileage: 0` for used/CPO listings whose page had no odometer (the old scrapers
// defaulted a missing odometer to 0). dealer_inventory upserts with COALESCE(VALUES(mileage), mileage), so a NULL leaves a
// cleaned row alone but a stale 0 would overwrite it — undoing the cleanup. Applied on READ, in memory: the shard files on
// disk are never rewritten by the sync.
//
// `condition` is inventory-sync.mjs's cond() output: 'new' | 'used' | 'cpo' | 'wholesale' | null. A used/CPO car is never
// really at exactly 0 miles, so 0 is treated as missing; every other value (including a stated 0 on a new car) is unchanged.
export function shardMileage(mileage, condition) {
  if ((condition === "used" || condition === "cpo") && (mileage === 0 || mileage === "0")) return null;
  return mileage;
}
