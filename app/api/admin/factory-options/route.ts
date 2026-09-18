import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { searchFactoryOptions } from "@/lib/factoryOptionCatalogStore";

/** Search factory options by name or code across every factory_verified build on file (Ford/GM/Genesis/Hyundai/Stellantis — the brands with a real OEM window sticker). Every result is backed by the VINs that actually carry it. */
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ error: "q is required." }, { status: 400 });
  }

  const results = await searchFactoryOptions(q);
  return NextResponse.json({ query: q, results });
}
