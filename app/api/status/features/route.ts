export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { publicFeatureStatus } from "@/lib/featureFlags";

// The app's degrade-banner hook: which conversion switches are on, and the
// one line to show when one isn't. Public, tiny, edge-cacheable for 30s.
export async function GET() {
  return NextResponse.json(publicFeatureStatus(), { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" } });
}
