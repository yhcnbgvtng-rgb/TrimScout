import { Vehicle, DealerBid, UserProfile } from "./types";
import verifiedVehiclesList from "./verifiedVehicles.json";

export const MOCK_VEHICLES: Vehicle[] = verifiedVehiclesList as Vehicle[];

export const INITIAL_DEMO_BIDS: DealerBid[] = [];

export const SAMPLE_TRADE_IN_VEHICLE = {
  vin: "WBA33AY08RF892110",
  year: 2022,
  make: "BMW",
  model: "3 Series",
  trim: "330i xDrive",
  mileage: 28450,
  condition: "excellent" as const,
  estimatedValue: 31500,
};

export const DEMO_BUYER_USER: UserProfile = {
  id: "user-demo-1",
  name: "Paul",
  email: "paul@trimscout.io",
  role: "buyer",
  buyerAlias: "BayAreaBuyer_941",
  phone: "(415) 555-0188",
  preferredZip: "94107",
  searchRadius: 150,
};
