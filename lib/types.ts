export type VehicleStatus = "on_lot" | "in_transit" | "in_production" | "order_allocation" | "sold";

export type BiddingStrategy = "exact_auction" | "firm_offer" | "flexible_discount";

export type DealStructureMethod = "cash" | "finance" | "lease";
export type PaymentMethod = "all_three" | DealStructureMethod;

export interface CashDealTerms {
  offerPrice: number;
}

export interface FinanceDealTerms {
  sellingPrice: number;
  downPayment: number;
  termMonths: number;
  aprPercent: number;
}

export interface LeaseDealTerms {
  capCost: number;
  /** Cap cost reduction (down payment) applied before computing the payment. */
  dueAtSigning: number;
  termMonths: number;
  milesPerYear: number;
  moneyFactor: number;
  residualPercent: number;
  /** Manufacturer/dealer incentives — reduce the cap cost like a rebate. */
  rebates?: number;
  /** Bank/acquisition fee — rolled into the cap cost. */
  acquisitionFee?: number;
  /** Due at lease end, not at signing — informational only. */
  dispositionFee?: number;
  salesTaxPercent?: number;
  /** "monthly" taxes each payment (most states); "upfront" taxes the cap cost at signing. */
  taxMethod?: "monthly" | "upfront";
}

/** Independent cash / finance / lease inputs for one VIN. Never copy onto another vehicle. */
export interface VehicleDealTerms {
  vin: string;
  cash?: CashDealTerms;
  finance?: FinanceDealTerms;
  lease?: LeaseDealTerms;
}

export interface DealStructurePreferences {
  requestedStructures: DealStructureMethod[];
  financeTermMonths?: number;
  downPayment?: number;
  leaseMileagePerYear?: number;
  leaseTermMonths?: number;
  /** Per-VIN deal terms from the post-Step-5 compare page. */
  vehicleTerms?: VehicleDealTerms[];
}

export interface Option {
  code: string;
  name: string;
  price: number;
  category: "package" | "standalone" | "exterior" | "interior" | "performance";
}

export type VehicleCondition = "new" | "used" | "cpo";

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
  condition?: VehicleCondition;
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
  porscheCode?: string;
  oemBuildSheetUrl?: string;
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
  buyerState?: string;
  searchRadiusMiles: number;
  // Default true: prefer dealers in the buyer's own state within
  // searchRadiusMiles; the buyer can turn this off in the wizard to widen
  // the match to any state within the radius. Optional so the older
  // client-only demo request (BidProgramIntro's mock path) still type-checks.
  sameStateOnly?: boolean;
  tradeIn?: TradeInVehicle;
  // Free-text note to the dealer, scrubbed of contact info (email/phone/
  // link/handle) before it's ever sent — see lib/piiFilter.ts.
  buyerComment?: string;
  createdAt: string;
  expiresAt: string;
  status: "active" | "locked" | "expired";
  // Set when Step 3 chose a one-dealer offer instead of the reverse auction.
  directOffer?: boolean;
  /** Other lots riding in this request (0–2). Never padded with invented inventory. */
  otherLots?: Vehicle[];
  /** Per-dealer click / view / respond — honest empty until a real event. */
  dealerEngagement?: DealerEngagementStatus[];
  /** 48h running-time close clock; idle until the first dealer views. */
  offerClock?: OfferCloseClockView;
}

export interface DealerEngagementStatus {
  dealerKey: string;
  dealerName: string;
  dealerState: string;
  clicked: boolean;
  viewed: boolean;
  responded: boolean;
  knownRooftop: boolean;
}

export interface OfferCloseClockView {
  status: "idle" | "running" | "paused" | "closed";
  remainingMs: number;
  allottedRunningMs: number;
  timeZone: string;
  startedAt: string | null;
  closedAt: string | null;
  paused: boolean;
  pauseReason: "weekend" | "holiday" | "weekend_and_holiday" | null;
  resumeAt: string | null;
}

// A dealer's inbox view of one real active buyer request — masked (per the
// buyer-anonymity requirement: no real name/phone/email/exact zip, just an
// alias + state-level region) and returned by GET /api/dealer-requests.
export interface DealerInboundRequest {
  requestId: string;
  buyerAlias: string;
  buyerState: string;
  distanceMiles: number;
  strategy: BiddingStrategy;
  referenceBrandCode: string;
  referenceVin: string;
  referenceYear: number | null;
  referenceMake: string;
  referenceModel: string;
  referenceTrim: string | null;
  referencePrice: number | null;
  referenceMsrp: number | null;
  referenceImageUrl: string | null;
  targetOtdPrice: number | null;
  targetDiscountPercent: number | null;
  paymentMethod: PaymentMethod;
  tradeIn?: TradeInVehicle;
  buyerComment?: string | null;
  createdAt: string;
  expiresAt: string;
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
  // Excludes sales tax + DMV/registration fees (buyer-location-dependent,
  // not dealer-competitiveness-dependent) — the number bids are ranked
  // and headlined on. See lib/otdCalculator.ts.
  quotedOtdPrice: number;
  netOtdWithTradeIn?: number;
  financeMonthlyEstimate?: number;
  leaseMonthlyEstimate?: number;
  notes: string;
  rank: number;
  createdAt: string;
  isTopDeal?: boolean;
  // True until the buyer has paid to lock in this specific bid — dealer
  // identity/VIN/contact are withheld from the buyer until then (see
  // app/api/deal-requests/[id]/bids/route.ts). dealerName/dealerCity/
  // matchedVin are masked placeholders/empty strings while true.
  isMasked?: boolean;
  salesRep?: {
    name: string;
    title: string;
    phone: string;
  };
}

export interface LockedDeal {
  certificateId: string;
  // Optional: a deal reconstructed from the server after a Stripe Checkout
  // redirect (see app/api/checkout/verify) only has the winning bid on
  // hand, not the original BiddingRequest — nothing in VoucherModal reads
  // this field, so it's safe to omit in that path.
  request?: BiddingRequest;
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
  role: "buyer" | "dealer" | "admin";
  phone: string;
  zipCode: string;
  avatarUrl?: string;
  buyerAlias?: string;
  dealerName?: string;
  dealerTitle?: string;
  savedVehicleIds: string[];
  status?: "active" | "suspended" | "pending_verification";
  createdAt?: string;
  lastLogin?: string;
  notes?: string;
  totalDealsCount?: number;
  activeBidsCount?: number;
}
