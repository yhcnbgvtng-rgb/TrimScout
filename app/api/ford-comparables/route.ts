export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getFordSticker, isFordOrLincolnVin } from "@/lib/fordSticker";
import {
  DEFAULT_COMPARE_RADIUS_MILES,
  DEFAULT_COMPARE_ZIP,
  findSimilarFordVehicles,
} from "@/lib/vinSearch";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const subjectVin = String(body?.subjectVin || body?.vin || "")
    .trim()
    .toUpperCase();
  if (subjectVin.length !== 17 || !isFordOrLincolnVin(subjectVin)) {
    return NextResponse.json(
      { error: "A Ford or Lincoln subject VIN is required." },
      { status: 400 }
    );
  }

  const mustHaveLines: string[] = Array.isArray(body?.mustHaveLines)
    ? body.mustHaveLines.map(String).filter(Boolean)
    : [];
  const niceToHaveLines: string[] = Array.isArray(body?.niceToHaveLines)
    ? body.niceToHaveLines.map(String).filter(Boolean)
    : [];
  const zip = String(body?.zip || DEFAULT_COMPARE_ZIP).trim() || DEFAULT_COMPARE_ZIP;
  const radiusMiles = Number(body?.radiusMiles) > 0 ? Number(body.radiusMiles) : DEFAULT_COMPARE_RADIUS_MILES;

  try {
    const subject = await getFordSticker(subjectVin);
    const result = await findSimilarFordVehicles({
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
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Comparable search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
