/**
 * Install first in every test file. Blocks live quota hosts even if a test
 * forgets to mock fetch. Owner-only: MarketCheck / Auto.dev / Ford Direct /
 * production comparables must not be called from CI or agent test runs.
 */
import { before } from "node:test";

export const LIVE_HTTP_BLOCKLIST =
  /windowsticker\.forddirect\.com|api\.marketcheck\.com|api\.auto\.dev|trim-scout\.vercel\.app/i;

export function assertNotLiveHttpUrl(url: string): void {
  if (LIVE_HTTP_BLOCKLIST.test(url)) {
    throw new Error(
      `Tests must mock HTTP and must not consume API quota. Blocked live call: ${url}`
    );
  }
}

const nativeFetch = globalThis.fetch.bind(globalThis);

export async function guardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  assertNotLiveHttpUrl(String(input));
  return nativeFetch(input, init);
}

let installed = false;

export function installLiveHttpGuard(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = guardedFetch as typeof fetch;
}

installLiveHttpGuard();

before(() => {
  installLiveHttpGuard();
});
