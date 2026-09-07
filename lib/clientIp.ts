// Shared by middleware.ts (Edge runtime) and lib/apiSpendGuard.ts (Node
// route handlers) — both need the same "best guess at the caller's IP"
// logic, and duplicating it risked the two silently drifting.
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") || "unknown";
}
