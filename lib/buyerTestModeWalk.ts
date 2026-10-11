import type { RfqRequest } from "./rfq";

/** The ids "walk away from all my test requests" acts on: still open AND flagged audit=1. Real requests are never listed. */
export function testRequestsToWalk(rfqs: Pick<RfqRequest, "id" | "status" | "audit" | "auditForcedSafeMode">[]): string[] {
  return rfqs.filter((r) => r.status === "collecting" && (r.audit === true || r.auditForcedSafeMode === true)).map((r) => String(r.id));
}
