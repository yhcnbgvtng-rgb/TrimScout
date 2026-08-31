export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getGmSticker, isGmVin } from "@/lib/gmSticker";
import { findSimilarGmVehicles, isUsableHuntLocation } from "@/lib/vinSearch";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const subjectVin = String(body?.subjectVin || body?.vin || "")
    .trim()
    .toUpperCase();
  if (subjectVin.length !== 17 || !isGmVin(subjectVin)) {
    return NextResponse.json(
      { error: "A Chevrolet/GM subject VIN is required." },
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

  if (!isUsableHuntLocation(zip, radiusMiles)) {
    return NextResponse.json({
      success: true,
      needsLocation: true,
      matches: [],
      dropped: [],
      note: "Enter a 5-digit ZIP and a search radius in miles to see two sticker-matched lots in range.",
    });
  }

  try {
    const subject = await getGmSticker(subjectVin);
    const result = await findSimilarGmVehicles({
      subjectVin,
      subject,
      mustHaveLines,
      niceToHaveLines,
      zip,
      radiusMiles,
    });
    return NextResponse.json({
      success: true,
      subjectStatus: subject.status,
      fetchSource: subject.fetchSource,
      fetchKind: subject.fetchKind,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Comparable search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
