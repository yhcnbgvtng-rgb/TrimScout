// As-you-type US phone formatting (lib/phone.ts, used by components/PhoneInput.tsx): typing, paste, +1, partial numbers, backspace over punctuation,
// caret position, and the rule that numbers already saved in other shapes are never rewritten.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { caretAfterDigits, editPhone, formatPhone, formatPhoneDisplay, isCompletePhone, isPlainPhone, nationalDigits } from "./phone";

/** Drives editPhone like a browser: each step is the text after the keystroke plus the caret. */
function box(initial = "") {
  let value = initial; let caret = initial.length;
  const apply = (next: string, at: number) => { const e = editPhone(value, next, at); value = e.value; caret = e.caret; return box_; };
  const box_ = {
    get value() { return value; }, get caret() { return caret; },
    type(chars: string) { for (const ch of chars) apply(value.slice(0, caret) + ch + value.slice(caret), caret + 1); return box_; },
    paste(text: string) { return apply(value.slice(0, caret) + text + value.slice(caret), caret + text.length); },
    pasteOver(text: string) { return apply(text, text.length); },
    backspace() { if (caret === 0) return box_; return apply(value.slice(0, caret - 1) + value.slice(caret), caret - 1); },
    del() { if (caret >= value.length) return box_; const next = value.slice(0, caret) + value.slice(caret + 1); const e = editPhone(value, next, caret, { forward: true }); value = e.value; caret = e.caret; return box_; },
    moveTo(i: number) { caret = i; return box_; },
  };
  return box_;
}

describe("formatPhone / nationalDigits", () => {
  it("formats progressively as digits arrive", () => {
    assert.deepEqual(["", "5", "55", "555", "5551", "55512", "555123", "5551234", "55512345", "555123456", "5551234567"].map(formatPhone),
      ["", "(5", "(55", "(555", "(555) 1", "(555) 12", "(555) 123", "(555) 123-4", "(555) 123-45", "(555) 123-456", "(555) 123-4567"]);
  });
  it("ignores non-digits and caps at 10 digits", () => {
    assert.equal(formatPhone("abc(555)-123.4567xyz"), "(555) 123-4567");
    assert.equal(formatPhone("55512345678901"), "(555) 123-4567");
    assert.equal(nationalDigits("  "), "");
  });
  it("drops a leading 1 or +1", () => {
    for (const raw of ["15551234567", "+15551234567", "+1 (555) 123-4567", "1-555-123-4567", "1 555 123 4567"]) assert.equal(formatPhone(raw), "(555) 123-4567", raw);
    assert.equal(formatPhone("1"), "");
    assert.equal(formatPhone("+1"), "");
  });
});

describe("typing", () => {
  it("builds the number one digit at a time, caret always at the end", () => {
    const b = box();
    const seen: string[] = [];
    for (const d of "5551234567") { b.type(d); seen.push(b.value); assert.equal(b.caret, b.value.length); }
    assert.equal(seen[2], "(555");
    assert.equal(seen[3], "(555) 1");
    assert.equal(seen[9], "(555) 123-4567");
  });
  it("ignores letters and punctuation typed in", () => {
    assert.equal(box().type("5a5-5b1.2 3").value, "(555) 123");
  });
  it("stops at 10 digits", () => {
    assert.equal(box().type("55512345678999").value, "(555) 123-4567");
  });
  it("a typed leading 1 (country code) does not show; the number goes on from there", () => {
    assert.equal(box().type("1").value, "");
    assert.equal(box().type("15551234567").value, "(555) 123-4567");
  });
  it("typing in the middle keeps the caret after the typed digit", () => {
    const b = box("(555) 123-4567").moveTo(4); // after the third 5
    b.type("9");
    assert.equal(b.value, "(555) 912-3456"); // the 9 went in after the third digit; the last digit fell off the 10-digit cap
    assert.equal(b.caret, caretAfterDigits(b.value, 4));
    assert.equal(b.value[b.caret - 1], "9");
  });
});

describe("paste", () => {
  it("formats a pasted number in any common shape", () => {
    for (const text of ["5551234567", "555-123-4567", "555.123.4567", "(555) 123-4567", "+1 555 123 4567", "1 (555) 123-4567", " 555 123 4567 "]) assert.equal(box().paste(text).value, "(555) 123-4567", text);
  });
  it("pasting over the whole box replaces it", () => {
    assert.equal(box("(111) 222-3333").pasteOver("+1 800 555 0199").value, "(800) 555-0199");
  });
  it("a partial paste stays partial and the caret lands at the end", () => {
    const b = box().paste("555123");
    assert.equal(b.value, "(555) 123");
    assert.equal(b.caret, b.value.length);
  });
  it("junk with no digits leaves the box empty", () => {
    assert.equal(box().paste("n/a").value, "");
  });
});

describe("backspace and delete", () => {
  it("backspace removes the last digit and the formatting follows", () => {
    const b = box("(555) 123-4567");
    b.backspace(); assert.equal(b.value, "(555) 123-456");
    b.backspace().backspace().backspace(); assert.equal(b.value, "(555) 123");
    b.backspace(); assert.equal(b.value, "(555) 12");
    b.backspace().backspace(); assert.equal(b.value, "(555");
    b.backspace().backspace().backspace(); assert.equal(b.value, "");
  });
  it("backspace over ') ' removes the digit before it instead of putting the character back", () => {
    const b = box("(555) 123"); // caret after the space
    b.moveTo(6).backspace(); // deletes the space only, as far as the browser knows
    assert.equal(b.value, "(551) 23");
    assert.equal(b.caret, caretAfterDigits(b.value, 2));
  });
  it("backspace over '-' removes the digit before it", () => {
    const b = box("(555) 123-4567").moveTo(10); // right after the '-'
    b.backspace();
    assert.equal(b.value, "(555) 124-567");
  });
  it("backspace can walk the whole number off without getting stuck on punctuation", () => {
    const b = box("(555) 123-4567");
    for (let i = 0; i < 20; i++) b.backspace();
    assert.equal(b.value, "");
  });
  it("forward delete over a formatting character removes the digit after it (it never just puts the character back)", () => {
    const b = box("(555) 123").moveTo(5); // before the space, caret right after ")"
    b.del();
    assert.equal(b.value, "(555) 23");
    assert.equal(b.caret, caretAfterDigits(b.value, 3));
  });
  it("deleting a digit in the middle closes the gap and keeps the caret", () => {
    const b = box("(555) 123-4567").moveTo(7); // after the '1'
    b.backspace();
    assert.equal(b.value, "(555) 234-567");
    assert.equal(b.caret, caretAfterDigits(b.value, 3));
  });
});

describe("validation helpers", () => {
  it("a complete number is exactly 10 digits, with or without a leading country code", () => {
    for (const ok of ["(555) 123-4567", "5551234567", "+1 555 123 4567", "1-555-123-4567"]) assert.equal(isCompletePhone(ok), true, ok);
    for (const no of ["", "555", "(555) 123-456", "555123456", "55512345678", "+44 20 7946 0958"]) assert.equal(isCompletePhone(no), false, no);
  });
});

describe("numbers already saved are never rewritten on their own", () => {
  it("displays a plain 10-digit number formatted, and any other shape exactly as saved", () => {
    assert.equal(formatPhoneDisplay("5551234567"), "(555) 123-4567");
    assert.equal(formatPhoneDisplay("+1 555-123-4567"), "(555) 123-4567");
    assert.equal(formatPhoneDisplay("(555) 123-4567 x12"), "(555) 123-4567 x12");
    assert.equal(formatPhoneDisplay("(800) 555-TRIM"), "(800) 555-TRIM");
    assert.equal(formatPhoneDisplay("555-1234"), "555-1234");
    assert.equal(formatPhoneDisplay("+44 20 7946 0958"), "+44 20 7946 0958");
    assert.equal(formatPhoneDisplay(null), "");
    assert.equal(formatPhoneDisplay("  "), "");
  });
  it("an input holding an extension or other non-plain number edits it as plain text (no truncation to 10 digits)", () => {
    assert.equal(isPlainPhone("(555) 123-4567 x12"), false);
    const b = box("(555) 123-4567 x12").type("3");
    assert.equal(b.value, "(555) 123-4567 x123");
  });
  it("a number saved without punctuation is plain, so editing it formats it", () => {
    assert.equal(isPlainPhone("5551234567"), true);
    assert.equal(box("5551234567").backspace().value, "(555) 123-456");
  });
});
