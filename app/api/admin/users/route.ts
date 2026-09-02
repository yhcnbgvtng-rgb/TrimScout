import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listUsers, AuthApiError } from "@/lib/authApi";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (err) {
    const message = err instanceof AuthApiError ? err.message : "Could not load accounts.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
