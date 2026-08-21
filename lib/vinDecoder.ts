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
