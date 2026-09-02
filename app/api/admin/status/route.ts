import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { adminSetStatus, AuthApiError } from "@/lib/authApi";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = body?.email;
  const status = body?.status;
  if (!email || !["active", "suspended", "pending_verification"].includes(status)) {
    return NextResponse.json({ error: "email and a valid status are required." }, { status: 400 });
  }

  try {
    const user = await adminSetStatus(email, status);
    return NextResponse.json({ user });
  } catch (err) {
    const message = err instanceof AuthApiError ? err.message : "Could not update status.";
    const httpStatus = err instanceof AuthApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}
