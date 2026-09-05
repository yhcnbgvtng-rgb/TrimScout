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

/**
 * Porsche: WP0 (911 / 718 / Taycan / Panamera — Zuffenhausen & Leipzig) and
 * WP1 (Macan / Cayenne SUVs). Porsche doesn't share these with any other
 * VW-group brand, so the WMI alone identifies the make.
 */
export function isPorscheVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["WP0", "WP1"].includes(u.slice(0, 3));
}

export function looksLikePorschePaste(paste: string): boolean {
  const raw = (paste || "").trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const hay = `${u.hostname} ${u.pathname} ${u.search}`.toLowerCase();
      if (hay.includes("porsche")) return true;
    } catch {
      /* ignore invalid URL */
    }
  }
  if (/\bporsche\b/i.test(raw)) return true;
  const vin = pastedVinCandidate(raw);
  return !!(vin && isPorscheVin(vin));
}

/**
 * Toyota group, US market: Toyota Motor Manufacturing Kentucky 4T1 (Camry,
 * Avalon) / 4T3 / 4T4; Indiana 5TD (Sienna, Sequoia, Highlander); Texas 5TF
 * (Tundra) / 5TE (Tacoma) / 5TB; Canada 2T1 (Corolla) / 2T3 (RAV4 — confirmed
 * live on a 2026 RAV4 XSE); Mexico 3TM / 3TY (Tacoma) / 3MY (Yaris);
 * Japan-built JTD / JTE / JTK / JTL / JTM / JTN; NUMMI 1NX; 5TY. Lexus rides
 * along on the same engine: JTH / JTJ (Japan), 2T2 (Canada RX), 5TJ.
 */
export function isToyotaVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return [
    "4T1", "4T3", "4T4", "5TD", "5TE", "5TF", "5TB", "5TY", "2T1", "2T3", "3TM", "3TY", "3MY",
    "JTD", "JTE", "JTK", "JTL", "JTM", "JTN", "1NX",
    "JTH", "JTJ", "2T2", "5TJ",
  ].includes(u.slice(0, 3));
}

/**
 * Honda group, US market: 1HG (Ohio cars — confirmed live on a 2026 Accord),
 * 2HG (Canada cars — confirmed on a 2026 Civic), 19X (Alabama/Indiana cars),
 * 5FN / 5FP / 5FR (Alabama SUVs, Odyssey, Passport, Pilot), 5J6 (Ohio CR-V),
 * 7FA (Indiana CR-V — confirmed on a 2026 CR-V Sport), 2HK (Canada CR-V),
 * 3CZ (Mexico HR-V), JHM (Japan), SHH (UK Civic). Acura rides along: 19U,
 * 5J8, 2HN, JH4.
 */
export function isHondaVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return [
    "1HG", "2HG", "19X", "5FN", "5FP", "5FR", "5J6", "7FA", "2HK", "3CZ", "JHM", "SHH",
    "19U", "5J8", "2HN", "JH4",
  ].includes(u.slice(0, 3));
}

function pasteMentions(paste: string, hostWords: RegExp, textWords: RegExp): boolean {
  const raw = (paste || "").trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (hostWords.test(`${u.hostname} ${u.pathname} ${u.search}`.toLowerCase())) return true;
    } catch {
      /* ignore invalid URL */
    }
  }
  return textWords.test(raw);
}

export function looksLikeToyotaPaste(paste: string): boolean {
  if (pasteMentions(paste, /toyota|lexus/, /\b(toyota|lexus)\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isToyotaVin(vin));
}

export function looksLikeHondaPaste(paste: string): boolean {
  if (pasteMentions(paste, /honda|acura/, /\b(honda|acura)\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isHondaVin(vin));
}

/**
 * Nissan (+ Infiniti), confirmed live 2026-09-05 by pulling real active
 * listings and reading their actual VIN prefixes (not assumed from general
 * VIN-decoding references): 5N1 (Smyrna/Canton SUVs — also the block
 * Infiniti's US-built QX60/QX50 ride on), 3N1 (Aguascalientes, Mexico —
 * Versa/Sentra), 1N6 (Titan/Frontier), JN8 / JN1 (Japan-built), 1N4
 * (Altima/Maxima). Infiniti shares 5N1/JN8 with Nissan rather than having
 * its own distinct block in the US-market sample pulled.
 */
export function isNissanVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["5N1", "3N1", "1N6", "JN8", "1N4", "JN1"].includes(u.slice(0, 3));
}

export function looksLikeNissanPaste(paste: string): boolean {
  if (pasteMentions(paste, /nissan|infiniti/, /\b(nissan|infiniti)\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isNissanVin(vin));
}

/**
 * Hyundai, confirmed live 2026-09-05: KM8 (dominant — Alabama/Korea SUVs),
 * KMH (Korea cars). Deliberately excludes 5NM — that WMI showed up in a
 * real Hyundai-brand sample too, but Genesis (built at the same Alabama
 * plant) already claims 5NM exclusively above and got there first; the two
 * brands are genuinely ambiguous on that one prefix, and Genesis has an
 * actual factory-sticker pipeline riding on it, so a 5NM VIN keeps routing
 * there rather than to Hyundai's listing-feed engine.
 */
export function isHyundaiVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["KM8", "KMH"].includes(u.slice(0, 3));
}

export function looksLikeHyundaiPaste(paste: string): boolean {
  if (pasteMentions(paste, /hyundai/, /\bhyundai\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isHyundaiVin(vin));
}

/**
 * Kia, confirmed live 2026-09-05: KND (dominant, Korea), 5XY / 5XX
 * (Georgia), 3KP (Mexico), 7YA (Georgia EV6/EV9 block seen in the sample).
 */
export function isKiaVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["KND", "5XY", "3KP", "7YA", "5XX"].includes(u.slice(0, 3));
}

export function looksLikeKiaPaste(paste: string): boolean {
  if (pasteMentions(paste, /\bkia\b/, /\bkia\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isKiaVin(vin));
}

/** Subaru, confirmed live 2026-09-05: 4S4 (Indiana, dominant), JF2 / JF1 (Japan). */
export function isSubaruVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["4S4", "JF2", "JF1"].includes(u.slice(0, 3));
}

export function looksLikeSubaruPaste(paste: string): boolean {
  if (pasteMentions(paste, /subaru/, /\bsubaru\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isSubaruVin(vin));
}

/** Mazda, confirmed live 2026-09-05: 7MM (Alabama, dominant), JM1 / JM3 (Japan), 3MV (Mexico). */
export function isMazdaVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["7MM", "JM1", "JM3", "3MV"].includes(u.slice(0, 3));
}

export function looksLikeMazdaPaste(paste: string): boolean {
  if (pasteMentions(paste, /mazda/, /\bmazda\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isMazdaVin(vin));
}

/**
 * Volkswagen, confirmed live 2026-09-05: 3VV / 3VW (Mexico, dominant), 1V2
 * (Tennessee — Atlas/ID.4), WVW (Germany). Audi is VW Group but a
 * genuinely separate WMI block (WA1/WAU below), not folded in here.
 */
export function isVolkswagenVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["3VV", "3VW", "1V2", "WVW"].includes(u.slice(0, 3));
}

export function looksLikeVolkswagenPaste(paste: string): boolean {
  if (pasteMentions(paste, /volkswagen|\bvw\b/, /\bvolkswagen\b|\bvw\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isVolkswagenVin(vin));
}

/** Audi, confirmed live 2026-09-05: WA1 (dominant), WAU — both Germany-built. */
export function isAudiVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["WA1", "WAU"].includes(u.slice(0, 3));
}

export function looksLikeAudiPaste(paste: string): boolean {
  if (pasteMentions(paste, /audi/, /\baudi\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isAudiVin(vin));
}

/**
 * BMW, confirmed live 2026-09-05: 5UX (Spartanburg SC, dominant), WBA / WBS
 * / WBX / WB5 (Germany), 3MW (Mexico), 5YM (Spartanburg, seen separately
 * from 5UX in the sample). MINI is BMW-owned but rides on a wholly separate
 * WMI block (WMZ/WMW below), so it gets its own detector, not this one.
 */
export function isBmwVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["5UX", "WBA", "WBS", "3MW", "5YM", "WBX", "WB5"].includes(u.slice(0, 3));
}

export function looksLikeBmwPaste(paste: string): boolean {
  if (pasteMentions(paste, /\bbmw\b/, /\bbmw\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isBmwVin(vin));
}

/** MINI, confirmed live 2026-09-05: WMZ (dominant), WMW — both Germany/UK-built, a separate block from BMW's. */
export function isMiniVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["WMZ", "WMW"].includes(u.slice(0, 3));
}

export function looksLikeMiniPaste(paste: string): boolean {
  if (pasteMentions(paste, /\bmini\b/, /\bmini\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isMiniVin(vin));
}

/**
 * Mercedes-Benz, confirmed live 2026-09-05: W1N (Germany SUVs, dominant),
 * 4JG (Tuscaloosa AL), W1K / W1Y (Germany sedans/coupes), WDC / WDD
 * (Germany, seen in the sample).
 */
export function isMercedesVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["W1N", "4JG", "W1K", "W1Y", "WDC", "WDD"].includes(u.slice(0, 3));
}

export function looksLikeMercedesPaste(paste: string): boolean {
  if (pasteMentions(paste, /mercedes/, /\bmercedes(-|\s)?benz\b|\bmercedes\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isMercedesVin(vin));
}

/** Volvo, confirmed live 2026-09-05: YV4 (dominant, Sweden/China), 7JD (South Carolina), LVY (China). */
export function isVolvoVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["YV4", "7JD", "LVY"].includes(u.slice(0, 3));
}

export function looksLikeVolvoPaste(paste: string): boolean {
  if (pasteMentions(paste, /volvo/, /\bvolvo\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isVolvoVin(vin));
}

/** Mitsubishi, confirmed live 2026-09-05: JA4 (dominant, Japan), ML3 (Thailand), JA3 (Japan). */
export function isMitsubishiVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  return ["JA4", "ML3", "JA3"].includes(u.slice(0, 3));
}

export function looksLikeMitsubishiPaste(paste: string): boolean {
  if (pasteMentions(paste, /mitsubishi/, /\bmitsubishi\b/i)) return true;
  const vin = pastedVinCandidate(paste);
  return !!(vin && isMitsubishiVin(vin));
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
