// Bridges a real crawled vehicle (VehicleRecord, from LightsailIntelligence's
// real inventory search) into the existing lib/types.ts `Vehicle` shape that
// BiddingWizard/LiveDealRoom/DealerPortal already know how to render. Keeps
// those large, already-working components reading request.targetVehicle.*
// unchanged rather than threading a second parallel vehicle type through
// them.
import { Vehicle } from "./types";
import type { VehicleRecord } from "../components/LightsailIntelligence";

export function mapVehicleRecordToVehicle(v: VehicleRecord, brand: string): Vehicle {
  return {
    id: v.vin,
    vin: v.vin,
    year: v.year,
    make: v.make,
    model: v.model,
    trim: v.trim || "",
    bodyType: v.bodyStyle || "",
    engine: v.engine || "",
    drivetrain: "",
    transmission: v.transmission || "",
    exteriorColor: v.exteriorColor || "",
    interiorColor: "",
    msrp: v.msrp || v.price || 0,
    dealerPrice: v.price || v.msrp || 0,
    daysOnLot: v.daysOnLot || 0,
    status: mapInventoryStatus(v.status),
    location: {
      dealerName: v.dealerName,
      city: v.city || "",
      state: v.state,
      distanceMiles: 0,
      lat: v.dealerLat,
      lng: v.dealerLng,
    },
    // Honestly empty — real per-vehicle package/option pricing isn't
    // reliably available across all 6 brands the way factoryOptions is for
    // Porsche specifically; fabricating placeholder packages here would be
    // worse than an empty list.
    packages: [],
    options: [],
    imageUrl: v.imageUrl || "",
    mileage: v.mileage,
    dealerUrl: v.url,
  };
}

function mapInventoryStatus(status?: string): Vehicle["status"] {
  const s = (status || "").toUpperCase();
  if (s === "SOLD_OR_REMOVED" || s === "SOLD") return "sold";
  return "on_lot";
}
