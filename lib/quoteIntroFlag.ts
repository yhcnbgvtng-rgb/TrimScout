/** Intro animation before step 1 of Configure Quote Request. On everywhere; NEXT_PUBLIC_QUOTE_INTRO=0 turns it off. Client-safe: no server imports. */
export function quoteIntroEnabled(env: { forced?: string } = { forced: process.env.NEXT_PUBLIC_QUOTE_INTRO }): boolean {
  return env.forced !== "0";
}
