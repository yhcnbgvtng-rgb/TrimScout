export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ApprovalsClient from "./ApprovalsClient";

export default async function AdminApprovalsPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || role !== "admin") redirect("/");
  return <ApprovalsClient />;
}
