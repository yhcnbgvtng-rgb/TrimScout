import { NextResponse } from "next/server";
import { PORSCHE_FACTORY_OPTIONS_CATALOG } from "@/lib/scrapers/porscheFinderScraper";
import { PORSCHE_PAINT_CODES } from "@/components/LightsailIntelligence";
import { decodeVinFromNhtsa } from "@/lib/vinDecoder";
import { lookupPorscheBaseMsrp } from "@/lib/enrichmentEngine";
import { fetchVehicleByVinFromBox, type BoxVehicle } from "@/lib/lightsailClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;


export interface PorscheOptionItem {
  code: string;
  name: string;
  // Only known for dealer-VDP-sourced options; Porsche Finder does not
  // publish per-option retail pricing.
  price?: number;
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
  // null when the options are real/verified but Porsche doesn't publish a
  // price for them (Finder-sourced) — never coerced to 0, which would read
  // as "no added cost" for a car that actually has real options installed.
  totalOptionsPrice: number | null;
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
  // PORSCHE_FINDER_LIVE (fetched live from Finder at request time) /
  // PORSCHE_FINDER_MATCHED (Finder data for this exact VIN, obtained via an
  // earlier VIN cross-reference and cached) / AI_PARSED_WINDOW_STICKER /
  // DEALER_VDP_LISTED = real, per-VIN data. NOT_VERIFIED = no per-VIN build
  // data was available; installedOptions and standardEquipment are both
  // empty rather than guessed or filled in.
  dataSource:
    | "PORSCHE_FINDER_LIVE"
    | "PORSCHE_FINDER_MATCHED"
    | "AI_PARSED_WINDOW_STICKER"
    | "DEALER_VDP_LISTED"
    | "NOT_VERIFIED";
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

// Maps the box API's raw (snake_case) vehicle-detail shape onto the same
// loose shape the existing code below expects from a
// data/lightsail_inventory.json record (vehicleRecord?.model,
// ?.factoryOptions, etc.), so the rest of the handler doesn't need to know
// which tier the data came from.
function mapBoxVehicleToStickerRecord(bv: BoxVehicle) {
  const options = bv.options || [];
  const factoryOptions: PorscheOptionItem[] = options.map((o) => ({
    code: o.code,
    name: o.name,
    price: typeof o.price === "number" ? o.price : undefined,
    category: o.category || "option",
  }));

  // The box stores a `source` per option (e.g. "DEALER_VDP", "PORSCHE_FINDER")
  // rather than one optionsSource per vehicle like the legacy JSON snapshot.
  // Use the first option's source as a best-effort stand-in for that field,
  // which is only ever compared against the "PORSCHE_FINDER" case below.
  const optionsSource = options[0]?.source;

  const standardEquipment = bv.standard_equipment
    ? bv.standard_equipment
        .split(/[,|;]\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    model: bv.model,
    trim: bv.trim,
    year: bv.year,
    price: bv.price,
    exteriorColor: bv.exterior_color,
    interiorColor: bv.interior_color,
    transmission: bv.transmission,
    engine: bv.engine,
    factoryOptions,
    optionsSource,
    standardEquipment,
    // The box doesn't persist a per-vehicle Porsche Finder URL; the caller
    // falls back to the generic search-by-VIN URL when this is undefined.
    finderUrl: undefined,
  };
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

    let vehicleRecord: any = null;

    // 2a. NEW first attempt: the Step 4/5 box API (MariaDB-backed, real-time
    // per-VIN detail with joined options/enrichment) — tried ahead of the
    // committed JSON snapshot below. Returns null on any failure (network,
    // timeout, 404, unconfigured key), in which case we fall straight
    // through to the existing file-read logic unchanged.
    const boxVehicle = await fetchVehicleByVinFromBox(rawVin);
    // This route's whole fallback path below assumes a Porsche (Porsche
    // Finder cross-reference, lookupPorscheBaseMsrp, German-plant guesses)
    // — for a real Ford/Chevrolet VIN, none of that data means anything, so
    // don't fabricate a Porsche-shaped response for it. Confirmed live this
    // was happening: any non-Porsche VIN got make:"Porsche" and a guessed
    // Porsche baseMsrp back. Only short-circuits when the box actually knows
    // the vehicle's real brand (never blocks Porsche's own path when the
    // box lookup itself fails, e.g. before this VIN synced).
    if (boxVehicle?.make && boxVehicle.make.toLowerCase() !== "porsche") {
      return NextResponse.json({
        success: false,
        vin: rawVin,
        make: boxVehicle.make,
        error: `This VIN is a ${boxVehicle.make} — window sticker decoding is Porsche-specific (sourced from Porsche's own Finder platform, which has no equivalent for other brands).`,
      });
    }
    if (boxVehicle) {
      vehicleRecord = mapBoxVehicleToStickerRecord(boxVehicle);
    }

    // 2b. Existing fallback: committed JSON snapshot lookup (unchanged).
    if (!vehicleRecord) {
      const fs = await import("fs");
      const path = await import("path");
      try {
        const invPath = path.join(process.cwd(), "data", "lightsail_inventory.json");
        if (fs.existsSync(invPath)) {
          const inv = JSON.parse(fs.readFileSync(invPath, "utf-8"));
          vehicleRecord = inv.find((x: any) => x.vin === rawVin);
        }
      } catch {
        // ignore
      }
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

    const listedOptions: PorscheOptionItem[] = Array.isArray(vehicleRecord?.factoryOptions)
      ? vehicleRecord.factoryOptions
      : [];
    // Whether pricing is available is derived from the options themselves
    // (do any carry a real numeric price?), not from the stored
    // optionsSource label — a vehicle can have Finder-sourced equipment
    // *and* real dealer-VDP pricing merged in (see the Paul Miller Porsche
    // backfill), and both should surface: real pricing where it exists,
    // standard equipment where it exists, independently of each other.
    const hasPricedOptions = listedOptions.some((o) => typeof o.price === "number");
    const optionsTotal = hasPricedOptions
      ? listedOptions.reduce((sum, o) => sum + (o.price || 0), 0)
      : undefined;
    const fromFinder = vehicleRecord?.optionsSource === "PORSCHE_FINDER" && !hasPricedOptions;

    const resolvedDataSource: PorscheStickerResponse["dataSource"] = hasPricedOptions
      ? "DEALER_VDP_LISTED"
      : listedOptions.length > 0
      ? "PORSCHE_FINDER_MATCHED"
      : "NOT_VERIFIED";

    return NextResponse.json({
      success: true,
      vin: rawVin,
      year,
      make: "Porsche",
      model: modelName,
      trim: trimName,
      baseMsrp,
      totalOptionsPrice: optionsTotal ?? null,
      deliveryFee: 1650,
      // When the options total is unknown (Finder-sourced), baseMsrp + 0 +
      // delivery would understate the real price. Prefer this VIN's actual
      // listed price — which already reflects whatever it's really
      // equipped with — over a breakdown built on an unknown quantity.
      totalMsrp:
        optionsTotal !== undefined
          ? baseMsrp + optionsTotal + 1650
          : vehicleRecord?.price ?? baseMsrp + 1650,
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
      // Real per-VIN data, either scraped from the dealer's own VDP (Dealer.com
      // data layer) or cross-referenced against this VIN's Porsche Finder
      // listing — never guessed.
      installedOptions: listedOptions,
      standardEquipment: vehicleRecord?.standardEquipment || [],
      windowStickerPdfUrl: directPdfUrl,
      porscheFinderUrl: vehicleRecord?.finderUrl || porscheFinderUrl,
      dataSource: resolvedDataSource,
      isEstimate: listedOptions.length === 0,
      note:
        listedOptions.length > 0
          ? fromFinder
            ? "Equipment list verified against this VIN's Porsche Finder listing. Porsche does not publish per-option retail pricing on Finder, so individual and total option prices are not available."
            : undefined
          : "Factory-installed options and equipment could not be verified for this VIN.",
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
    const optionsTotal = parsedOptions.reduce((acc, o) => acc + (o.price || 0), 0);

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
