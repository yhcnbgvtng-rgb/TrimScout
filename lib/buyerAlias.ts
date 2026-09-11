/**
 * The name a dealer sees instead of the buyer's.
 *
 * It used to be "Buyer #<state>" on the buyer's side and "Buyer #<db id>" on
 * the dealer's, so the two never matched, every buyer in New Jersey was the
 * same "Buyer #NJ", and the dealer-facing form leaked a sequential row id.
 * Now one stable, per-buyer code derived from the user id — the same string
 * wherever it's shown, individual to the buyer, and not a database key.
 */

const ALIAS_LENGTH = 5;
// No 0/O/1/I — the alias gets read aloud on the phone and typed into notes.
const ALIAS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** FNV-1a: tiny, dependency-free, stable across Node and the browser. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** "K7M3Q" — the code part alone, for anywhere that supplies its own prefix. */
export function buyerAliasCode(userId: string | number | null | undefined): string | null {
  const id = userId == null ? "" : String(userId).trim();
  if (!id) return null;
  // Two rounds with different salts so short numeric ids don't cluster.
  let a = fnv1a(`trimscout-buyer:${id}`);
  let b = fnv1a(`${id}:alias-v1`);
  let out = "";
  for (let i = 0; i < ALIAS_LENGTH; i++) {
    const mixed = (a ^ (b >>> (i * 3))) >>> 0;
    out += ALIAS_ALPHABET[mixed % ALIAS_ALPHABET.length];
    a = fnv1a(`${a}:${i}`);
    b = fnv1a(`${i}:${b}`);
  }
  return out;
}

/** "Buyer #K7M3Q", or plain "Buyer" until the buyer has an account to derive it from. */
export function formatBuyerAlias(userId: string | number | null | undefined): string {
  const code = buyerAliasCode(userId);
  return code ? `Buyer #${code}` : "Buyer";
}
