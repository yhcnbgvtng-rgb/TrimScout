// Width of a filter box sized to its text: the characters plus the box's padding and chevron, never narrower than a
// readable minimum nor wider than a sane maximum (past that the text truncates and the full value is in the title).
export const FIT_MIN_REM = 8;
export const FIT_MAX_REM = 18;
export const FIT_CHROME_REM = 3.25;

export function fitWidth(text: string): string {
  return `clamp(${FIT_MIN_REM}rem, calc(${text.length}ch + ${FIT_CHROME_REM}rem), ${FIT_MAX_REM}rem)`;
}
