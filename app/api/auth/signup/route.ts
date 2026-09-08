import { NextResponse } from "next/server";
import { signup, AuthApiError } from "@/lib/authApi";
import { signIn } from "@/auth";
import { verifyDealerSignupInviteToken } from "@/lib/dealerSignupInvite";
import { listDealerships } from "@/lib/dealershipsApi";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password, name, role, phone, zipCode, dealerName, dealerInviteId, dealerInviteToken } = body || {};
  if (!email || !password || !name) {
    return NextResponse.json({ error: "Email, password, and name are required" }, { status: 400 });
  }

  // A dealer signing up from a valid invite link gets the dealership's
  // real name from the invite itself — never whatever the client posted
  // for dealerName, which someone could tamper with (devtools, a replayed
  // request) even though the field is locked/read-only in the UI. No
  // valid invite present just falls through to the manual-entry value,
  // same as before this existed.
  let resolvedDealerName = dealerName;
  if (role === "dealer" && dealerInviteId && dealerInviteToken) {
    if (!verifyDealerSignupInviteToken(String(dealerInviteId), String(dealerInviteToken))) {
      return NextResponse.json({ error: "This dealer invite link is invalid or has expired." }, { status: 400 });
    }
    const dealerships = await listDealerships();
    const invited = dealerships.find((d) => d.id === String(dealerInviteId));
    if (!invited) {
      return NextResponse.json({ error: "This dealer invite link is invalid or has expired." }, { status: 400 });
    }
    resolvedDealerName = invited.dealerName;
  }

  try {
    await signup({
      email,
      password,
      name,
      role: role === "dealer" ? "dealer" : "buyer",
      phone,
      zipCode,
      dealerName: resolvedDealerName,
    });
  } catch (err) {
    const status = err instanceof AuthApiError ? err.status : 500;
    const message = err instanceof AuthApiError ? err.message : "Signup failed";
    return NextResponse.json({ error: message }, { status });
  }

  // Signing the user in server-side (not just creating the row) so the
  // client only needs to redirect/refresh, matching what a real sign-in
  // flow does — no separate "now go log in" step for a brand-new account.
  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch {
    // Account was created successfully even if the auto-sign-in step
    // fails for some reason; the user can still sign in manually.
  }

  return NextResponse.json({ success: true });
}
