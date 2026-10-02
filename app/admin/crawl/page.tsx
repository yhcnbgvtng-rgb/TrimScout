export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import CrawlSheetClient from "./CrawlSheetClient";

export default async function AdminCrawlSheetPage({ searchParams }: { searchParams: Promise<{ vin?: string }> }) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || role !== "admin") {
    redirect("/");
  }
  // ?vin=… (the wizard's VIN links) opens the Vehicles tab straight onto that VIN's history.
  const vin = ((await searchParams).vin || "").trim().toUpperCase();
  return <CrawlSheetClient initialVin={/^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null} />;
}
