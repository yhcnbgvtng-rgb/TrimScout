/**
 * Factory-sticker check for the two alternates in the Configure Quote Request compare.
 *
 * The same /api/gm-sticker import the same-spec lane uses, once per alternate VIN, Chevrolet and GMC only. Answers are
 * cached for the session. GM's answers are respected: an unreleased or unavailable sticker is a final answer (no retry),
 * and a refusal (403/429) stops every further sticker request until the page reloads.
 */
import { importPastedFactoryVehicle } from "./pasteImport";
import type { Vehicle } from "./types";

export type AltStickerState =
  | { status: "checking" }
  | { status: "verified" }
  | { status: "unreleased" }
  | { status: "unverified" };

export type AltStickerResult = { state: Exclude<AltStickerState, { status: "checking" }>; vehicle?: Vehicle };

const GM_ALT_MAKES = new Set(["chevrolet", "gmc"]);
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

const answers = new Map<string, Promise<AltStickerResult>>();
let refused = false;

export function resetAltStickerCache(): void {
  answers.clear();
  refused = false;
}

/** A new Chevrolet/GMC alternate that no factory sticker has been read for yet. */
export function needsAltSticker(v: Vehicle | null): v is Vehicle {
  if (!v || v.buildConfidence === "verified_factory") return false;
  if (v.condition === "used" || v.condition === "cpo") return false;
  return GM_ALT_MAKES.has((v.make || "").trim().toLowerCase()) && VIN.test((v.vin || "").toUpperCase());
}

export function fetchAltSticker(vin: string, fetchImpl: typeof fetch = fetch): Promise<AltStickerResult> {
  const key = vin.trim().toUpperCase();
  const cached = answers.get(key);
  if (cached) return cached;
  if (refused) return Promise.resolve({ state: { status: "unverified" } });
  const run = importPastedFactoryVehicle(key, fetchImpl, { vin: key })
    .then((r): AltStickerResult => {
      if (!r.ok) return { state: { status: r.unreleased ? "unreleased" : "unverified" } };
      if (r.stickerBlocked) {
        refused = true;
        return { state: { status: "unverified" } };
      }
      if (r.buildConfidence === "verified_factory") return { state: { status: "verified" }, vehicle: r.vehicle };
      if (r.stickerUnavailable) return { state: { status: "unverified" } };
      return { state: { status: r.factoryBuildUnavailable ? "unreleased" : "unverified" } };
    })
    .catch((): AltStickerResult => ({ state: { status: "unverified" } }));
  answers.set(key, run);
  return run;
}

/** The alternate with what the sticker read: its options and packages, "factory verified", and the sticker's own trim (the favorite's spelling too). */
export function withStickerFacts(alt: Vehicle, sticker: Vehicle): Vehicle {
  return {
    ...alt,
    options: sticker.options,
    packages: sticker.packages,
    buildConfidence: "verified_factory",
    ...(sticker.trim ? { trim: sticker.trim, trimSource: "sticker" as const } : {}),
  };
}

/** What the compare table says where it cannot score an alternate's must-haves. */
export function unverifiedLabel(state: AltStickerState | undefined): string {
  if (state?.status === "checking") return "Checking factory sticker…";
  if (state?.status === "unreleased") return "Sticker not published by GM yet";
  return "Not verified";
}
