import { NextResponse } from "next/server";
import { fetchCrawlHistoryFromBox } from "@/lib/lightsailClient";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || undefined;

  const result = await fetchCrawlHistoryFromBox(date);
  if (!result) {
    return NextResponse.json({ error: "Could not reach the crawl-history API." }, { status: 502 });
  }
  return NextResponse.json(result);
}
