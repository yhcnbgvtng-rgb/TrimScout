// Client-safe helpers for the RFQ must-have options panel (no node imports — the wizard bundles this).

/** Options shown before "Show all N options". */
export const MUST_HAVE_PREVIEW_COUNT = 6;

/**
 * Sticker PDFs carry private-use / block-drawing glyphs (▒, U+FFFD) and control characters where the font had no
 * glyph. They are never part of an option name: strip them, then fold the whitespace they leave behind.
 */
export function stripNonPrinting(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF\uFFF9-\uFFFD\uE000-\uF8FF\u2580-\u259F\u25A0-\u25FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface NamedOption {
  name: string;
  description?: string;
}

/** The no-policy fallback: the same list, glyphs stripped, blanks and repeats dropped. */
export function cleanOptionNames<T extends NamedOption>(options: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const o of options) {
    const name = stripNonPrinting(o.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ ...o, name, description: o.description !== undefined ? stripNonPrinting(o.description) || name : o.description });
  }
  return out;
}

export function mustHaveSummary(count: number): string {
  return `${count} must-have${count === 1 ? "" : "s"} selected`;
}
