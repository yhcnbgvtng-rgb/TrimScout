import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getFactoryBuild } from "@/lib/factoryBuildStore";
import { runFactoryBuildPipeline } from "@/lib/factoryBuildPipeline";

function cleanVinParam(raw: string | null): string {
  return (raw || "").trim().toUpperCase();
}

/** QA hook: given VIN from Lightsail inventory (or any VIN), report the stored factoryBuild — sticker found? parse OK? option count? pending? */
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const vin = cleanVinParam(new URL(req.url).searchParams.get("vin"));
  if (vin.length !== 17) {
    return NextResponse.json({ error: "vin (17 characters) is required." }, { status: 400 });
  }

  const build = await getFactoryBuild(vin);
  if (!build) {
    return NextResponse.json({ error: `No factoryBuild on file for ${vin}. POST to run the pipeline.` }, { status: 404 });
  }
  return NextResponse.json({ build });
}

/** Runs the acquire -> normalize -> canonicalize -> enrich -> upsert job for one VIN. Idempotent — safe to re-run. */
export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const vin = cleanVinParam(typeof body?.vin === "string" ? body.vin : null);
  if (vin.length !== 17) {
    return NextResponse.json({ error: "vin (17 characters) is required." }, { status: 400 });
  }

  try {
    const build = await runFactoryBuildPipeline(vin, { enrich: body?.enrich !== false });
    return NextResponse.json({ build });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not run the factory build pipeline.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
