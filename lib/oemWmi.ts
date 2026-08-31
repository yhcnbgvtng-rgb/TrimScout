/**
 * Client-safe WMI routing for OEM window-sticker paths.
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
 * Canada / Mexico GM: 2G* / 3G*.
 * Related GM brands that share cws.gm.com stickers: Buick 1G4, Cadillac 1G6,
 * GMC 1GT/1GK/1GB, Chevy van 1GA.
 */
export function isGmVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  const wmi = u.slice(0, 3);
  if (["1G1", "1GC", "1GN", "1GA", "1GB", "1GT", "1GK", "1G4", "1G6"].includes(wmi)) {
    return true;
  }
  if (/^[23]G/.test(u)) return true;
  return false;
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
    lower.includes("windowsticker") && lower.includes("gm") ||
    /\bgmc\b/.test(lower) ||
    lower.includes("buick") ||
    lower.includes("cadillac") ||
    lower.includes("cws.gm.com")
  ) {
    return true;
  }
  const vin = raw.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  return !!(vin && isGmVin(vin[0]));
}

export function looksLikeFordPaste(paste: string): boolean {
  const raw = (paste || "").trim();
  if (!raw) return false;
  if (/ford|lincoln|forddirect/i.test(raw)) return true;
  const vin = raw.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  return !!(vin && isFordOrLincolnVin(vin[0]));
}
