export interface DecodedVehicle {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  bodyClass?: string;
  doors?: number;
  driveType?: string;
  engineCylinders?: string;
  displacementL?: string;
  fuelType?: string;
  transmission?: string;
  manufacturer?: string;
  plantCountry?: string;
  vehicleType?: string;
  errorText?: string;
}

export const SAMPLE_TEST_VINS = [
  {
    label: "2024 BMW 330i xDrive",
    vin: "WBA33AY09RF611293",
    make: "BMW",
    model: "3 Series",
  },
  {
    label: "2023 Ford F-150 SuperCrew",
    vin: "1FTFW1ED5PFA12345",
    make: "Ford",
    model: "F-150",
  },
  {
    label: "2024 Porsche 911 Carrera",
    vin: "WP0AA2A94RS210492",
    make: "Porsche",
    model: "911",
  },
  {
    label: "2023 Tesla Model 3 Long Range",
    vin: "5YJ3E1EB9PF192841",
    make: "Tesla",
    model: "Model 3",
  },
];

// Server-side NHTSA lookup. A VIN only ever encodes the base vehicle
// configuration (make/model/year/engine/body) — it never encodes which
// individual factory options were installed on that specific car. Callers
// looking to pair a VIN with an options list must treat this as the
// authoritative vehicle identity, and source the options list separately.
export async function decodeVinFromNhtsa(vin: string): Promise<DecodedVehicle | null> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) return null;

  const nhtsaUrl = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(
    cleanVin
  )}?format=json`;

  const response = await fetch(nhtsaUrl, {
    headers: { Accept: "application/json" },
    next: { revalidate: 86400 },
  });
  if (!response.ok) throw new Error(`NHTSA API returned status ${response.status}`);

  const data = await response.json();
  const result = data.Results?.[0];
  if (!result || !result.Make) return null;

  return {
    vin: cleanVin,
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
}

export async function decodeVin(vin: string): Promise<DecodedVehicle | null> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) {
    throw new Error("A valid VIN must be exactly 17 characters");
  }

  try {
    const res = await fetch(`/api/vin-decode?vin=${encodeURIComponent(cleanVin)}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server responded with status ${res.status}`);
    }

    const json = await res.json();
    return json.data as DecodedVehicle;
  } catch (err: any) {
    console.error("VIN decode error:", err);
    throw err;
  }
}
