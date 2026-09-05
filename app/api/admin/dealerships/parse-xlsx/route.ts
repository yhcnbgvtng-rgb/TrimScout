export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { parseDealershipXlsxBuffer } from "@/lib/dealershipXlsx";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A .xlsx file is required." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseDealershipXlsxBuffer(buffer);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json(
      { error: "Could not read that file. Make sure it's a valid .xlsx workbook." },
      { status: 400 }
    );
  }
}
