export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { FORD_LISTINGS_LOAD_FAILED } from "@/lib/fordCompetitionUi";
import { getStellantisSticker, isStellantisVin } from "@/lib/stellantisSticker";
import { findSimilarStellantisVehicles } from "@/lib/stellantisVinSearch";
import { hasListingsApiKey, isUsableHuntLocation } from "@/lib/vinSearch";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const subjectVin = String(body?.subjectVin || body?.vin || "")
    .trim()
    .toUpperCase();
  if (subjectVin.length !== 17 || !isStellantisVin(subjectVin)) {
    return NextResponse.json(
      { error: "A Chrysler, Dodge, Jeep, or Ram subject VIN is required." },
      { status: 400 }
    );
  }

  const mustHaveLines: string[] = Array.isArray(body?.mustHaveLines)
    ? body.mustHaveLines.map(String).filter(Boolean)
    : [];
  const niceToHaveLines: string[] = Array.isArray(body?.niceToHaveLines)
    ? body.niceToHaveLines.map(String).filter(Boolean)
    : [];
  const zip = String(body?.zip || "").trim();
  const radiusMiles = Number(body?.radiusMiles);
  const rawSubjectPrice = Number(body?.subjectListingPrice);
  const subjectListingPrice = Number.isFinite(rawSubjectPrice) && rawSubjectPrice > 0 ? rawSubjectPrice : undefined;

  if (!isUsableHuntLocation(zip, radiusMiles)) {
    return NextResponse.json({
      success: true,
      needsLocation: true,
      matches: [],
      dropped: [],
      hasListingsKey: hasListingsApiKey(),
      note: "Enter a 5-digit ZIP and a search radius in miles to see two matching lots in range.",
    });
  }

  try {
    const subject = await getStellantisSticker(subjectVin);
    const result = await findSimilarStellantisVehicles({
      subjectVin,
      subject,
      mustHaveLines,
      niceToHaveLines,
      zip,
      radiusMiles,
      subjectListingPrice,
    });
    return NextResponse.json({
      success: true,
      subjectStatus: subject.status,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Comparable search failed";
    console.error("stellantis-comparables failed:", message);
    return NextResponse.json(
      {
        error: FORD_LISTINGS_LOAD_FAILED,
        note: FORD_LISTINGS_LOAD_FAILED,
        matches: [],
        dropped: [],
      },
      { status: 502 }
    );
  }
}
