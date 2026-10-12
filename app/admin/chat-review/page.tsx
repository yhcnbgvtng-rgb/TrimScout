export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ChatReviewClient from "./ChatReviewClient";

export default async function AdminChatReviewPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || role !== "admin") redirect("/");
  return <ChatReviewClient />;
}
