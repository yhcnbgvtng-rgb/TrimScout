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
  // Packages
  "P3R": {
    code: "P3R",
    name: "Premium Package Plus",
    price: 5350,
    category: "tech",
    description: "Surround View, BOSE® Surround Sound, Ambient Lighting, Ventilated Seats, Lane Change Assist & Comfort Access",
  },
  "P3U": {
    code: "P3U",
    name: "Sport Package",
    price: 4630,
    category: "performance",
    description: "Sport Exhaust System, Sport Chrono Package & PASM Sport Suspension (-10mm)",
  },
  "P3P": {
    code: "P3P",
    name: "Technology Package",
    price: 3000,
    category: "tech",
    description: "Head-Up Display, Night Vision Assist, Remote ParkAssist & Porsche InnoDrive",
  },
  "04S": {
    code: "04S",
    name: "Weissach Package",
    price: 33520,
    category: "performance",
    description: "Visible carbon-weave front lid, roof, rear wing, exposed carbon anti-roll bars & magnesium forged wheels",
  },
  "04H": {
    code: "04H",
    name: "Heritage Design Package - Pure",
    price: 13500,
    category: "interior",
    description: "Two-tone leather interior in Cognac/Black, Pepita houndstooth seat centers & heritage gold exterior badges",
  },

  // Performance & Chassis
  "8LH": {
    code: "8LH",
    name: "Sport Chrono Package with Mode Switch",
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
    description: "Dual stainless-steel sport exhaust system with switchable sound valves in gloss black",
  },
  "0P8": {
    code: "0P8",
    name: "Sport Exhaust System with Tailpipes in Silver",
    price: 2950,
    category: "performance",
    description: "Dual stainless-steel sports exhaust tailpipes in brushed stainless steel",
  },
  "1LX": {
    code: "1LX",
    name: "Porsche Ceramic Composite Brakes (PCCB) - High Gloss Black",
    price: 9650,
    category: "performance",
    description: "410mm carbon-fiber reinforced ceramic brake discs with 6-piston calipers in gloss black",
  },
  "1LQ": {
    code: "1LQ",
    name: "Porsche Ceramic Composite Brakes (PCCB) - Yellow",
    price: 9650,
    category: "performance",
    description: "410mm carbon-fiber reinforced ceramic brake discs with 6-piston calipers in racing yellow",
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
  "GH3": {
    code: "GH3",
    name: "Porsche Torque Vectoring Plus (PTV+)",
    price: 1500,
    category: "performance",
    description: "Electronically controlled rear differential lock with fully variable torque distribution",
  },
  "1N3": {
    code: "1N3",
    name: "Power Steering Plus",
    price: 300,
    category: "performance",
    description: "Speed-sensitive power steering adjusting assistance at low parking speeds",
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
  "7Y1": {
    code: "7Y1",
    name: "Lane Change Assist (LCA / Blind Spot)",
    price: 1060,
    category: "tech",
    description: "Radar-based blind-spot monitoring with visual warning in door mirrors",
  },
  "P60": {
    code: "P60",
    name: "Lane Keep Assist (LKA) incl. Traffic Sign Recognition",
    price: 1220,
    category: "tech",
    description: "Camera-based lane departure correction and speed limit indicator",
  },
  "8T3": {
    code: "8T3",
    name: "Adaptive Cruise Control (ACC)",
    price: 2000,
    category: "tech",
    description: "Radar and camera-based distance cruise control with stop-and-go function",
  },
  "KS1": {
    code: "KS1",
    name: "Head-Up Display (HUD)",
    price: 1490,
    category: "tech",
    description: "Full-color projection of driving and navigation data onto the windshield",
  },
  "9R1": {
    code: "9R1",
    name: "Night Vision Assist",
    price: 2410,
    category: "tech",
    description: "Thermal imaging infrared camera with pedestrian and wildlife detection",
  },
  "8JU": {
    code: "8JU",
    name: "HD-Matrix Design LED Headlights in Black",
    price: 4050,
    category: "exterior",
    description: "32,000 individually controllable pixels per headlight with dynamic high-beam masking",
  },
  "8IS": {
    code: "8IS",
    name: "LED Headlights incl. Porsche Dynamic Light System Plus (PDLS+)",
    price: 1270,
    category: "exterior",
    description: "Dynamic cornering lights, speed-sensitive range adjustment, and high-beam assistant",
  },
  "8VH": {
    code: "8VH",
    name: "Exclusive Design Taillights",
    price: 990,
    category: "exterior",
    description: "Translucent clear taillight lenses with integrated third brake light",
  },

  // Interior & Seating
  "Q1J": {
    code: "Q1J",
    name: "Adaptive Sports Seats Plus (18-Way) with Memory Package",
    price: 3030,
    category: "interior",
    description: "Power adjustable side bolsters, lumbar support, and dual-driver memory presets",
  },
  "Q2J": {
    code: "Q2J",
    name: "Power Sport Seats (14-Way) with Memory Package",
    price: 2110,
    category: "interior",
    description: "14-way electric adjustment with lumbar and electric steering column memory",
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
  "4A3": {
    code: "4A3",
    name: "Heated Front Seats",
    price: 530,
    category: "interior",
    description: "Three-stage seat heating for driver and front passenger",
  },
  "2PJ": {
    code: "2PJ",
    name: "Heated GT Sport Steering Wheel in Leather",
    price: 590,
    category: "interior",
    description: "Ergonomic sport wheel with heating element and mode switch",
  },
  "2PF": {
    code: "2PF",
    name: "Heated Multifunction GT Sport Steering Wheel in Race-Tex with Carbon",
    price: 1040,
    category: "interior",
    description: "Steering wheel rim in Race-Tex with carbon fiber spoke trim and heating",
  },
  "5TX": {
    code: "5TX",
    name: "Extended Carbon Fiber Interior Package",
    price: 3970,
    category: "interior",
    description: "High-gloss carbon fiber dashboard trim, door panel inserts, and center console",
  },
  "FZ1": {
    code: "FZ1",
    name: "Seat Belts in Guards Red",
    price: 540,
    category: "interior",
    description: "Authentic Porsche Guards Red contrast safety belts",
  },
  "FZ4": {
    code: "FZ4",
    name: "Seat Belts in Racing Yellow",
    price: 540,
    category: "interior",
    description: "Authentic Porsche Racing Yellow contrast safety belts",
  },
  "3J7": {
    code: "3J7",
    name: "Porsche Crest on Headrests (Front)",
    price: 290,
    category: "interior",
    description: "Embossed official Porsche crest on front seat headrests",
  },
  "QQ2": {
    code: "QQ2",
    name: "Ambient Lighting Package",
    price: 580,
    category: "interior",
    description: "Customizable multi-color LED interior contour and footwell ambient lighting",
  },
  "4F6": {
    code: "4F6",
    name: "Comfort Access / Keyless Entry",
    price: 550,
    category: "interior",
    description: "Keyless vehicle unlocking and hands-free luggage compartment opening",
  },
  "2V4": {
    code: "2V4",
    name: "Ionizer / Air Quality System",
    price: 350,
    category: "interior",
    description: "Cabin air ionization reducing airborne pollutants, germs, and odors",
  },

  // Exterior & Wheels
  "3FE": {
    code: "3FE",
    name: "Electric Slide/Tilt Sunroof in Glass",
    price: 2000,
    category: "exterior",
    description: "Tinted laminated safety glass slide/tilt roof with integrated wind deflector",
  },
  "3FD": {
    code: "3FD",
    name: "Electric Slide/Tilt Sunroof in Metal",
    price: 1560,
    category: "exterior",
    description: "Body-color painted steel/aluminum slide/tilt roof panel",
  },
  "6FU": {
    code: "6FU",
    name: "Exterior Mirrors Painted in Exterior Color",
    price: 660,
    category: "exterior",
    description: "Exterior mirror lower trims and mirror bases painted in high gloss body color",
  },
  "VR4": {
    code: "VR4",
    name: "SportDesign Side Skirts",
    price: 1290,
    category: "exterior",
    description: "Aerodynamically sculpted side skirts painted in exterior body color",
  },
  "2D1": {
    code: "2D1",
    name: "SportDesign Package",
    price: 4890,
    category: "exterior",
    description: "Distinctive front apron with custom spoiler lip and rear apron in SportDesign styling",
  },
  "2D5": {
    code: "2D5",
    name: "SportDesign Package in High Gloss Black",
    price: 6030,
    category: "exterior",
    description: "SportDesign front and rear aprons painted in brilliant High Gloss Black",
  },
  "46K": {
    code: "46K",
    name: '20"/21" Carrera Classic Wheels',
    price: 2450,
    category: "exterior",
    description: "Forged alloy wheels in 5-spoke two-tone classic design",
  },
  "46N": {
    code: "46N",
    name: '20"/21" 911 Turbo S Exclusive Wheels',
    price: 3620,
    category: "exterior",
    description: "Center-locking lightweight forged alloy wheels with bi-color finish",
  },
  "1NP": {
    code: "1NP",
    name: "Wheel Center Caps with Colored Porsche Crest",
    price: 190,
    category: "exterior",
    description: "Full-color official Porsche crest wheel hub covers",
  },
};

export const ENTHUSIAST_HIGHLIGHT_CODES = [
  // Packages
  { code: "P3R", label: "Premium Package Plus", icon: "💎", color: "purple" },
  { code: "P3U", label: "Sport Package", icon: "🏆", color: "emerald" },
  { code: "04S", label: "Weissach Package", icon: "🏁", color: "rose" },
  { code: "04H", label: "Heritage Design", icon: "👑", color: "amber" },

  // Performance & Chassis
  { code: "8LH", label: "Sport Chrono", icon: "⏱️", color: "emerald" },
  { code: "2UH", label: "Front Axle Lift", icon: "🏎️", color: "blue" },
  { code: "1LX", label: "PCCB Ceramics (Black)", icon: "🛑", color: "amber" },
  { code: "1LQ", label: "PCCB Ceramics (Yellow)", icon: "🛑", color: "amber" },
  { code: "0P9", label: "Sport Exhaust (Black)", icon: "🏁", color: "rose" },
  { code: "0P8", label: "Sport Exhaust (Silver)", icon: "🏁", color: "rose" },
  { code: "0N5", label: "Rear-Axle Steering", icon: "🔄", color: "cyan" },
  { code: "1P7", label: "PDCC Dynamic Chassis", icon: "⚡", color: "indigo" },
  { code: "1BV", label: "PASM Sport Suspension", icon: "📉", color: "teal" },

  // Audio & Tech
  { code: "9VJ", label: "Burmester 3D High-End", icon: "🔊", color: "purple" },
  { code: "9VL", label: "BOSE Surround Sound", icon: "🎵", color: "sky" },
  { code: "KA6", label: "Surround View 360°", icon: "📷", color: "emerald" },
  { code: "8JU", label: "HD-Matrix LED Black", icon: "💡", color: "yellow" },
  { code: "8T3", label: "Adaptive Cruise (ACC)", icon: "🎯", color: "blue" },
  { code: "KS1", label: "Head-Up Display (HUD)", icon: "📊", color: "violet" },
  { code: "9R1", label: "Night Vision Assist", icon: "🌙", color: "pink" },
  { code: "7Y1", label: "Blind Spot (LCA)", icon: "👁️", color: "cyan" },

  // Interior & Comfort
  { code: "Q1J", label: "18-Way Adaptive Seats", icon: "💺", color: "sky" },
  { code: "Q2J", label: "14-Way Power Seats", icon: "💺", color: "sky" },
  { code: "Q4Q", label: "Carbon Bucket Seats", icon: "🏎️", color: "red" },
  { code: "4D3", label: "Ventilated Seats", icon: "❄️", color: "blue" },
  { code: "2PJ", label: "Heated GT Wheel", icon: "🔥", color: "orange" },
  { code: "5TX", label: "Carbon Fiber Interior", icon: "✨", color: "zinc" },
  { code: "FZ1", label: "Guards Red Seat Belts", icon: "🔴", color: "rose" },
  { code: "3J7", label: "Porsche Crest Headrests", icon: "🛡️", color: "amber" },

  // Exterior
  { code: "3FE", label: "Glass Sunroof", icon: "🪟", color: "blue" },
  { code: "2D1", label: "SportDesign Package", icon: "🎨", color: "indigo" },
  { code: "46K", label: "Carrera Classic Wheels", icon: "🛞", color: "amber" },
];

