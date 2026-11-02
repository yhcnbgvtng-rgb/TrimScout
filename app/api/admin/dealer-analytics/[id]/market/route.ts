import { getDealerMarket } from "@/lib/dealerAnalyticsAdminRoute";

export const dynamic = "force-dynamic";

/** Admin-only market comparison: this dealer's average price against the market average for the same make, model, year and condition. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return getDealerMarket(req, (await params).id);
}
