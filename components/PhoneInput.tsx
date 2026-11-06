"use client";

import React, { useLayoutEffect, useRef } from "react";
import { editPhone, formatPhone, isPlainPhone } from "../lib/phone";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string | null | undefined;
  /** Gets the text to store: "(XXX) XXX-XXXX" as it is typed ("" when there are no digits). */
  onChange: (value: string) => void;
};

/**
 * The one phone box for the whole app (rules and edge cases: lib/phone.ts). Shows "(XXX) XXX-XXXX" as the person types, ignores non-digits, drops a
 * leading 1 / +1, handles paste and backspace over ")" "-" " ", and keeps the caret after the digit being edited. A saved number that is not a plain
 * US number (an extension, letters, international) is shown and edited as it was saved; a saved plain number is shown formatted.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, Props>(function PhoneInput({ value, onChange, autoComplete = "tel", placeholder = "(555) 123-4567", maxLength, ...rest }, forwardedRef) {
  const inner = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  const raw = value ?? "";
  const shown = isPlainPhone(raw) ? formatPhone(raw) : raw;

  useLayoutEffect(() => {
    const el = inner.current;
    if (el && caret.current !== null && document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <input
      {...rest}
      ref={(el) => { inner.current = el; if (typeof forwardedRef === "function") forwardedRef(el); else if (forwardedRef) forwardedRef.current = el; }}
      type="tel"
      inputMode="tel"
      autoComplete={autoComplete}
      placeholder={placeholder}
      maxLength={maxLength}
      value={shown}
      onChange={(e) => {
        const forward = (e.nativeEvent as InputEvent).inputType === "deleteContentForward";
        const edit = editPhone(shown, e.target.value, e.target.selectionStart ?? e.target.value.length, { forward });
        caret.current = edit.caret;
        onChange(edit.value);
        // Nothing to re-render when the edit changed nothing (a letter was ignored): React puts the old text back, so put the caret back too.
        if (edit.value === shown) requestAnimationFrame(() => { if (document.activeElement === inner.current) inner.current?.setSelectionRange(edit.caret, edit.caret); });
      }}
    />
  );
});
