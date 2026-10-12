// The identity filter for the buyer <-> dealer conversation: nobody learns who the other side is before the deal is final.
// No names, no email, no phone number in ANY form (digits, spelled out, split across words or messages, look-alike
// characters, emoji digits), no handle or social/messaging platform, no street address, no files, and no link except trimscout.com.
// Prices, VINs, stock numbers, APRs, dates and mileage stay allowed.
//
// How: every message is checked as written AND after normalization -
//   fold      Unicode look-alikes (fullwidth, math, circled, keycap-emoji and other-script digits, Cyrillic/Greek homoglyphs) -> ASCII
//   spoken    number words -> digits ("five five five", "double five", "triple seven", "oh" for zero), spaced letters rejoined
//   collapsed separators between single characters removed ("j a n e @ g m a i l", "5.5.5-1.2.3.4")
// and the rules run on each view. A cross-message check joins the sender's last five messages and refuses the one that completes a
// phone number, email or handle. Messages that clear every rule but look odd (digit density, odd spacing, mixed letters+digits)
// get a risk score; above RISK_THRESHOLD they are held for an AI check (screenMessage -> "review").
//
// Pure and dependency-free: the Next app (lib/identityFilter.ts) and the deals server (rfqMessages.js) run the exact same rules.
// findIdentityInfo returns a short description of what was found, or null.

export const CROSS_MESSAGE_WINDOW = 5;
export const RISK_THRESHOLD = 3;
export const ALLOWED_LINK_HOSTS = ["trimscout.com"];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const HOMOGLYPHS = {
  // Cyrillic
  "а": "a", "в": "b", "е": "e", "ё": "e", "з": "3", "і": "i", "ї": "i", "ј": "j", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "ѕ": "s", "һ": "h", "ԁ": "d", "ɡ": "g", "ӏ": "l", "ꓲ": "l",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I", "Ј": "J", "Ѕ": "S",
  // Greek
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "μ": "m", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  // dotless / small caps / misc
  "ı": "i", "ɪ": "i", "ᴀ": "a", "ʙ": "b", "ᴄ": "c", "ᴅ": "d", "ᴇ": "e", "ɢ": "g", "ʜ": "h", "ᴊ": "j", "ᴋ": "k", "ʟ": "l", "ᴍ": "m", "ɴ": "n", "ᴏ": "o", "ᴘ": "p", "ʀ": "r", "ꜱ": "s", "ᴛ": "t", "ᴜ": "u", "ᴠ": "v", "ᴡ": "w", "ʏ": "y", "ᴢ": "z",
  // symbols used for @ . and separators
  "＠": "@", "﹫": "@", "＆": "&", "․": ".", "。": ".", "．": ".", "‧": ".", "·": ".", "•": ".", "∙": ".", "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-", "﹣": "-", "＿": "_",
  "｜": "|", "¦": "|", "ǀ": "|",
  // dingbat negative circled digits
  "❶": "1", "❷": "2", "❸": "3", "❹": "4", "❺": "5", "❻": "6", "❼": "7", "❽": "8", "❾": "9", "❿": "10", "⓿": "0",
  "➀": "1", "➁": "2", "➂": "3", "➃": "4", "➄": "5", "➅": "6", "➆": "7", "➇": "8", "➈": "9", "➉": "10",
  "➊": "1", "➋": "2", "➌": "3", "➍": "4", "➎": "5", "➏": "6", "➐": "7", "➑": "8", "➒": "9", "➓": "10",
};

/** Any Unicode decimal digit (Arabic-Indic, Devanagari, math bold, ...) -> its ASCII digit. */
function asciiDigit(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 128) return ch;
  let start = cp;
  for (let i = 0; i < 9; i += 1) {
    const prev = String.fromCodePoint(start - 1);
    if (/\p{Nd}/u.test(prev)) start -= 1; else break;
  }
  return String((cp - start) % 10);
}

/** Look-alikes, fullwidth/math/circled/keycap-emoji digits, zero-width characters and accents, folded to plain ASCII. Case is kept. */
export function fold(text) {
  let s = String(text ?? "");
  s = s.replace(/[​-‏⁠⁡-⁤﻿­᠎‪-‮⁦-⁩]/g, "");
  s = s.replace(/([0-9#*])️?⃣/g, "$1");
  s = s.normalize("NFKD").replace(/\p{M}+/gu, "");
  s = s.replace(/\p{Nd}/gu, asciiDigit);
  s = s.replace(/[^\x00-\x7f]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
  return s;
}

const UNITS = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", niner: "9", "5ive": "5", f1ve: "5", fiv3: "5", on3: "1", "0ne": "1", tw0: "2", thr33: "3", thre3: "3", f0ur: "4", "4our": "4", s1x: "6", s3ven: "7", sev3n: "7", "8ight": "8", "3ight": "8", e1ght: "8", n1ne: "9", nin3: "9", z3ro: "0", zer0: "0" };
const MULTIPLIER = { double: 2, dbl: 2, triple: 3, treble: 3 };

/** Number words -> digits ("five five five" -> "5 5 5", "double five" -> "55", "triple seven" -> "777", "oh" -> 0 beside other digits). Other words stay. */
export function spoken(text) {
  const parts = String(text ?? "").split(/(\s+)/);
  const out = [];
  const words = parts.map((p) => p.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""));
  for (let i = 0; i < parts.length; i += 1) {
    const w = words[i];
    if (/^\s+$/.test(parts[i]) || w === "") { out.push(parts[i]); continue; }
    const nextIdx = (() => { for (let j = i + 1; j < parts.length; j += 1) if (!/^\s+$/.test(parts[j])) return j; return -1; })();
    const prevIdx = (() => { for (let j = i - 1; j >= 0; j -= 1) if (!/^\s+$/.test(parts[j])) return j; return -1; })();
    const next = nextIdx >= 0 ? words[nextIdx] : null;
    const prev = prevIdx >= 0 ? words[prevIdx] : null;
    if (w in MULTIPLIER && next != null && (next in UNITS || /^\d$/.test(next))) {
      const digit = next in UNITS ? UNITS[next] : next;
      out.push(digit.repeat(MULTIPLIER[w]));
      // swallow the unit word that followed
      i = nextIdx;
      continue;
    }
    if (w === "oh") {
      const nearNumber = (next != null && (next in UNITS && next !== "oh" || /^\d+$/.test(next) || next in MULTIPLIER)) || (prev != null && (prev in UNITS && prev !== "oh" || /^\d+$/.test(prev)));
      out.push(nearNumber ? "0" : parts[i]);
      continue;
    }
    if (w in UNITS) { out.push(UNITS[w]); continue; }
    out.push(parts[i]);
  }
  return out.join("");
}

const LEET = { o: "0", O: "0", l: "1", I: "1", i: "1", s: "5", S: "5", z: "2", Z: "2", b: "8", B: "8" };
/** Inside short mixed letter+digit tokens, look-alike letters read as digits ("555l2O4"). VIN-length tokens and ordinary words are left alone. */
function leetDigits(text) {
  return text.replace(/[A-Za-z0-9]{4,12}/g, (tok) => {
    if (!/\d/.test(tok) || !/[oOlIisSzZbB]/.test(tok)) return tok;
    // only when digits dominate the token, so "S12345" stays a stock number and "B2B" stays a word
    const digits = (tok.match(/\d/g) || []).length;
    if (digits < tok.length - 3 || digits < 3) return tok;
    return tok.replace(/[oOlIisSzZbB]/g, (c) => LEET[c]);
  });
}

/** Spaced-out letters/digits ("j a n e", "5.5.5-1.2.3", "i n s t a g r a m") rejoined into one run. */
export function unspace(text) {
  return String(text ?? "").replace(/(?:^|(?<=[^a-zA-Z0-9]))(?:[a-zA-Z0-9@][\s.\-_*|/\\,]{1,3}){3,}[a-zA-Z0-9@](?=$|[^a-zA-Z0-9])/g, (m) => m.replace(/[\s.\-_*|/\\,]+/g, ""));
}

/** The views every rule runs on. */
export function views(text) {
  const raw = String(text ?? "");
  const folded = fold(raw);
  const said = spoken(folded);
  const joined = unspace(said);
  const leet = leetDigits(joined);
  return { raw, folded, spoken: said, joined, leet, lower: said.toLowerCase(), joinedLower: joined.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const PLATFORMS = "whats\\s?app|telegram|signal|snap\\s?chat|snap|insta(?:gram)?|ig|facebook|fb|meta|messenger|imessage|i\\s?message|wechat|linkedin|tiktok|tik\\s?tok|twitter|tweet|threads|reddit|youtube|pinterest|tumblr|discord|twitch|bluesky|mastodon|onlyfans|skype|zoom|facetime|google\\s?voice|hangouts|line\\s?app|kik|viber|venmo|cash\\s?app|zelle|paypal";
const LONG_PLATFORMS = ["whatsapp", "telegram", "snapchat", "instagram", "facebook", "messenger", "imessage", "wechat", "linkedin", "tiktok", "twitter", "discord", "youtube", "pinterest", "bluesky", "mastodon", "onlyfans", "facetime", "googlevoice", "cashapp", "hangouts", "reddit", "tumblr"];
const EMAIL_PROVIDERS = /\b(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|icloud|aol|proton(?:mail)?|msn|live|comcast|verizon|att|sbcglobal|gmx|zoho)\b/;
const TLD = "(?:com|net|org|io|co|biz|info|us|me|app|ly|edu|gov|ca|uk|de|xyz|dev)";

/** Phone-number evidence in a text whose number words are already digits. "block" / "review" / null. */
function phoneVerdict(text) {
  let verdict = null;
  const tokens = text.split(/\s+/).filter(Boolean);
  let digitsRun = 0;
  let tokensInRun = 0;
  let groupedSeparators = false;
  const flush = () => {
    if (digitsRun >= 10) verdict = "block";
    else if (digitsRun >= 7) {
      if (tokensInRun >= 2 || groupedSeparators) verdict = verdict === "block" ? "block" : "block";
      else if (verdict !== "block") verdict = "review"; // one plain 7-9 digit token: a stock number or a ZIP+4 is possible, ask the AI
    }
    digitsRun = 0; tokensInRun = 0; groupedSeparators = false;
  };
  for (const tok of tokens) {
    const bare = tok.replace(/^["'“”‘’]+|[.,;:!?"'“”‘’]+$/g, "");
    // a lone separator between digit groups ("555 - 123 - 4567") belongs to the run
    if (/^[().\-/\\|]+$/.test(bare) && digitsRun > 0) { groupedSeparators = true; continue; }
    const numericish = /^\+?\(?\d[\d().\-/\\|,]*\)?$/.test(bare) && !/^\$/.test(tok);
    const isDate = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/.test(bare) || /^\d{4}-\d{2}-\d{2}$/.test(bare);
    const isMoney = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(bare);
    const isDecimal = /^\d+\.\d+$/.test(bare);
    if (numericish && !isDate && !isMoney && !isDecimal) {
      const d = bare.replace(/\D/g, "").length;
      digitsRun += d;
      tokensInRun += 1;
      if (/[().\-/\\|]/.test(bare) && d >= 3) groupedSeparators = true;
    } else flush();
  }
  flush();
  return verdict;
}

function emailHit(v) {
  if (/[a-z0-9._%+-]+\s*@\s*[a-z0-9.-]+\.[a-z]{2,}/i.test(v.folded)) return true;
  if (new RegExp(`[a-z0-9._%+-]+\\s*(?:at|@)\\s*[a-z0-9.-]+\\s*(?:dot|\\.)\\s*${TLD}\\b`, "i").test(v.lower)) return true;
  if (new RegExp(`[a-z0-9._%+-]+(?:at|@)[a-z0-9-]+(?:dot|\\.)${TLD}\\b`, "i").test(v.joinedLower)) return true;
  if (/[a-z0-9]\s*[([{<]\s*(?:at|@)\s*[)\]}>]\s*[a-z0-9]/i.test(v.lower)) return true;
  if (EMAIL_PROVIDERS.test(v.lower) || EMAIL_PROVIDERS.test(v.joinedLower)) return true;
  return false;
}

function handleHit(v) {
  return /@[a-z0-9_.]{2,}/i.test(v.folded) || /@[a-z0-9_.]{2,}/i.test(v.joined);
}

function platformHit(v) {
  if (new RegExp(`\\b(?:${PLATFORMS})\\b`).test(v.lower)) return true;
  // spaced / dotted / zero-width disguised: only the long names, so ordinary words glued together can't trip a short one
  const glued = v.joinedLower.replace(/[^a-z0-9]/g, "");
  if (LONG_PLATFORMS.some((p) => glued.includes(p) && v.joinedLower !== v.lower)) return true;
  if (LONG_PLATFORMS.some((p) => v.lower.replace(/[^a-z]/g, "").includes(p) && new RegExp(`(?:^|[^a-z])${p.split("").join("[^a-z0-9]{0,3}")}(?:$|[^a-z])`).test(v.lower))) return true;
  // "X" (formerly Twitter) is a one-letter word: only when used as the platform
  if (/(?:\b(?:on|via|at|my|our|follow|dm|find|me|us|add)\s+x\b(?!\s*(?:\d|[-/]))|\bx\s+(?:handle|account|profile|page|dm|user|username)\b|\bx\.com\b)/.test(v.lower)) return true;
  return false;
}

/** Hosts in links and bare domains. Anything but trimscout.com (and its subdomains) is refused. */
export function disallowedLink(text) {
  const t = fold(text);
  const hosts = [];
  for (const m of t.matchAll(/\b(?:https?:\/\/|ftp:\/\/|www\.)([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?[^\s]*/gi)) hosts.push(m[1].toLowerCase());
  for (const m of t.matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|net|org|io|co|biz|info|us|me|app|ly|edu|gov|xyz|dev|gg|tv|fm))\b/gi)) hosts.push(m[1].toLowerCase());
  for (const h of hosts) {
    const host = h.replace(/^www\./, "");
    if (!ALLOWED_LINK_HOSTS.some((a) => host === a || host.endsWith(`.${a}`))) return h;
  }
  return null;
}

const COMMON_CAPS = new Set([
  "sales", "manager", "finance", "service", "desk", "team", "dealer", "dealership", "buyer", "someone", "anyone", "you", "your", "me", "us",
  "interested", "ready", "happy", "glad", "sure", "fine", "good", "great", "ok", "okay", "here", "there", "back", "still", "also", "just", "not", "very", "really", "looking", "buying", "thinking", "wondering", "hoping", "trying", "willing", "able", "afraid", "sorry", "curious", "open", "flexible", "available", "free", "busy", "late", "early", "done", "going", "getting", "coming", "leaving", "paying", "financing", "leasing", "cash", "new", "used", "the", "a", "an", "in", "on", "at", "to", "for", "with", "from", "about", "all", "so", "too", "now", "then", "today", "tomorrow", "tonight", "yesterday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "possible", "impossible", "true", "false", "correct", "right", "wrong", "fair", "reasonable", "important", "clear", "perfect", "worth", "waiting", "ordering", "choosing", "picking", "deciding", "considering", "comparing", "shopping", "traveling", "moving", "working", "off", "out", "up", "down", "over", "under", "yes", "no", "thanks", "thank", "please", "best", "regards", "sincerely", "cheers", "warmly", "respectfully",
]);

function nameHit(t) {
  const cap = "[A-Z][a-zA-Z'’-]{1,}";
  if (/\b(?:my\s+name(?:\s+is|'s|’s)?|name\s+is|name's|name’s|i\s+go\s+by|they\s+call\s+me|call\s+me|you\s+can\s+call\s+me|known\s+as|first\s+name|last\s+name|full\s+name|surname)\b/i.test(t)) return true;
  const intro = t.match(new RegExp(`\\b(?:[Tt]his\\s+is|[Ii]t(?:'|’)?s|[Ii](?:'|’)?m|[Ii]\\s+am|[Ii]m)\\s+(${cap})`));
  if (intro && !COMMON_CAPS.has(intro[1].toLowerCase())) return true;
  if (new RegExp(`\\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|[Mm]x|[Dd]r|[Ss]ir|[Mm]adam)\\.?\\s+${cap}`).test(t)) return true;
  const ask = t.match(new RegExp(`\\b(?:ask|speak|talk|meet|see|look)\\s+(?:to|with|for)\\s+(${cap})`));
  if (ask && !COMMON_CAPS.has(ask[1].toLowerCase())) return true;
  const sign = t.match(/(?:^|\n)\s*(?:thanks|thank you|regards|best regards|best|sincerely|cheers|respectfully|warmly|yours truly|yours|-+|—|–)[,!.]?\s+([A-Z][a-zA-Z'’-]+)(?:\s+[A-Z][a-zA-Z'’-]+)?\s*[.!]?\s*$/i);
  if (sign && /^[A-Z]/.test(sign[1]) && !COMMON_CAPS.has(sign[1].toLowerCase())) return true;
  return false;
}

function addressHit(t) {
  return /\b\d{1,5}\s+(?:[a-z0-9.]+\s+){1,3}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct|place|pl|highway|hwy|terrace|circle|cir)\b\.?/i.test(t);
}

function instructionHit(t) {
  return /\b(?:email|e-mail|call|text|phone|reach|contact|message|msg|dm|hit|find|ping)\s+(?:me|us)\b/i.test(t) || /\b(?:my|our)\s+(?:email|e-mail|number|phone|cell|mobile|line|whatsapp|insta|handle)\b/i.test(t);
}

/** Only the parts that identify a contact vector (phone, email, handle): used across messages. */
export function findContactVector(text) {
  const v = views(text);
  const phone = [phoneVerdict(v.spoken), phoneVerdict(v.joined), phoneVerdict(v.leet)].includes("block");
  if (phone) return "a phone number";
  if (emailHit(v)) return "an email address";
  if (handleHit(v)) return "a social media handle";
  return null;
}

/** "block" text -> what it contains; null when nothing in any view trips a rule. (May still deserve a "review" via riskScore.) */
export function findIdentityInfo(text) {
  const v = views(text);
  if (emailHit(v)) return "an email address";
  const link = disallowedLink(v.folded) || disallowedLink(v.joined);
  if (link) return "a link";
  if (/\bdata:[a-z]+\/[a-z0-9.+-]+;base64/i.test(v.raw) || /!\[[^\]]*\]\([^)]*\)/.test(v.raw)) return "an image or file";
  if (handleHit(v)) return "a social media handle";
  if (platformHit(v)) return "a messaging or social account";
  for (const view of [v.spoken, v.joined, v.leet]) if (phoneVerdict(view) === "block") return "a phone number";
  // one plain 7-9 digit token is usually a stock number (-> AI review), but written in look-alike digits or letters-for-digits it is a disguise
  if ((phoneVerdict(v.spoken) === "review" && v.raw !== v.folded) || (phoneVerdict(v.leet) === "review" && v.leet !== v.joined)) return "a phone number";
  if (/[a-z]\s*@\s*[a-z]/i.test(v.folded)) return "an email address";
  if (/\b\d{3}[\s.\-]\d{4}\b/.test(v.folded)) return "a phone number";
  if (/\b(?:area\s*code|phone|cell|mobile)\b[^.!?\n]{0,30}\d{2,}/i.test(v.spoken)) return "a phone number";
  // digit words in a row, however short: "five five five", "double five one", "one two three"
  if (/\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|niner|oh)\b[\s,.\-/]*){3,}/i.test(v.folded)) return "a number spelled out";
  if (/\b(?:double|triple|treble|dbl)\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|niner|oh)\b/i.test(v.folded)) return "a number spelled out";
  if (/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|niner|oh)\W{1,3}(?:zero|one|two|three|four|five|six|seven|eight|nine|niner|oh)\W{1,3}(?:zero|one|two|three|four|five|six|seven|eight|nine|niner|oh)\b/i.test(v.folded)) return "a number spelled out";
  if (addressHit(v.folded)) return "a street address";
  if (nameHit(v.raw) || nameHit(v.folded)) return "a name";
  if (instructionHit(v.folded)) return "contact instructions";
  return null;
}

/**
 * Block when this message completes a phone number, email or handle together with the sender's previous messages
 * (`previous` = that sender's earlier delivered messages in this thread, oldest first). Messages already delivered stay delivered.
 */
export function findAcrossMessages(previous, text, window = CROSS_MESSAGE_WINDOW) {
  const prev = (previous || []).map((p) => String(p ?? "")).filter(Boolean).slice(-window);
  if (!prev.length) return null;
  const all = [...prev, String(text ?? "")];
  const spaced = all.join(" ");
  const bare = all.join("");
  const before = findContactVector(prev.join(" ")) || findContactVector(prev.join(""));
  if (before) return null; // the earlier ones already tripped on their own; the new message adds nothing
  const hit = findContactVector(spaced);
  if (hit) return hit;
  // joined with nothing between them: only a long run of digits is conclusive (short fragments like "36" + "5" are ordinary)
  const digits = (fold(bare).match(/\d/g) || []).length;
  const bareHit = findContactVector(bare);
  if (bareHit && (bareHit !== "a phone number" || digits >= 10)) return bareHit;
  return null;
}

// ---------------------------------------------------------------------------
// Risk score (borderline messages go to the AI check)
// ---------------------------------------------------------------------------

/** Signals that a message that passed every rule may still be hiding something. Higher = more suspicious. Prices, VINs and ordinary prose score ~0. */
export function riskScore(text) {
  const raw = String(text ?? "");
  const v = views(raw);
  if (raw.trim().length < 6) return 0;
  let score = 0;
  const digits = (v.folded.match(/\d/g) || []).length;
  const letters = (v.folded.match(/[a-z]/gi) || []).length;
  const len = Math.max(raw.length, 1);
  // digit density (a long run of mostly digits with few words)
  if (digits >= 6 && digits / len > 0.45 && letters < digits) score += 2;
  else if (digits >= 8 && digits / len > 0.3) score += 1;
  // odd spacing: many single-character tokens, or separators between single characters
  const toks = raw.split(/\s+/).filter(Boolean);
  const single = toks.filter((t) => /^[a-z0-9@]$/i.test(t)).length;
  if (single >= 4) score += 2; else if (single >= 3) score += 1;
  if (/(?:[a-z0-9][\s.\-_*|/\\]{1,3}){5,}[a-z0-9]/i.test(raw)) score += 1;
  // mixed letters + numbers in tokens that are neither a VIN nor a stock/part number
  const mixed = toks.filter((t) => {
    const w = t.replace(/[^a-z0-9]/gi, "");
    if (w.length < 5 || !/\d/.test(w) || !/[a-z]/i.test(w)) return false;
    if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(w)) return false; // VIN
    if (/^[a-z]{1,3}\d{3,8}$/i.test(w) || /^\d{1,4}[a-z]{1,2}$/i.test(w)) return false; // stock / trim like S12345, 36mo
    return true;
  }).length;
  if (mixed >= 2) score += 2; else if (mixed === 1) score += 1;
  // look-alike or invisible characters
  if (/[^\x00-\x7f]/.test(raw) && fold(raw) !== raw) score += 2;
  // number words in bulk
  const numberWords = (raw.toLowerCase().match(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|niner|oh|double|triple)\b/g) || []).length;
  if (numberWords >= 3) score += 1;
  // a plain 7-9 digit token the phone check could not call
  if (phoneVerdict(v.spoken) === "review") score += 3;
  return score;
}

/**
 * The whole check for one message: "block" (reason), "review" (clears every rule but scores above RISK_THRESHOLD: ask the AI),
 * or "pass". `previous` is that sender's earlier delivered messages in this thread.
 */
export function screenMessage({ text, previous = [] }) {
  const reason = findIdentityInfo(text) || findAcrossMessages(previous, text);
  if (reason) return { verdict: "block", reason, score: null };
  const score = riskScore(text);
  if (score >= RISK_THRESHOLD) return { verdict: "review", reason: "looks unusual", score };
  return { verdict: "pass", reason: null, score };
}

/** True when a chat request body tries to carry a file or image. */
export function hasAttachment(body) {
  if (!body || typeof body !== "object") return false;
  return ["attachments", "attachment", "files", "file", "images", "image", "photos", "photo", "media", "upload", "uploads"].some((k) => {
    const v = body[k];
    return v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
  });
}
