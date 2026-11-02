/** Keyboard focus containment for modal dialogs (the quote wizard). Pure helpers, so the wrap-around rule is unit-testable. */

export const FOCUSABLE_SELECTOR = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])", "select:not([disabled])", "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** The index Tab (or Shift+Tab) should land on. `current` is -1 when focus is not on one of the `count` focusable elements. */
export function nextFocusIndex(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}

/** Focusable descendants of the dialog, in DOM order (anything hidden or inside an aria-hidden / hidden branch is left out). */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => !el.closest("[hidden],[aria-hidden='true']"));
}
