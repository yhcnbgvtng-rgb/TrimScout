import { NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/dealerUnsubscribe";
import { setDealershipEmailOptOut, DealershipsApiError } from "@/lib/dealershipsApi";

// Public, unauthenticated — this is the link a dealer clicks straight from
// an email, not something reached from inside the signed-in app. The HMAC
// token (see lib/dealerUnsubscribe.ts) is what stands in for auth here: a
// forged id/token pair can't verify without the shared signing secret.
function htmlPage(title: string, body: string, status: number): NextResponse {
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0a0d0e;color:#e5e7eb;
    display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
  .card{max-width:440px;text-align:center;background:#12171a;border:1px solid #232c2f;
    border-radius:20px;padding:36px 28px;}
  h1{font-size:18px;margin:0 0 12px;color:#fff;}
  p{font-size:14px;line-height:1.6;color:#9aa5a8;margin:0;}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
  return new NextResponse(page, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = (searchParams.get("id") || "").trim();
  const token = (searchParams.get("token") || "").trim();

  if (!id || !token || !verifyUnsubscribeToken(id, token)) {
    return htmlPage(
      "Link not valid",
      "This unsubscribe link is invalid or has expired. If you're still receiving offers you'd like to stop, reply to the email directly and we'll take care of it.",
      400
    );
  }

  try {
    await setDealershipEmailOptOut(id);
  } catch (err) {
    if (err instanceof DealershipsApiError && err.status === 404) {
      return htmlPage("Already handled", "We couldn't find this dealership on file — you may already be unsubscribed.", 200);
    }
    return htmlPage(
      "Something went wrong",
      "We couldn't process this request right now. Please try again in a few minutes.",
      502
    );
  }

  return htmlPage(
    "You're unsubscribed",
    "TrimScout will no longer email this dealership about buyer offers. If this was a mistake, contact us and we'll re-enable it.",
    200
  );
}
