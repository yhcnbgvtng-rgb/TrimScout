export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import DealershipsClient from "./DealershipsClient";

export default async function AdminDealershipsPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session?.user || role !== "admin") {
    redirect("/");
  }

  return <DealershipsClient />;
}
