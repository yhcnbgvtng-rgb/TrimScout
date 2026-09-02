// Detects real contact vectors in free-text buyer comments — the masked-
// identity model only works if a buyer can't just paste their email/phone
// into a comment box and hand a dealer a way around it. This deliberately
// does NOT try to detect bare personal names (no reliable way to do that
// without false-positiving on ordinary words), since a name alone isn't a
// contact method — only email/phone/link/handle/solicitation phrases are.
// Mirrored (not shared code — separate runtime) in
// scrapers/lightsail-crawler/src/deals_api_server.js as the authoritative
// server-side check; this copy is for instant client-side feedback and the
// Next.js route's own validation.
const NUMBER_WORD = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)";

export function findContactInfo(text: string): string | null {
  const t = text || "";
  const lower = t.toLowerCase();
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(t)) return "an email address";
  if (/(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(t)) return "a phone number";
  if (/\b((https?:\/\/)|(www\.))\S+/i.test(t)) return "a website link";
  if (/\b[a-z0-9-]+\.(com|net|org|io|co|biz|info)\b/i.test(t)) return "a website link";
  if (/@[a-zA-Z0-9_]{3,}/.test(t)) return "a social media handle";
  if (/\b(call|text|email|dm|reach|contact|message|msg|hit|find)\s+me\b/i.test(t)) return "contact instructions";
  if (/\bmy\s+(email|number|phone|cell)\s+is\b/i.test(t)) return "contact instructions";
  // Obfuscated email: "john dot doe at gmail dot com", "john(at)gmail(dot)com"
  if (/[a-z0-9._%+-]+\s*[(\[]?\s*(?:at|@)\s*[)\]]?\s*[a-z0-9.-]+\s*[(\[]?\s*dot\s*[)\]]?\s*(com|net|org|io|co)\b/i.test(lower)) {
    return "an obfuscated email address";
  }
  // Spelled-out phone number: at least 7 consecutive digit-words, loosely
  // separated — "five five five one two three four" etc.
  const spelledDigitsRe = new RegExp(`\\b(${NUMBER_WORD}[\\s-]+){6,}${NUMBER_WORD}\\b`, "i");
  if (spelledDigitsRe.test(lower)) return "a spelled-out phone number";
  return null;
}
