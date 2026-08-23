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
  fuelType?: string;
}

export interface EnrichedVehicleSpec {
  nhtsa?: NhtsaSpec;
  factoryOptions?: PorscheOption[];
  optionCodes?: string[];
  totalOptionsPrice?: number;
  baseMsrp?: number | null;
  enrichedAt?: string;
}

export const PORSCHE_BASE_MSRP: Record<string, number> = {
  // 911 Series
  "911 Carrera": 120100,
  "911 Carrera Cabriolet": 133400,
  "911 Carrera 4": 127900,
  "911 Carrera 4 Cabriolet": 141200,
  "911 Carrera S": 138000,
  "911 Carrera S Cabriolet": 151300,
  "911 Carrera 4S": 145800,
  "911 Carrera 4S Cabriolet": 159100,
  "911 Targa 4": 139500,
  "911 Targa 4S": 157400,
  "911 Carrera GTS": 164900,
  "911 Carrera GTS Cabriolet": 178200,
  "911 Carrera 4 GTS": 172700,
  "911 Carrera 4 GTS Cabriolet": 186000,
  "911 Targa 4 GTS": 186000,
  "911 Turbo": 197200,
  "911 Turbo Cabriolet": 210000,
  "911 Turbo S": 230400,
  "911 Turbo S Cabriolet": 243200,
  "911 GT3": 222500,
  "911 GT3 RS": 241300,
  "911 Dakar": 222000,
  "911 S/T": 290000,

  // 718 Series
  "718 Cayman": 68300,
  "718 Cayman Style Edition": 74600,
  "718 Cayman S": 80300,
  "718 Cayman GTS 4.0": 95200,
  "718 Cayman GT4 RS": 160700,
  "718 Boxster": 70400,
  "718 Boxster Style Edition": 76700,
  "718 Boxster S": 82400,
  "718 Boxster GTS 4.0": 97300,
  "718 Spyder RS": 160700,

  // Taycan EV Series
  "Taycan": 99400,
  "Taycan 4": 103300,
  "Taycan 4S": 118500,
  "Taycan GTS": 147900,
  "Taycan Turbo": 174000,
  "Taycan Turbo S": 209000,
  "Taycan Turbo GT": 230000,
  "Taycan 4 Cross Turismo": 111100,
  "Taycan 4S Cross Turismo": 125200,
  "Taycan Turbo Cross Turismo": 176600,
  "Taycan Turbo S Cross Turismo": 211700,

  // Macan Series
  "Macan": 62900,
  "Macan T": 68500,
  "Macan S": 72300,
  "Macan GTS": 86800,
  "Macan Electric": 78800,
  "Macan 4 Electric": 78800,
  "Macan 4S Electric": 84900,
  "Macan Turbo Electric": 105300,

  // Cayenne Series
  "Cayenne": 79200,
  "Cayenne E-Hybrid": 91700,
  "Cayenne S": 95700,
  "Cayenne S E-Hybrid": 99100,
  "Cayenne GTS": 124900,
  "Cayenne Turbo E-Hybrid": 146900,
  "Cayenne Coupe": 84300,
  "Cayenne E-Hybrid Coupe": 95700,
  "Cayenne S Coupe": 102100,
  "Cayenne S E-Hybrid Coupe": 104000,
  "Cayenne GTS Coupe": 129900,
  "Cayenne Turbo E-Hybrid Coupe": 151400,
  "Cayenne Turbo GT": 196300,

  // Panamera Series
  "Panamera": 102800,
  "Panamera 4": 109800,
  "Panamera 4 E-Hybrid": 115500,
  "Panamera 4S E-Hybrid": 126800,
  "Panamera GTS": 154200,
  "Panamera Turbo E-Hybrid": 191000,
};

export function lookupPorscheBaseMsrp(modelStr: string): number {
  if (!modelStr) return 100000;
  const clean = modelStr.trim();
  if (PORSCHE_BASE_MSRP[clean]) return PORSCHE_BASE_MSRP[clean];

  for (const [key, msrp] of Object.entries(PORSCHE_BASE_MSRP)) {
    if (clean.toLowerCase().includes(key.toLowerCase())) {
      return msrp;
    }
  }

  const hay = clean.toLowerCase();
  if (hay.includes("911")) return 120100;
  if (hay.includes("cayman")) return 68300;
  if (hay.includes("boxster")) return 70400;
  if (hay.includes("taycan")) return 99400;
  if (hay.includes("macan")) return 62900;
  if (hay.includes("cayenne")) return 79200;
  if (hay.includes("panamera")) return 102800;

  return 100000;
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
