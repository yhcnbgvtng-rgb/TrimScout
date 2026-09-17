/**
 * Product analytics, the same way the spend guard does it: one structured
 * JSON line per event in the server logs (POST /api/events/track), plus a
 * console line in the browser so QA harnesses can grep it. Fire-and-forget;
 * never blocks the UI and never carries a full VIN or an email.
 */

export const TRACKED_EVENTS = ["factory_build_pending", "factory_build_retry", "factory_build_notify_requested", "vehicle_saved_for_later", "vehicle_resumed"] as const;
export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

export type EventProps = Record<string, string | number | boolean | null>;

export function isTrackedEvent(name: unknown): name is TrackedEvent {
  return typeof name === "string" && (TRACKED_EVENTS as readonly string[]).includes(name);
}

/** WMI + VDS + check digit + model year + plant (positions 1–11): identifies the build, never the unit. */
export function vinPrefix(vin: string | null | undefined): string | null {
  const clean = (vin || "").trim().toUpperCase();
  return clean.length === 17 ? clean.slice(0, 11) : null;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The factory_build_pending payload from the spec: { make, vinPrefix, dealerHost }. */
export function factoryBuildPendingProps(vehicle: { vin: string; make: string; dealerUrl?: string | null }): EventProps {
  return { make: vehicle.make || "", vinPrefix: vinPrefix(vehicle.vin), dealerHost: hostOf(vehicle.dealerUrl) };
}

export function trackEvent(name: TrackedEvent, props: EventProps = {}, fetchImpl: typeof fetch | null = typeof fetch === "function" ? fetch : null): void {
  const line = { event: name, ...props };
  if (typeof console !== "undefined") console.info(`[trimscout:event] ${JSON.stringify(line)}`);
  if (!fetchImpl) return;
  try {
    fetchImpl("/api/events/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, props }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // a beacon that can't be sent is not the buyer's problem
  }
}
