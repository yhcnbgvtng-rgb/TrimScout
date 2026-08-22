import { Vehicle, DealerBid, UserProfile, TradeInVehicle } from "./types";
import verifiedVehiclesList from "./verifiedVehicles.json";

export const MOCK_VEHICLES: Vehicle[] = verifiedVehiclesList as unknown as Vehicle[];

export const INITIAL_DEMO_BIDS: DealerBid[] = [];

export const SAMPLE_TRADE_IN_VEHICLE: TradeInVehicle = {
  hasTradeIn: true,
  year: 2022,
  make: "BMW",
  model: "3 Series",
  trim: "330i xDrive",
  mileage: 28450,
  vin: "WBA33AY08RF892110",
  condition: "excellent",
  estimatedValueMin: 30000,
  estimatedValueMax: 33000,
  photos: [],
};

export const DEMO_BUYER_USER: UserProfile = {
  id: "user-demo-1",
  name: "Paul",
  email: "paul@trimscout.io",
  role: "buyer",
  buyerAlias: "BayAreaBuyer_941",
  phone: "(415) 555-0188",
  zipCode: "94107",
  savedVehicleIds: ["veh-1", "veh-4"],
};
