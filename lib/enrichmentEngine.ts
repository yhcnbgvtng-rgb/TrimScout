export interface PorscheOption {
  code: string;
  name: string;
  price: number;
  category: "performance" | "audio" | "interior" | "exterior" | "tech";
  description?: string;
}

export interface NhtsaSpec {
  plantCountry: string;
  plantCity?: string;
  engineCylinders: number;
  engineDisplacementL: string;
  bodyClass: string;
  grossWeightClass?: string;
  brakeSystem?: string;
}

export interface EnrichedVehicleSpec {
  nhtsa?: NhtsaSpec;
  factoryOptions?: PorscheOption[];
  optionCodes?: string[];
  totalOptionsPrice?: number;
  baseMsrp?: number | null;
  enrichedAt?: string;
}

export const PORSCHE_OPTION_CATALOG: Record<string, PorscheOption> = {
  // Performance
  "8LH": {
    code: "8LH",
    name: "Sport Chrono Package with Mode Switch & Track Precision App",
    price: 2790,
    category: "performance",
    description: "Analog/digital stopwatch on dashboard, steering wheel drive-mode dial, launch control & dynamic transmission mounts",
  },
  "2UH": {
    code: "2UH",
    name: "Front Axle Lift System",
    price: 2770,
    category: "performance",
    description: "Electro-hydraulic front suspension lift adding ~40mm ground clearance at low speeds",
  },
  "0P9": {
    code: "0P9",
    name: "Sport Exhaust System with Tailpipes in High Gloss Black",
    price: 2950,
    category: "performance",
    description: "Dual stainless-steel sport exhaust system with switchable sound valves",
  },
  "0P8": {
    code: "0P8",
    name: "Sport Exhaust System with Tailpipes in Silver",
    price: 2950,
    category: "performance",
    description: "Dual stainless-steel sports exhaust tailpipes in brushed silver",
  },
  "1LX": {
    code: "1LX",
    name: "Porsche Ceramic Composite Brakes (PCCB) with Black Calipers",
    price: 9650,
    category: "performance",
    description: "410mm carbon-fiber reinforced ceramic brake discs with 6-piston monobloc calipers",
  },
  "1BV": {
    code: "1BV",
    name: "PASM Sport Suspension (-10mm lower)",
    price: 1020,
    category: "performance",
    description: "Stiffer sport dampers, shorter springs, and aerodynamically optimized front lip",
  },
  "0N5": {
    code: "0N5",
    name: "Rear-Axle Steering",
    price: 2090,
    category: "performance",
    description: "Active rear-wheel steering for sharper turning radius at low speeds and high-speed stability",
  },
  "1P7": {
    code: "1P7",
    name: "Porsche Dynamic Chassis Control Sport (PDCC)",
    price: 3170,
    category: "performance",
    description: "Active electromechanical roll stabilization system for flat cornering",
  },

  // Audio & Tech
  "9VJ": {
    code: "9VJ",
    name: "Burmester® High-End 3D Surround Sound System",
    price: 5560,
    category: "audio",
    description: "13 individually controlled loudspeakers, 855 watts, ribbon tweeters & active subwoofer",
  },
  "9VL": {
    code: "9VL",
    name: "BOSE® Surround Sound System",
    price: 1600,
    category: "audio",
    description: "12 loudspeakers with 570 watts of output and AudioPilot noise compensation",
  },
  "KA6": {
    code: "KA6",
    name: "Surround View with Active Parking Support",
    price: 1430,
    category: "tech",
    description: "360-degree overhead camera view with automated parking assistance",
  },
  "8JU": {
    code: "8JU",
    name: "HD-Matrix Design LED Headlights in Black",
    price: 4050,
    category: "exterior",
    description: "32,000 individually controllable pixels per headlight with dynamic high-beam masking",
  },

  // Interior & Comfort
  "Q1J": {
    code: "Q1J",
    name: "Adaptive Sports Seats Plus (18-Way) with Memory Package",
    price: 3030,
    category: "interior",
    description: "Power adjustable side bolsters, lumbar support, and dual-driver memory presets",
  },
  "Q4Q": {
    code: "Q4Q",
    name: "Full Bucket Carbon Fiber Racing Seats",
    price: 5900,
    category: "interior",
    description: "Lightweight carbon-fiber reinforced plastic (CFRP) shell seats with integrated thorax airbags",
  },
  "4D3": {
    code: "4D3",
    name: "Ventilated Front Seats",
    price: 840,
    category: "interior",
    description: "Three-stage active seat cooling for driver and front passenger",
  },
  "3FE": {
    code: "3FE",
    name: "Electric Slide/Tilt Sunroof in Glass",
    price: 2000,
    category: "exterior",
    description: "Tinted laminated safety glass slide/tilt roof with integrated wind deflector",
  },
};

export const ENTHUSIAST_HIGHLIGHT_CODES = [
  { code: "8LH", label: "Sport Chrono", icon: "⏱️", color: "emerald" },
  { code: "2UH", label: "Front Axle Lift", icon: "🏎️", color: "blue" },
  { code: "1LX", label: "PCCB Ceramics", icon: "🛑", color: "amber" },
  { code: "9VJ", label: "Burmester 3D", icon: "🔊", color: "purple" },
  { code: "0P9", label: "Sport Exhaust", icon: "🏁", color: "rose" },
  { code: "Q1J", label: "18-Way Seats", icon: "💺", color: "sky" },
];
