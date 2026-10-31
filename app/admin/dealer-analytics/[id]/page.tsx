export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import DealerDetailClient from "./DealerDetailClient";

export default async function AdminDealerAnalyticsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || role !== "admin") redirect("/");
  return <DealerDetailClient id={(await params).id} />;
}
