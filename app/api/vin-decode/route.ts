export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

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
    const nhtsaUrl = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(
      vin
    )}?format=json`;

    const response = await fetch(nhtsaUrl, {
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 86400 }, // Cache responses for 24 hours
    });

    if (!response.ok) {
      throw new Error(`NHTSA API returned status ${response.status}`);
    }

    const data = await response.json();
    const result = data.Results?.[0];

    if (!result) {
      return NextResponse.json(
        { error: "No vehicle specifications found for this VIN" },
        { status: 404 }
      );
    }

    // Extract and normalize relevant vehicle attributes
    const vehicleData = {
      vin,
      year: result.ModelYear ? parseInt(result.ModelYear, 10) : undefined,
      make: result.Make || undefined,
      model: result.Model || undefined,
      trim: result.Trim || result.Series || undefined,
      bodyClass: result.BodyClass || undefined,
      doors: result.Doors ? parseInt(result.Doors, 10) : undefined,
      driveType: result.DriveType || undefined,
      engineCylinders: result.EngineCylinders || undefined,
      displacementL: result.DisplacementL ? `${result.DisplacementL}L` : undefined,
      fuelType: result.FuelTypePrimary || undefined,
      transmission: result.TransmissionStyle || undefined,
      manufacturer: result.Manufacturer || undefined,
      plantCountry: result.PlantCountry || undefined,
      vehicleType: result.VehicleType || undefined,
      errorText: result.ErrorText || undefined,
    };

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
