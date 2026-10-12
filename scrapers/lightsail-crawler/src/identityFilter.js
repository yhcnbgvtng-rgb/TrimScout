// The identity filter for the buyer <-> dealer conversation. Stricter than the request-comment contact check
// (lib/piiFilter.ts / findContactInfo in deals_api_server.js), because here the whole point is that neither side can learn
// who the other is before the deal is final: no email, no phone number in ANY form (digits, spelled out, split across words,
// "double five"), no social handle or messenger, no street address, and no names (introductions, sign-offs, titles).
// Pure and dependency-free: the Next app (lib/identityFilter.ts) and the deals server (rfqMessages.js) run the exact same rules.
// It returns a short description of what was found, or null. Prices, VINs and stock numbers stay allowed.

const DIGIT_WORD = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|niner|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)";
const MULT = "(?:double|triple|dbl)";

/** Letters swapped for look-alike digits ("5eV3n") and separators stripped, so tricks collapse to what they spell. */
function squash(t) {
  return t.toLowerCase().replace(/[​-‍﻿]/g, "").replace(/[()[\]{}<>*_~`'"]/g, "");
}

export function findIdentityInfo(text) {
  const t = String(text ?? "");
  const lower = squash(t);

  // Email, in any disguise.
  if (/[a-z0-9._%+-]+\s*@\s*[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) return "an email address";
  if (/[a-z0-9._%+-]+\s*(?:at|@)\s*[a-z0-9.-]+\s*(?:dot|\.)\s*(?:com|net|org|io|co|biz|info|us|me)\b/i.test(lower)) return "an email address";
  if (/\b(?:gmail|yahoo|hotmail|outlook|icloud|aol|proton(?:mail)?|msn|live)\b/.test(lower)) return "an email address";

  // Links, handles and messengers.
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(t)) return "a website link";
  if (/\b[a-z0-9-]+\.(?:com|net|org|io|co|biz|info|us|me|app|ly)\b/i.test(t)) return "a website link";
  if (/@[a-z0-9_.]{2,}/i.test(t)) return "a social media handle";
  const PLATFORMS = "whats\\s?app|telegram|signal|snap\\s?chat|snap|insta(?:gram)?|ig|facebook|fb|meta|messenger|imessage|i\\s?message|wechat|linkedin|tiktok|tik\\s?tok|twitter|tweet|threads|reddit|youtube|pinterest|tumblr|discord|twitch|bluesky|mastodon|onlyfans|skype|zoom|facetime|google\\s?voice|hangouts|line\\s?app|kik|viber|venmo|cash\\s?app|zelle|paypal";
  if (new RegExp(`\\b(?:${PLATFORMS})\\b`).test(lower)) return "a messaging or social account";
  // "X" (formerly Twitter) is a one-letter word, so only when it is used as the platform: "on X", "my X", "X handle", "x.com", "dm on x".
  if (/(?:\b(?:on|via|at|my|our|follow|dm|find|me|us|add)\s+x\b(?!\s*(?:\d|[-/]))|\bx\s+(?:handle|account|profile|page|dm|user|username)\b|\bx\.com\b)/.test(lower)) return "a messaging or social account";

  // Phone numbers: digits with any separators (7+ digits in a short span), local 3-4 splits, and "area code".
  const digitsOnly = (s) => s.replace(/\D/g, "");
  for (const m of t.matchAll(/(?:\+?\d[\d\s().\-/\\|,]{5,}\d)/g)) {
    const d = digitsOnly(m[0]);
    // A price like "$44,000" or "44,000.00" is at most 7 digits and has no phone-like separators; a phone is 7+ digits split with spaces/dashes/dots/parens.
    if (d.length >= 7 && /[\s().\-/\\|]/.test(m[0].replace(/,\d{3}(?!\d)/g, ""))) return "a phone number";
    if (d.length >= 10) return "a phone number";
  }
  if (/\b\d{3}[\s.\-]\d{4}\b/.test(t)) return "a phone number";
  if (/\b(?:area\s*code|phone|cell|mobile)\b[^.!?\n]{0,30}\d{2,}/i.test(t)) return "a phone number";
  // Digits mixed with number words ("5 5 5 one two three"): 3+ number tokens in a row, at least one a word, is a number being read out.
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const wordTok = new RegExp(`^(?:${DIGIT_WORD}|${MULT})$`);
  let run = 0;
  let sawWord = false;
  for (const tok of tokens) {
    if (/^\d+$/.test(tok) || wordTok.test(tok)) {
      run += 1;
      sawWord = sawWord || wordTok.test(tok);
      if (run >= 3 && sawWord) return "a number spelled out";
    } else { run = 0; sawWord = false; }
  }
  // "double five", "triple seven": a repeat marker plus a digit word is a number being read out.
  if (new RegExp(`\\b${MULT}\\s+${DIGIT_WORD}\\b`).test(lower)) return "a number spelled out";
  // Any spelled-out number run of 3+ number words in a row ("five five five", "double five one"), however short.
  if (new RegExp(`\\b(?:(?:${MULT}\\s+)?${DIGIT_WORD}[\\s,.\\-]+){2,}(?:${MULT}\\s+)?${DIGIT_WORD}\\b`).test(lower)) return "a number spelled out";
  // Digit words split by filler ("five - five - five", "five five x five")
  if (new RegExp(`${DIGIT_WORD}\\W{1,3}${DIGIT_WORD}\\W{1,3}${DIGIT_WORD}`).test(lower)) return "a number spelled out";

  // Street addresses.
  if (/\b\d{1,5}\s+(?:[a-z0-9.]+\s+){1,3}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct|place|pl|highway|hwy|terrace|circle|cir)\b\.?/i.test(t)) return "a street address";

  // Names and who-I-am: introductions, titles, sign-offs, "ask for <Name>".
  const cap = "[A-Z][a-zA-Z'’-]{1,}";
  if (/\b(?:my\s+name(?:\s+is|'s|’s)?|name\s+is|name's|name’s|i\s+go\s+by|they\s+call\s+me|call\s+me|you\s+can\s+call\s+me|known\s+as|first\s+name|last\s+name|full\s+name|surname)\b/i.test(t)) return "a name";
  // "I'm John" / "this is Maria here": a capitalized word right after an introduction that isn't an ordinary sentence word.
  const intro = t.match(new RegExp(`\\b(?:[Tt]his\\s+is|[Ii]t(?:'|’)?s|[Ii](?:'|’)?m|[Ii]\\s+am|[Ii]m)\\s+(${cap})`));
  if (intro && !COMMON_CAPS.has(intro[1].toLowerCase())) return "a name";
  if (new RegExp(`\\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|[Mm]x|[Dd]r|[Ss]ir|[Mm]adam)\\.?\\s+${cap}`).test(t)) return "a name";
  if (new RegExp(`\\b(?:ask|speak|talk|meet|see|look)\\s+(?:to|with|for)\\s+${cap}(?:\\s+${cap})?`).test(t)) {
    const m = t.match(new RegExp(`\\b(?:ask|speak|talk|meet|see|look)\\s+(?:to|with|for)\\s+(${cap})`));
    if (m && !COMMON_CAPS.has(m[1].toLowerCase())) return "a name";
  }
  // Sign-offs: "Thanks, John" / "- John Smith" as the last line.
  const sign = t.match(/(?:^|\n)\s*(?:thanks|thank you|regards|best regards|best|sincerely|cheers|respectfully|warmly|yours truly|yours|-+|—|–)[,!.]?\s+([A-Z][a-zA-Z'’-]+)(?:\s+[A-Z][a-zA-Z'’-]+)?\s*[.!]?\s*$/i);
  if (sign && /^[A-Z]/.test(sign[1]) && !COMMON_CAPS.has(sign[1].toLowerCase())) return "a name";
  if (/\b(?:email|e-mail|call|text|phone|reach|contact|message|msg|dm|hit|find|ping)\s+(?:me|us)\b/i.test(t)) return "contact instructions";
  if (/\b(?:my|our)\s+(?:email|e-mail|number|phone|cell|mobile|line|whatsapp|insta|handle)\b/i.test(t)) return "contact instructions";
  return null;
}

// Capitalized words that are not names, so a normal sentence isn't blocked ("I'm Interested", "It's Friday").
const COMMON_CAPS = new Set([
  "sales", "manager", "finance", "service", "desk", "team", "dealer", "dealership", "buyer", "someone", "anyone", "you", "your", "me", "us",
  "interested", "ready", "happy", "glad", "sure", "fine", "good", "great", "ok", "okay", "here", "there", "back", "still", "also", "just", "not", "very", "really", "looking", "buying", "thinking", "wondering", "hoping", "trying", "willing", "able", "afraid", "sorry", "curious", "open", "flexible", "available", "free", "busy", "late", "early", "done", "going", "getting", "coming", "leaving", "paying", "financing", "leasing", "cash", "new", "used", "the", "a", "an", "in", "on", "at", "to", "for", "with", "from", "about", "all", "so", "too", "now", "then", "today", "tomorrow", "tonight", "yesterday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "possible", "impossible", "true", "false", "correct", "right", "wrong", "fair", "reasonable", "important", "clear", "perfect", "worth", "waiting", "ordering", "choosing", "picking", "deciding", "considering", "comparing", "shopping", "traveling", "moving", "working", "off", "out", "up", "down", "over", "under", "yes", "no", "thanks", "thank", "please", "best", "regards", "sincerely", "cheers", "warmly", "respectfully",
]);
