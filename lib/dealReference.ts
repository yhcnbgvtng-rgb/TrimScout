/**
 * A short, individual deal number the buyer can see from the review step on
 * and quote back to us — "TS-7K3M9Q".
 *
 * The backend assigns its own id when the request is created, but that's
 * after the buyer has already committed. This one is minted when the wizard
 * opens, rides along in deal_structure_json, and is the same number on the
 * review screen, the confirmation, and anything a dealer is shown.
 */

export const DEAL_REFERENCE_PREFIX = "TS-";
const CODE_LENGTH = 6;
// No 0/O/1/I — see buyerAlias.ts.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEAL_REFERENCE_PATTERN = /^TS-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
    return bytes;
  }
  // No Web Crypto (very old runtime): still unique enough for a reference
  // that is never used as a secret.
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function newDealReference(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return DEAL_REFERENCE_PREFIX + code;
}

/** Accepts only the exact shape we mint — anything else is dropped, not stored. */
export function isDealReference(value: unknown): value is string {
  return typeof value === "string" && DEAL_REFERENCE_PATTERN.test(value.trim().toUpperCase());
}

export function normalizeDealReference(value: unknown): string | undefined {
  if (!isDealReference(value)) return undefined;
  return value.trim().toUpperCase();
}
