import { NextResponse } from "next/server";
import { signup, AuthApiError } from "@/lib/authApi";
import { signIn } from "@/auth";
import { verifyDealerSignupInviteToken } from "@/lib/dealerSignupInvite";
import { listDealerships } from "@/lib/dealershipsApi";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { clientIpFromHeaders } from "@/lib/clientIp";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password, name, role, phone, zipCode, dealerName, dealerInviteId, dealerInviteToken, turnstileToken } =
    body || {};
  if (!email || !password || !name) {
    return NextResponse.json({ error: "Email, password, and name are required" }, { status: 400 });
  }

  const turnstileOk = await verifyTurnstileToken(turnstileToken, clientIpFromHeaders(req.headers));
  if (!turnstileOk) {
    return NextResponse.json({ error: "Verification check failed — please try again." }, { status: 400 });
  }

  // A dealer signing up from a valid invite link gets the dealership's
  // real name from the invite itself — never whatever the client posted
  // for dealerName, which someone could tamper with (devtools, a replayed
  // request) even though the field is locked/read-only in the UI. No
  // valid invite present just falls through to the manual-entry value,
  // same as before this existed.
  let resolvedDealerName = dealerName;
  let isVerifiedDealerInvite = false;
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
    isVerifiedDealerInvite = true;
  }

  // A dealer signing up WITHOUT a verified admin invite could be anyone
  // claiming to be that dealership — nothing has checked they actually
  // work there. Land them in pending_verification (the box's login check
  // already rejects any non-'active' status with 403) until an admin
  // reviews and approves them from /admin. An invited dealer already went
  // through that check when the admin generated their invite, so they go
  // straight to active, same as a buyer always has.
  const accountStatus = role === "dealer" && !isVerifiedDealerInvite ? "pending_verification" : "active";

  try {
    await signup({
      email,
      password,
      name,
      role: role === "dealer" ? "dealer" : "buyer",
      phone,
      zipCode,
      dealerName: resolvedDealerName,
      status: accountStatus,
    });
  } catch (err) {
    const status = err instanceof AuthApiError ? err.status : 500;
    const message = err instanceof AuthApiError ? err.message : "Signup failed";
    return NextResponse.json({ error: message }, { status });
  }

  if (accountStatus === "pending_verification") {
    // Don't attempt to sign in — verify-credentials would just reject a
    // non-'active' account, and there's no session to hand back yet.
    return NextResponse.json({ success: true, status: accountStatus });
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

  return NextResponse.json({ success: true, status: accountStatus });
}
