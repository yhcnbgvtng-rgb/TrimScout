export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { decodeVinFromNhtsa } from "@/lib/vinDecoder";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vin = searchParams.get("vin")?.trim().toUpperCase();

  if (!vin) {
    return NextResponse.json(
      { error: "VIN parameter is required" },
      { status: 400 }
    );
  }

  if (vin.length !== 17) {
    return NextResponse.json(
      { error: "VIN must be exactly 17 alphanumeric characters" },
      { status: 400 }
    );
  }

  try {
    const vehicleData = await decodeVinFromNhtsa(vin);

    if (!vehicleData) {
      return NextResponse.json(
        { error: "No vehicle specifications found for this VIN" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: vehicleData,
    });
  } catch (error: any) {
    console.error("Error decoding VIN via NHTSA API:", error);
    return NextResponse.json(
      { error: error.message || "Failed to decode VIN from NHTSA database" },
      { status: 500 }
    );
  }
}
