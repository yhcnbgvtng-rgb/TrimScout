"use client";
// The one dollar-amount box for the whole site: shows thousands separators while you type ("10000" -> "10,000"),
// keeps the caret where you expect it, accepts "$10,000.00" pastes, and hands the caller the PLAIN number string
// ("10000") — so state, validation and everything submitted stay exactly as they were before.
//
// Whole dollars by default; pass allowCents where the field already took cents, allowNegative where it took a minus.
// Not for mileage-like counts, VIN, ZIP, percent or money factor: those keep their own plain inputs.
import React, { forwardRef, useImperativeHandle, useLayoutEffect, useReducer, useRef } from "react";
import { applyMoneyEdit, formatMoneyText } from "../lib/moneyInput";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "inputMode">;

export type MoneyInputProps = InputProps & {
  /** The plain stored value ("10000", "1234.5"); commas and a leading "$" are tolerated and shown/stripped. */
  value: string | number | null | undefined;
  /** Called with the plain number string after every edit ("" when empty). */
  onValueChange: (raw: string) => void;
  allowCents?: boolean;
  allowNegative?: boolean;
};

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onValueChange, allowCents, allowNegative, ...rest },
  ref,
) {
  const el = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => el.current as HTMLInputElement);
  const pendingCaret = useRef<number | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const opts = { allowCents, allowNegative };
  // A caller that keeps a number ("12." is 12) would drop the half-typed text; keep what was typed while it still means
  // the same number as the value we were given.
  const lastRaw = useRef<string | null>(null);
  const given = value == null ? "" : String(value);
  const sameNumber = (a: string, b: string) => Number(a.replace(/[$,\s]/g, "") || 0) === Number(b.replace(/[$,\s]/g, "") || 0);
  const plain = lastRaw.current !== null && lastRaw.current !== given && sameNumber(lastRaw.current, given) ? lastRaw.current : given;
  const shown = formatMoneyText(plain, opts);

  // After React writes the new text, put the caret back where the edit happened (a re-render is forced so this also
  // runs when the edit was rejected and the text did not change).
  useLayoutEffect(() => {
    const node = el.current;
    if (pendingCaret.current != null && node && document.activeElement === node) {
      try { node.setSelectionRange(pendingCaret.current, pendingCaret.current); } catch { /* non-text input types */ }
    }
    pendingCaret.current = null;
  });

  return (
    <input
      {...rest}
      ref={el}
      type="text"
      inputMode="decimal"
      autoComplete={rest.autoComplete ?? "off"}
      value={shown}
      onChange={(e) => {
        const t = e.target;
        const native = e.nativeEvent as InputEvent;
        const edit = applyMoneyEdit(plain, t.value, t.selectionStart ?? t.value.length, native?.inputType, opts);
        pendingCaret.current = edit.caret;
        lastRaw.current = edit.raw;
        onValueChange(edit.raw);
        rerender();
      }}
    />
  );
});

export default MoneyInput;
