import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { adminSetDealerName, AuthApiError } from "@/lib/authApi";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const dealerName = typeof body?.dealerName === "string" ? body.dealerName.trim() : "";
  if (!email || !dealerName) {
    return NextResponse.json({ error: "email and dealerName are required." }, { status: 400 });
  }

  try {
    const user = await adminSetDealerName(email, dealerName);
    return NextResponse.json({ user });
  } catch (err) {
    const message = err instanceof AuthApiError ? err.message : "Could not update dealer name.";
    const httpStatus = err instanceof AuthApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}
