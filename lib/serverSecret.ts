/**
 * Read a server env var at runtime.
 *
 * Next.js statically inlines `process.env.NAME` at `next build`. Vercel
 * Sensitive/Secret values are often absent from the build environment, so
 * that inlining becomes a permanent empty string in the serverless bundle.
 * Dynamic `process.env[name]` is not inlined and sees dashboard-injected
 * secrets when the function runs.
 */
export function serverSecret(name: string): string {
  return String(process.env[name] || "").trim();
}
