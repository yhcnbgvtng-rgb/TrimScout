// Server-side: narrow a Ford window sticker's raw option lines to the Ford option policy (#455/#456) for the car's
// model, year and trim — paid packages, options, paint and powertrain only, under the policy's names and prices.
// No policy for the car (other make/model/year, or a trim the policy doesn't trust) -> the current list, glyphs stripped.
import {
  buildAllowlist,
  modelPoliciesFor,
  optionRowsForVehicle,
} from "../scrapers/lightsail-crawler/src/factoryOptionAllowlist.js";
import fordPolicies from "../scrapers/lightsail-crawler/src/optionPolicies/ford-2026.json";
import { cleanOptionNames, stripNonPrinting } from "./mustHaveOptions";

export interface MustHaveOption {
  name: string;
  code: string | null;
  description: string;
  price: number | null;
  isPackageChild?: boolean;
  source?: "sticker";
}

interface PolicyVehicle {
  make?: string | null;
  model?: string | null;
  year?: number | string | null;
  trim?: string | null;
}

let allowlist: unknown = null;
function fordAllowlist() {
  if (!allowlist) allowlist = buildAllowlist(null, fordPolicies as never);
  return allowlist;
}

export function applyFordOptionPolicy(vehicle: PolicyVehicle, options: MustHaveOption[]): MustHaveOption[] {
  const fallback = () => cleanOptionNames(options);
  if (String(vehicle.make || "").trim().toLowerCase() !== "ford") return fallback();
  const v = { make: "Ford", model: vehicle.model || "", year: vehicle.year || "", trim: vehicle.trim || "" };
  try {
    const al = fordAllowlist();
    if (!modelPoliciesFor(al, v).length) return fallback();
    const cleaned = cleanOptionNames(options);
    const res = optionRowsForVehicle(al, v, cleaned.map((o) => ({ name: o.name, code: o.code })));
    if (!res) return fallback();
    return (res.rows as Array<{ label: string; code: string | null; price: number | null }>).map((r) => ({
      name: stripNonPrinting(r.label),
      code: r.code ?? null,
      description: stripNonPrinting(r.label),
      price: r.price ?? null,
      source: "sticker" as const,
    }));
  } catch {
    return fallback();
  }
}
