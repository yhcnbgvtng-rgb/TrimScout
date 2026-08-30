import { NextResponse } from "next/server";
import { fetchVehicleHistoryFromBox } from "@/lib/lightsailClient";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const vin = searchParams.get("vin")?.trim().toUpperCase();
  if (!vin) {
    return NextResponse.json({ error: "vin is required" }, { status: 400 });
  }

  const history = await fetchVehicleHistoryFromBox(vin);
  if (!history) {
    return NextResponse.json({ error: "No history available for this VIN." }, { status: 404 });
  }

  return NextResponse.json(history);
}
