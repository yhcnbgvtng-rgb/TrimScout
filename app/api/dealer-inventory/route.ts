import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchVehiclesFromBox } from "@/lib/lightsailClient";

// Scoped server-side to the *session's* dealerName — never accepts a
// client-supplied dealer name, so a dealer can only ever pick a bid
// vehicle from their own real inventory.
export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user as any;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "You must be signed in as a dealer." }, { status: 401 });
  }
  if (!user.dealerName) {
    return NextResponse.json({ vehicles: [] });
  }

  const { searchParams } = new URL(req.url);
  const brand = searchParams.get("brand");
  const make = searchParams.get("make");
  if (!brand) {
    return NextResponse.json({ error: "brand is required" }, { status: 400 });
  }

  const res = await fetchVehiclesFromBox({
    brand,
    dealer: user.dealerName,
    make: make || undefined,
    pageSize: 50,
    sortBy: "days_desc",
  });

  const vehicles = (res?.vehicles || []).map((v) => ({
    vin: v.vin,
    year: v.year,
    make: v.make,
    model: v.model,
    trim: v.trim,
    msrp: v.msrp,
    status: v.status,
    imageUrl: v.image_url,
    packages: (v.options || []).map((o) => o.name).slice(0, 5),
  }));

  return NextResponse.json({ vehicles });
}
