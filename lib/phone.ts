// US phone numbers, typed by people. One place for the rules every phone input shares (components/PhoneInput.tsx):
//   - as you type, digits become "(XXX) XXX-XXXX"; anything that is not a digit is ignored
//   - a leading country code (1 or +1) is dropped: US area codes never start with 1, so a first "1" can only be the country code
//   - at most 10 digits are kept
//   - backspace over a formatting character (")", "-", " ") removes the digit before it instead of putting the character back
//   - the caret stays after the digit the person just typed (or deleted), however the text around it grows or shrinks
// What is stored and sent is unchanged: a plain string, now always "(XXX) XXX-XXXX" when it comes from a PhoneInput. Numbers already saved in any
// other shape ("5551234567", "+1 555-123-4567", "(555) 123-4567 x12") are never rewritten on their own: displays format the ones that are
// plain 10-digit US numbers (formatPhoneDisplay) and show every other shape exactly as saved, and an input holding such a number edits it as plain text.

/** Digits only. */
export const onlyDigits = (raw: string | null | undefined): string => String(raw ?? "").replace(/\D/g, "");

/** The 10 national digits so far (at most 10): non-digits dropped, one leading country code "1" dropped. */
export function nationalDigits(raw: string | null | undefined): string {
  let d = onlyDigits(raw);
  if (d.startsWith("1")) d = d.slice(1);
  return d.slice(0, 10);
}

/** "(5", "(555", "(555) 12", "(555) 123-4567": the digits so far in the usual shape; "" for no digits. */
export function formatNationalDigits(d: string): string {
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

/** As-you-type formatting of whatever is in the box. */
export const formatPhone = (raw: string | null | undefined): string => formatNationalDigits(nationalDigits(raw));

/** True when the text is exactly one complete US number (10 digits after an optional leading 1). */
export function isCompletePhone(raw: string | null | undefined): boolean {
  const d = onlyDigits(raw);
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
}

/** A value that is only digits and ordinary phone punctuation with no more digits than a US number plus its country code. Anything else (an
 *  extension, letters, an international number) is left alone by the input and by the displays. */
export const isPlainPhone = (raw: string | null | undefined): boolean => /^[\d\s().+-]*$/.test(String(raw ?? "")) && onlyDigits(raw).length <= 11;

/** For showing a SAVED number: plain complete 10-digit numbers come out as "(XXX) XXX-XXXX"; every other value is shown as it was saved. */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  return text && isPlainPhone(text) && isCompletePhone(text) ? formatPhone(text) : text;
}

/** The caret index just after the k-th digit of an already formatted value (0 when k is 0). */
export function caretAfterDigits(formatted: string, k: number): number {
  if (k <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) { seen += 1; if (seen === k) return i + 1; }
  }
  return formatted.length;
}

export interface PhoneEdit { value: string; caret: number }

/**
 * One edit in a phone box. `prev` is what the box showed before the keystroke or paste, `next` is what the browser made of it, `caret` is the
 * caret index in `next`. Returns the text to show and where the caret goes.
 *  - typing, pasting, "+1 (555) 123-4567", "555.123.4567": formatted, caret kept after the same digit
 *  - backspace that removed only a formatting character: the digit before it is removed too (otherwise the character would come back);
 *    forward delete that removed only a formatting character: the digit after it is removed
 *  - when `prev` was a value this input should not touch (an extension, letters, international), the edit passes through unchanged
 */
export function editPhone(prev: string, next: string, caret: number = next.length, opts: { forward?: boolean } = {}): PhoneEdit {
  if (prev && !isPlainPhone(prev)) return { value: next, caret };
  const at = Math.max(0, Math.min(caret, next.length));
  let digits = nationalDigits(next);
  let before = nationalDigits(next.slice(0, at)).length;
  const removedOnlyFormatting = next.length < prev.length && nationalDigits(prev) === digits;
  if (removedOnlyFormatting && opts.forward) {
    digits = digits.slice(0, before) + digits.slice(before + 1);
  } else if (removedOnlyFormatting && before > 0) {
    digits = digits.slice(0, before - 1) + digits.slice(before);
    before -= 1;
  }
  const value = formatNationalDigits(digits);
  return { value, caret: caretAfterDigits(value, Math.min(before, digits.length)) };
}
