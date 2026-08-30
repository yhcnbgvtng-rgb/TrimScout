import { NextResponse } from "next/server";
import { fetchVehiclesFromBox } from "@/lib/lightsailClient";
import { getZipCoordinates } from "@/lib/otdCalculator";

// Only brands the crawler actually tracks have real inventory to compare
// against — anything else (e.g. a mock-flow BMW/Toyota pick) has no real
// data behind it, so we say so rather than fabricating results.
const MAKE_TO_BRAND_CODE: Record<string, string> = {
  porsche: "porsche",
  ford: "ford",
  chevrolet: "chevrolet",
  acura: "acura",
  audi: "audi",
  mclaren: "mclaren",
};

const MAX_DISTANCE_MILES = 50;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const make = (searchParams.get("make") || "").trim();
  const model = (searchParams.get("model") || "").trim();
  const zip = (searchParams.get("zip") || "").trim();
  const excludeVin = (searchParams.get("excludeVin") || "").trim().toUpperCase();

  const brand = MAKE_TO_BRAND_CODE[make.toLowerCase()];
  if (!brand || !model || !zip) {
    return NextResponse.json({ supported: !!brand, vehicles: [] });
  }

  const { lat, lng, state } = getZipCoordinates(zip);

  const res = await fetchVehiclesFromBox({
    brand,
    model,
    state,
    lat,
    lng,
    sortBy: "closest_to_zip",
    pageSize: 50,
  });

  const vehicles = (res?.vehicles ?? [])
    .filter((v) => v.vin.toUpperCase() !== excludeVin && typeof v.distance_miles === "number" && v.distance_miles! <= MAX_DISTANCE_MILES)
    .sort((a, b) => (a.distance_miles ?? 0) - (b.distance_miles ?? 0))
    .slice(0, 12)
    .map((v) => ({
      vin: v.vin,
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim,
      price: v.price,
      msrp: v.msrp,
      mileage: v.mileage,
      status: v.status,
      dealerName: v.dealer_name,
      city: v.dealer_city ?? null,
      state: v.state,
      distanceMiles: v.distance_miles != null ? Math.round(v.distance_miles * 10) / 10 : null,
      url: v.url,
    }));

  return NextResponse.json({ supported: true, vehicles });
}
