// GET /api/admin/dealerships/export?format=csv|xlsx — the whole contact
// directory as a downloadable file. Admin-only: this is the one place the
// site hands out dealer email addresses in bulk, which is exactly why the
// buyer-facing lookup routes never do (see lib/dealerContactLookup.ts).
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listDealerships, DealershipsApiError } from "@/lib/dealershipsApi";
import { dealershipsToCsv, dealershipExportFilename } from "@/lib/dealershipCsv";
import { buildDealershipXlsxBuffer } from "@/lib/dealershipXlsx";

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const format = new URL(req.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  let dealerships;
  try {
    dealerships = await listDealerships();
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not load dealerships.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const filename = dealershipExportFilename(format);
  const disposition = `attachment; filename="${filename}"`;

  if (format === "xlsx") {
    const buffer = await buildDealershipXlsxBuffer(dealerships);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
      },
    });
  }

  // BOM so Excel opens the UTF-8 file with accented dealer names intact.
  return new NextResponse("﻿" + dealershipsToCsv(dealerships), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
    },
  });
}
