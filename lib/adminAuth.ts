import { auth } from "@/auth";

// Shared guard for every /api/admin/* route — mirrors the same role check
// app/admin/page.tsx uses to gate the page itself, so an API route can never
// be reached by a non-admin even if they know the URL.
export async function requireAdminSession() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || role !== "admin") {
    return null;
  }
  return session;
}
