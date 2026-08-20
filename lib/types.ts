export type VehicleStatus = "on_lot" | "in_transit" | "in_production" | "order_allocation" | "sold";

export type BiddingStrategy = "exact_auction" | "firm_offer" | "flexible_discount";

export type PaymentMethod = "all_three" | "cash" | "finance" | "lease";

export interface DealStructurePreferences {
  requestedStructures: ("cash" | "finance" | "lease")[];
  financeTermMonths?: number;
  downPayment?: number;
  leaseMileagePerYear?: number;
  leaseTermMonths?: number;
}

export interface Option {
  code: string;
  name: string;
  price: number;
  category: "package" | "standalone" | "exterior" | "interior" | "performance";
}

export interface Vehicle {
  id: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyType: string;
  engine: string;
  drivetrain: string;
  transmission: string;
  exteriorColor: string;
  interiorColor: string;
  msrp: number;
  dealerPrice: number;
  daysOnLot: number;
  status: VehicleStatus;
  location: {
    dealerName: string;
    city: string;
    state: string;
    zip?: string;
    distanceMiles: number;
    lat?: number;
    lng?: number;
  };
  packages: string[];
  options: Option[];
  imageUrl: string;
  mileage: number;
  dealerUrl?: string;
}

export interface FlexibleCriteria {
  make: string;
  model: string;
  trims: string[];
  minMsrp?: number;
  maxMsrp?: number;
  mustHavePackages: string[];
  preferredColors: string[];
  dealbreakers: string[];
  allowedStatuses: VehicleStatus[];
}

export interface TradeInPhoto {
  id: string;
  angle: "front_angle" | "rear_angle" | "interior_odometer" | "tires_wheels" | "damage_cosmetic";
  label: string;
  imageUrl: string;
}

export interface TradeInVehicle {
  hasTradeIn: boolean;
  year: number;
  make: string;
  model: string;
  trim: string;
  mileage: number;
  vin?: string;
  condition: "excellent" | "very_good" | "good" | "fair";
  estimatedValueMin: number;
  estimatedValueMax: number;
  loanBalance?: number;
  photos: TradeInPhoto[];
}

export interface BiddingRequest {
  id: string;
  strategy: BiddingStrategy;
  targetVin?: string;
  targetVehicle?: Vehicle;
  flexibleCriteria?: FlexibleCriteria;
  targetOtdPrice?: number;
  targetDiscountPercent?: number;
  paymentMethod: PaymentMethod;
  dealStructurePreferences?: DealStructurePreferences;
  buyerZip: string;
  searchRadiusMiles: number;
  tradeIn?: TradeInVehicle;
  createdAt: string;
  expiresAt: string;
  status: "active" | "locked" | "expired";
}

export interface DealerBid {
  id: string;
  dealRequestId: string;
  dealerName: string;
  dealerCity: string;
  dealerState: string;
  distanceMiles: number;
  matchedVin: string;
  matchedVehicleTitle: string;
  matchedVehicleSpec: string;
  matchedVehicleImageUrl: string;
  vehicleStatus: VehicleStatus;
  msrp: number;
  dealerDiscountDollars: number;
  dealerDiscountPercent: number;
  manufacturerRebates: number;
  sellingPrice: number;
  salesTax: number;
  dmvFees: number;
  docFee: number;
  dealerAccessories: number;
  tradeInAllowance?: number;
  totalOtdPrice: number;
  netOtdWithTradeIn?: number;
  financeMonthlyEstimate?: number;
  leaseMonthlyEstimate?: number;
  notes: string;
  rank: number;
  createdAt: string;
  isTopDeal?: boolean;
  salesRep: {
    name: string;
    title: string;
    phone: string;
  };
}

export interface LockedDeal {
  certificateId: string;
  request: BiddingRequest;
  winningBid: DealerBid;
  lockedAt: string;
  expiresAt: string;
  paperworkStatus: "pending_dealer_upload" | "uploaded" | "customer_signed" | "ready_for_delivery";
  uploadedContractName?: string;
  uploadedAt?: string;
  deliveryMethod?: "driveway_delivery" | "express_pickup";
  deliveryScheduledDate?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: "buyer" | "dealer";
  phone: string;
  zipCode: string;
  avatarUrl?: string;
  buyerAlias?: string;
  dealerName?: string;
  savedVehicleIds: string[];
}
