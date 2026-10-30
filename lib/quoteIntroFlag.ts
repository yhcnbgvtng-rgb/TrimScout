/** Intro animation before step 1 of Configure Quote Request. On in Vercel previews, off in Production unless NEXT_PUBLIC_QUOTE_INTRO=1 (force on) or =0 (force off). Client-safe: no server imports. */
export function quoteIntroEnabled(env: { forced?: string; vercelEnv?: string } = { forced: process.env.NEXT_PUBLIC_QUOTE_INTRO, vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV }): boolean {
  if (env.forced === "1") return true;
  if (env.forced === "0") return false;
  return env.vercelEnv === "preview";
}
