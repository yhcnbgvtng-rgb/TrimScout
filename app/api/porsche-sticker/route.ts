import { NextResponse } from "next/server";
import { PORSCHE_FACTORY_OPTIONS_CATALOG } from "@/lib/scrapers/porscheFinderScraper";
import { PORSCHE_PAINT_CODES } from "@/components/LightsailIntelligence";
import { decodeVinFromNhtsa } from "@/lib/vinDecoder";
import { lookupPorscheBaseMsrp } from "@/lib/enrichmentEngine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Standard equipment reference by model. This is genuine, publicly documented
// Porsche standard equipment per model line — used only as a labeled,
// trim-typical estimate when no per-VIN build data is available. It must
// never be presented as this specific car's itemized/priced options list.
const STANDARD_EQUIPMENT_BY_MODEL: Record<string, string[]> = {
  Cayenne: [
    "3.0-liter turbocharged V6 engine (348 hp / 368 lb-ft torque)",
    "8-speed Tiptronic S automatic transmission with manual shift paddles",
    "Porsche Traction Management (PTM) active all-wheel drive",
    "Matrix LED headlights with advanced 4-point daytime running lights",
    "Porsche Active Suspension Management (PASM)",
    "Partial leather seating surfaces in embossed grain",
    "12.3-inch Porsche Communication Management (PCM) with Navigation & Wireless CarPlay",
    "Wireless smartphone charging tray with active cooling",
  ],
  Macan: [
    "2.0-liter turbocharged inline-4 (261 hp / 295 lb-ft torque)",
    "7-speed Porsche Doppelkupplung (PDK) transmission",
    "Porsche Traction Management (PTM) all-wheel drive",
    "Sport steering wheel with multi-function controls",
    "LED headlights with Porsche Dynamic Light System (PDLS)",
    "10.9-inch full HD touch display with Apple CarPlay®",
  ],
  Taycan: [
    "Permanent Magnet Synchronous Motor with Performance Battery",
    "Two-speed transmission on the rear axle",
    "Porsche Recuperation Management (PRM) up to 290 kW",
    "Adaptive air suspension including PASM and Smart Lift",
    "16.8-inch curved digital instrument cluster",
    "DC fast charging capability up to 320 kW (800V architecture)",
  ],
  "911": [
    "3.0-liter twin-turbocharged boxer 6 (388 hp / 331 lb-ft torque)",
    "8-speed Porsche Doppelkupplung (PDK) transmission",
    "Porsche Stability Management (PSM) with sport mode",
    "4-piston aluminum monobloc fixed calipers in black",
    "Two-zone automatic climate control",
    "PCM with high-resolution 10.9-inch touchscreen display",
  ],
};

// Trim-level overrides for 911 variants whose standard equipment differs
// materially from the base Carrera bucket above (naturally-aspirated GT
// cars in particular). Checked before falling back to STANDARD_EQUIPMENT_BY_MODEL
// so a GT3 doesn't get shown turbocharged-Carrera engine specs.
const STANDARD_EQUIPMENT_911_TRIM_OVERRIDES: { match: RegExp; equipment: string[] }[] = [
  {
    match: /gt3|gt2/i,
    equipment: [
      "4.0-liter naturally aspirated flat-6 (502 hp / 331 lb-ft torque)",
      "6-speed manual or 7-speed Porsche Doppelkupplung (PDK) transmission",
      "Double-wishbone front axle suspension (motorsport-derived)",
      "PASM Sport suspension, 10mm lower than Carrera",
      "Michelin Pilot Sport Cup 2 tires",
      "PCM with 10.9-inch touchscreen display",
    ],
  },
];

function resolveStandardEquipment(modelName: string, trimName?: string): string[] {
  if (modelName === "911" && trimName) {
    const override = STANDARD_EQUIPMENT_911_TRIM_OVERRIDES.find((o) => o.match.test(trimName));
    if (override) return override.equipment;
  }
  return STANDARD_EQUIPMENT_BY_MODEL[modelName] || [];
}

export interface PorscheOptionItem {
  code: string;
  name: string;
  price: number;
  category: string;
  description?: string;
  isStandard?: boolean;
}

export interface PorscheStickerResponse {
  success: boolean;
  vin: string;
  year?: number;
  make: string;
  model: string;
  trim?: string;
  baseMsrp: number;
  totalOptionsPrice: number;
  deliveryFee: number;
  totalMsrp: number;
  exteriorColor: {
    code?: string;
    name: string;
    price?: number;
  };
  interiorColor: {
    code?: string;
    name: string;
    price?: number;
  };
  transmission: string;
  engine: string;
  powerHp?: number;
  torqueLbFt?: number;
  zeroToSixty?: number;
  topSpeedMph?: number;
  plantOrigin: string;
  installedOptions: PorscheOptionItem[];
  standardEquipment: string[];
  windowStickerPdfUrl?: string;
  porscheFinderUrl: string;
  // PORSCHE_FINDER_LIVE / AI_PARSED_WINDOW_STICKER = real, per-VIN data.
  // TRIM_TYPICAL_ESTIMATE = no per-VIN build data was available; installedOptions
  // is empty and standardEquipment reflects the trim in general, not this car.
  dataSource: "PORSCHE_FINDER_LIVE" | "AI_PARSED_WINDOW_STICKER" | "TRIM_TYPICAL_ESTIMATE";
  isEstimate: boolean;
  note?: string;
}

// AI / Regex Option Parser that takes any raw build sheet text or finder payload
export function parseOptionsFromText(rawText: string): PorscheOptionItem[] {
  const options: PorscheOptionItem[] = [];
  const lines = rawText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Pattern: [Code] Name - $Price or Code Name Price
    const match = trimmed.match(/(?:\[([A-Z0-9]{2,4})\]\s*)?([A-Za-z0-9\s/.,®™&()-]+?)\s*[:\-$]?\s*\$?([0-9,]+)/);
    if (match) {
      const code = match[1] || "OPT";
      const name = match[2].trim();
      const price = parseInt(match[3].replace(/,/g, ""), 10) || 0;

      if (name.length > 2 && price > 0) {
        options.push({
          code,
          name,
          price,
          category: name.toLowerCase().includes("seat")
            ? "interior"
            : name.toLowerCase().includes("exhaust") || name.toLowerCase().includes("brake") || name.toLowerCase().includes("chrono") || name.toLowerCase().includes("lift")
            ? "performance"
            : name.toLowerCase().includes("sound") || name.toLowerCase().includes("camera") || name.toLowerCase().includes("assist")
            ? "tech"
            : "exterior",
          description: `Factory option equipment item (${code})`,
        });
      }
    }
  }

  return options;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawVin = searchParams.get("vin")?.trim().toUpperCase();

  if (!rawVin || rawVin.length !== 17) {
    return NextResponse.json(
      { error: "A valid 17-character Porsche VIN is required." },
      { status: 400 }
    );
  }

  const porscheFinderUrl = `https://finder.porsche.com/us/en-US/search?searchTerm=${rawVin}`;
  const directPdfUrl = `https://finder.porsche.com/api/us/en-US/vehicles/${rawVin}/window-sticker.pdf`;

  try {
    // 1. Attempt to fetch Porsche Finder Next.js __NEXT_DATA__
    let liveSticker: any = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(porscheFinderUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const html = await res.text();
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (nextDataMatch && nextDataMatch[1]) {
          const nextData = JSON.parse(nextDataMatch[1]);
          const vehicle =
            nextData?.props?.pageProps?.vehicle ||
            nextData?.props?.pageProps?.initialData?.vehicle ||
            nextData?.props?.pageProps?.data?.vehicle;

          if (vehicle) {
            liveSticker = vehicle;
          }
        }
      }
    } catch {
      // Fallback
    }

    if (liveSticker) {
      const baseMsrp = liveSticker.price?.basePrice || liveSticker.basePrice || 120000;
      const totalMsrp = liveSticker.price?.retailPrice || liveSticker.price?.price || baseMsrp;
      const opts: PorscheOptionItem[] = (liveSticker.individualEquipment || []).map((eq: any) => ({
        code: eq.code || eq.id || "OPT",
        name: eq.name || eq.description,
        price: eq.price || 0,
        category: eq.category || "option",
        description: eq.description || "",
      }));

      const ext = liveSticker.exteriorColor || {};
      const int = liveSticker.interiorColor || {};

      // Only surface performance figures and standard-equipment text that the
      // live payload actually provided — no hardcoded numeric fallbacks.
      // Substituting canned spec numbers (e.g. GT3 RS output) for a car we
      // couldn't actually decode is worse than saying "unknown".
      const tech = liveSticker.technicalData || {};

      return NextResponse.json({
        success: true,
        vin: rawVin,
        year: liveSticker.modelYear,
        make: "Porsche",
        model: liveSticker.model,
        trim: liveSticker.trim || liveSticker.series,
        baseMsrp,
        totalOptionsPrice: Math.max(0, totalMsrp - baseMsrp - 1650),
        deliveryFee: 1650,
        totalMsrp,
        exteriorColor: {
          code: ext.code || "",
          name: ext.name || "Not reported by Porsche Finder",
          price: ext.price || 0,
        },
        interiorColor: {
          code: int.code || "",
          name: int.name || "Not reported by Porsche Finder",
          price: int.price || 0,
        },
        transmission: liveSticker.transmission,
        engine: liveSticker.engine,
        powerHp: tech.powerHp,
        torqueLbFt: tech.torque,
        zeroToSixty: tech.zeroToSixty,
        topSpeedMph: tech.topSpeed,
        plantOrigin: "Stuttgart-Zuffenhausen, Germany",
        installedOptions: opts,
        standardEquipment: liveSticker.standardEquipment || [],
        windowStickerPdfUrl: directPdfUrl,
        porscheFinderUrl,
        dataSource: "PORSCHE_FINDER_LIVE",
        isEstimate: false,
      });
    }

    // 2. No live per-VIN build data available. A VIN does not itself encode
    // which factory options were installed on this specific car, so we do
    // NOT invent an itemized options list here. Decode the VIN via NHTSA for
    // an authoritative model/trim identity, then return trim-typical
    // standard equipment as a clearly labeled estimate — never billed as
    // this car's actual, itemized build.
    const decoded = await decodeVinFromNhtsa(rawVin).catch(() => null);

    const fs = await import("fs");
    const path = await import("path");
    let vehicleRecord: any = null;
    try {
      const invPath = path.join(process.cwd(), "data", "lightsail_inventory.json");
      if (fs.existsSync(invPath)) {
        const inv = JSON.parse(fs.readFileSync(invPath, "utf-8"));
        vehicleRecord = inv.find((x: any) => x.vin === rawVin);
      }
    } catch {
      // ignore
    }

    const modelName =
      decoded?.model || vehicleRecord?.model || (rawVin.includes("WP1") ? "Cayenne" : "911");
    const trimName = decoded?.trim || vehicleRecord?.trim;
    const year = decoded?.year || vehicleRecord?.year;
    const baseMsrp = lookupPorscheBaseMsrp(`${modelName} ${trimName || ""}`);
    const plantOrigin = decoded?.plantCountry
      ? `${decoded.plantCountry}`
      : modelName === "Cayenne"
      ? "Bratislava, Slovakia"
      : modelName === "Macan" || modelName === "Panamera"
      ? "Leipzig, Germany"
      : "Stuttgart-Zuffenhausen, Germany";

    // Only surface equipment text for models we actually have a catalog entry
    // for. Falling back to another model's spec sheet (e.g. showing 911
    // boxer-6/PDK text for a Panamera) would be the exact kind of wrong-car
    // data this endpoint exists to avoid.
    const stdEquip = resolveStandardEquipment(modelName, trimName);

    return NextResponse.json({
      success: true,
      vin: rawVin,
      year,
      make: "Porsche",
      model: modelName,
      trim: trimName,
      baseMsrp,
      totalOptionsPrice: 0,
      deliveryFee: 1650,
      totalMsrp: baseMsrp + 1650,
      exteriorColor: {
        code: vehicleRecord?.exteriorColor || "",
        name: vehicleRecord?.exteriorColor || "Not verified for this VIN",
        price: 0,
      },
      interiorColor: {
        code: vehicleRecord?.interiorColor || "",
        name: vehicleRecord?.interiorColor || "Not verified for this VIN",
        price: 0,
      },
      transmission: vehicleRecord?.transmission || decoded?.transmission,
      engine:
        vehicleRecord?.engine ||
        (decoded?.displacementL
          ? `${decoded.displacementL} ${decoded.engineCylinders ? `${decoded.engineCylinders}-Cylinder` : ""}`.trim()
          : undefined),
      plantOrigin,
      installedOptions: [],
      standardEquipment: stdEquip,
      windowStickerPdfUrl: directPdfUrl,
      porscheFinderUrl,
      dataSource: "TRIM_TYPICAL_ESTIMATE",
      isEstimate: true,
      note: "Specific factory-installed options could not be verified for this VIN. Showing equipment typical for this trim — not this car's actual build. Paste the real window sticker text below for a verified, itemized list.",
    });
  } catch (err: any) {
    console.error("Porsche window sticker extraction failed:", err);
    return NextResponse.json(
      {
        error: "Failed to extract window sticker",
        details: err.message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { rawText, vin } = body;

    if (!rawText || typeof rawText !== "string") {
      return NextResponse.json(
        { error: "rawText parameter is required for AI window sticker parsing." },
        { status: 400 }
      );
    }

    const parsedOptions = parseOptionsFromText(rawText);
    const optionsTotal = parsedOptions.reduce((acc, o) => acc + o.price, 0);

    return NextResponse.json({
      success: true,
      vin: vin || "UNKNOWN_VIN",
      itemizedOptionsCount: parsedOptions.length,
      totalOptionsPrice: optionsTotal,
      options: parsedOptions,
      parsedAt: new Date().toISOString(),
      source: "AI_PARSED_WINDOW_STICKER",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "AI Parsing failed", details: err.message },
      { status: 500 }
    );
  }
}
