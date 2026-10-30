import { getDealerView } from "@/lib/dealerAnalyticsAdminRoute";

export const dynamic = "force-dynamic";

/** Admin-only per-dealer view: 90-day unit trend, make/model mix, age buckets and a paged price change log (`limit`, `offset`, `direction`, `day`). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return getDealerView(req, (await params).id);
}
