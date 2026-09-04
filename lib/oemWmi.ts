/**
 * Client-safe WMI routing for OEM factory-build paths.
 * Keep this module free of Node fs / PDF I/O so the bidding wizard can import it.
 */

export function isFordOrLincolnVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  const wmi = u.slice(0, 3);
  if (/^[123]F/.test(u)) return true;
  if (["1LN", "5LM", "2LM", "3LN", "1L1", "5L1"].includes(wmi)) return true;
  return false;
}

/**
 * Chevrolet USA: 1G1 (cars), 1GC (trucks), 1GN (MPV/SUV).
 * Canada / Mexico GM: 2G* / 3G* (e.g. 2GC Chevrolet).
 * Related GM brands that share cws.gm.com builds: Buick 1G4, Cadillac 1G6,
 * GMC 1GT/1GK/1GB, Chevy van 1GA.
 *
 * GM also builds current models outside North America under WMIs the
 * `[123]G` pattern above doesn't reach — each confirmed live against a real
 * VIN, not assumed: Cadillac Escalade/Lyriq (1GY, US-built but a distinct
 * block from 1G6), Buick Enclave (5GA, a separate US block), Buick Encore GX
 * (KL4, GM Korea) and Buick Envision (LRB, GM China/SAIC-GM). Only the
 * exact confirmed codes are listed here, not a broad "KL"/"L" prefix, since
 * those ranges are shared with unrelated automakers in Korea/China.
 */
export function isGmVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  const wmi = u.slice(0, 3);
  if (
    ["1G1", "1GC", "1GN", "1GA", "1GB", "1GT", "1GK", "1G4", "1G6", "1GY", "5GA", "KL4", "LRB"].includes(
      wmi
    )
  ) {
    return true;
  }
  if (/^[23]G/.test(u)) return true;
  return false;
}

/**
 * Stellantis (Chrysler / Dodge / Jeep / Ram — Fiat/Alfa Romeo share these too):
 * US 1C3 (car), 1C4 (MPV/SUV), 1C6 (truck). Mexico 3C4/3C6/3C7. Canada
 * (Windsor/Brampton) 2C3/2C4/2C8/2A4/2A8/2B3. Unlike Ford/GM, the WMI does
 * not distinguish the brand — Chrysler/Dodge/Jeep/Ram share these ranges, so
 * this only confirms "Stellantis," never which brand. The brand comes from
 * the parsed sticker text itself.
 */
export function isStellantisVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  const wmi = u.slice(0, 3);
  return [
    "1C3", "1C4", "1C6",
    "3C4", "3C6", "3C7",
    "2C3", "2C4", "2C8", "2A4", "2A8", "2B3",
  ].includes(wmi);
}

/**
 * Genesis: KMG/KMT/KMU (Ulsan, Korea) and 5NM (Hyundai Motor Manufacturing
 * Alabama). Unlike Stellantis, the WMI reliably identifies the brand on its
 * own — Genesis doesn't share these ranges with Hyundai's own passenger-car
 * WMIs (KMH).
 */
export function isGenesisVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  const wmi = u.slice(0, 3);
  return ["KMG", "KMT", "KMU", "5NM"].includes(wmi);
}

export function pastedVinCandidate(raw: string): string | null {
  const m = (raw || "").trim().toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  return m ? m[0] : null;
}

export function looksLikeGmPaste(paste: string): boolean {
  const raw = (paste || "").trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const hay = `${u.hostname} ${u.pathname} ${u.search}`.toLowerCase();
      if (
        hay.includes("chevrolet") ||
        hay.includes("chevy") ||
        hay.includes("cws.gm.com") ||
        hay.includes("gm.com") ||
        hay.includes("gmc.com") ||
        hay.includes("buick") ||
        hay.includes("cadillac")
      ) {
        return true;
      }
    } catch {
      /* ignore invalid URL */
    }
  }
  const lower = raw.toLowerCase();
  if (
    lower.includes("chevrolet") ||
    lower.includes("chevy") ||
    (lower.includes("windowsticker") && lower.includes("gm")) ||
    /\bgmc\b/.test(lower) ||
    lower.includes("buick") ||
    lower.includes("cadillac") ||
    lower.includes("cws.gm.com")
  ) {
    return true;
  }
  const vin = pastedVinCandidate(raw);
  return !!(vin && isGmVin(vin));
}

export function looksLikeStellantisPaste(paste: string): boolean {
  const raw = (paste || "").trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const hay = `${u.hostname} ${u.pathname} ${u.search}`.toLowerCase();
      if (
        hay.includes("jeep.com") ||
        hay.includes("chrysler.com") ||
        hay.includes("dodge.com") ||
        hay.includes("ramtrucks.com") ||
        hay.includes("mopar.com") ||
        hay.includes("hostd/windowsticker")
      ) {
        return true;
      }
    } catch {
      /* ignore invalid URL */
    }
  }
  const lower = raw.toLowerCase();
  if (
    /\bjeep\b/.test(lower) ||
    lower.includes("chrysler") ||
    /\bdodge\b/.test(lower) ||
    /\bram\b/.test(lower) ||
    lower.includes("mopar") ||
    lower.includes("stellantis")
  ) {
    return true;
  }
  const vin = pastedVinCandidate(raw);
  return !!(vin && isStellantisVin(vin));
}

export function looksLikeGenesisPaste(paste: string): boolean {
  const raw = (paste || "").trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const hay = `${u.hostname} ${u.pathname} ${u.search}`.toLowerCase();
      if (hay.includes("genesis.com")) {
        return true;
      }
    } catch {
      /* ignore invalid URL */
    }
  }
  const lower = raw.toLowerCase();
  if (/\bgenesis\b/.test(lower)) {
    return true;
  }
  const vin = pastedVinCandidate(raw);
  return !!(vin && isGenesisVin(vin));
}

/** Maps a shopper-facing make onto the inventory brand code used by deal-requests. */
export function brandCodeFromMake(make: string): string {
  const m = (make || "").trim().toLowerCase();
  if (m.includes("ford") || m.includes("lincoln")) return "ford";
  if (
    m.includes("chevrolet") ||
    m.includes("chevy") ||
    m.includes("gmc") ||
    m.includes("cadillac") ||
    m.includes("buick")
  ) {
    return "chevrolet";
  }
  if (m.includes("porsche")) return "porsche";
  if (m.includes("acura")) return "acura";
  if (m.includes("audi")) return "audi";
  if (m.includes("mclaren")) return "mclaren";
  return m.replace(/[^a-z0-9]+/g, "") || "ford";
}

export function looksLikeFordPaste(paste: string): boolean {
  const raw = (paste || "").trim();
  if (!raw) return false;
  if (/ford|lincoln|forddirect/i.test(raw)) return true;
  const vin = pastedVinCandidate(raw);
  return !!(vin && isFordOrLincolnVin(vin));
}
