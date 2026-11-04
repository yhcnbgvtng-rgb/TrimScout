// Thousands separators while typing in a dollar field ("10000" shows as "10,000"). The *stored* value stays the plain
// number string it always was ("10000", "1234.5"): only the box shows commas. Nothing here is server-facing.
//
// Pure functions (no DOM) so typing, deleting, pasting and caret position are testable; components/MoneyInput.tsx is the
// thin <input> wrapper that every dollar field uses.

export type MoneyOpts = {
  /** Keep up to two decimal places. Default false: the field takes whole dollars, as it always did. */
  allowCents?: boolean;
  /** Allow a leading minus (e.g. negative equity, discounts). Default false. */
  allowNegative?: boolean;
};

/** Typed or pasted text -> the plain number string ("$10,000.00" -> "10000.00"; whole-dollar fields cut at the point). */
export function sanitizeMoney(text: string, opts: MoneyOpts = {}): string {
  const s = String(text ?? "");
  const neg = !!opts.allowNegative && /^[^0-9.]*-/.test(s);
  let out = "";
  let seenDot = false;
  let decimals = 0;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") {
      if (seenDot) {
        if (decimals >= 2) continue;
        decimals++;
      }
      out += ch;
    } else if (ch === "." && !seenDot) {
      if (!opts.allowCents) break; // whole dollars: "10,000.00" pasted in means 10000
      seenDot = true;
      out += ".";
    }
  }
  // Leading zeros ("007" -> "7", but "0" and "0.5" stay); a bare ".5" becomes "0.5".
  out = out.replace(/^0+(?=\d)/, "");
  if (out.startsWith(".")) out = `0${out}`;
  return (neg ? "-" : "") + out;
}

/** Plain number string -> what the box shows: "10000" -> "10,000", "1234.5" -> "1,234.5", "12." -> "12." */
export function formatMoneyText(raw: string | number | null | undefined, opts: MoneyOpts = {}): string {
  const clean = sanitizeMoney(raw == null ? "" : String(raw), opts);
  const neg = clean.startsWith("-");
  const body = neg ? clean.slice(1) : clean;
  const dot = body.indexOf(".");
  const int = dot < 0 ? body : body.slice(0, dot);
  const frac = dot < 0 ? "" : body.slice(dot);
  return (neg ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + frac;
}

/** Where the caret goes in `display` so that `sig` digits/points/minus sit to its left. */
function caretFor(display: string, sig: number): number {
  if (sig <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < display.length; i++) {
    if (display[i] !== ",") seen++;
    if (seen >= sig) return i + 1;
  }
  return display.length;
}

export type MoneyEdit = { raw: string; display: string; caret: number };

/**
 * One edit in the box -> the new plain value, the text to show, and where the caret goes.
 * `prevRaw` is the value before the edit, `nextText` what the browser put in the box, `caret` its selectionStart,
 * `inputType` the InputEvent type ("deleteContentBackward", "insertFromPaste", ...) when known.
 */
export function applyMoneyEdit(prevRaw: string, nextText: string, caret: number, inputType: string | undefined, opts: MoneyOpts = {}): MoneyEdit {
  const prev = sanitizeMoney(prevRaw, opts);
  const prevDisplay = formatMoneyText(prev, opts);
  const at = Math.max(0, Math.min(caret, nextText.length));
  const negText = !!opts.allowNegative && /^[^0-9.]*-/.test(nextText);
  const firstMinus = nextText.indexOf("-");
  const counts = (ch: string, i: number) => (ch >= "0" && ch <= "9") || ch === "." || (negText && ch === "-" && i === firstMinus);

  // Digits/points (and the minus sign) left of the caret, in what the browser put in the box.
  let sig = 0;
  for (let i = 0; i < at; i++) if (counts(nextText[i], i)) sig++;
  const typedTotal = [...nextText].filter((c, i) => counts(c, i)).length;

  let raw = sanitizeMoney(nextText, opts);

  // Backspace/Delete that only removed a comma: delete the digit next to it instead, so the key never "does nothing".
  const back = inputType === "deleteContentBackward";
  const fwd = inputType === "deleteContentForward";
  if ((back || fwd) && raw === prev && nextText.length === prevDisplay.length - 1 && prevDisplay.includes(",")) {
    const idx = back ? sig - 1 : sig; // index into raw of the digit to drop
    const first = raw.startsWith("-") ? 1 : 0;
    if (idx >= first && idx < raw.length) {
      raw = sanitizeMoney(raw.slice(0, idx) + raw.slice(idx + 1), opts);
      if (back) sig -= 1;
    }
  } else {
    // Normalisation that shifts characters left of the caret.
    if (opts.allowCents && /^[^0-9.]*-?[^0-9.]*\./.test(nextText) && sig >= 1 && raw.replace("-", "").startsWith("0.")) sig += 1; // ".5" -> "0.5"
    const lost = typedTotal - raw.length; // leading zeros, pasted cents on a whole-dollar field, extra decimals
    if (lost > 0 && sig > raw.length) sig = raw.length;
  }
  sig = Math.max(0, Math.min(sig, raw.length));

  const display = formatMoneyText(raw, opts);
  // A rejected keystroke (a letter, a second point) changes nothing: put the caret back exactly where it was.
  if (!back && !fwd && raw === prev && nextText.length > display.length) {
    return { raw, display, caret: Math.max(0, Math.min(display.length, at - (nextText.length - display.length))) };
  }
  return { raw, display, caret: caretFor(display, sig) };
}
