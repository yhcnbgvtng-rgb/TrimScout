import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { adminResetPassword, AuthApiError } from "@/lib/authApi";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = body?.email;
  const newPassword = body?.newPassword;
  if (!email || !newPassword) {
    return NextResponse.json({ error: "email and newPassword are required." }, { status: 400 });
  }

  try {
    await adminResetPassword(email, newPassword);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof AuthApiError ? err.message : "Could not reset password.";
    const status = err instanceof AuthApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
