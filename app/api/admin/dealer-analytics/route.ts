import { getDealersTable } from "@/lib/dealerAnalyticsAdminRoute";

export const dynamic = "force-dynamic";

/** Admin-only Dealer Analytics table: one row per dealer from the nightly run. `?includeBuckets=1` shows the dealer-group buckets too; `?day=` picks a finished run. */
export async function GET(req: Request) {
  return getDealersTable(req);
}
