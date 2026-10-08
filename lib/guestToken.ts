// Browser-side memory of a guest request's signed tracker token, so the tracker still opens after the
// ?t= link is gone from the URL. localStorage only — a convenience; the emailed/shown link always works.
const KEY = (rfqId: string) => `trimscout_guest_rfq_${rfqId}`;

export function saveGuestToken(rfqId: string, token: string): void {
  try {
    window.localStorage.setItem(KEY(rfqId), token);
  } catch {
    // private mode / blocked storage — the link in the URL still works
  }
}

export function readGuestToken(rfqId: string): string | null {
  try {
    return window.localStorage.getItem(KEY(rfqId));
  } catch {
    return null;
  }
}

import { useEffect, useState } from "react";

/**
 * The guest credential for a request page: ?t= from the link (remembered for reloads), else the
 * remembered one. `ready` flips once that lookup ran, so a page doesn't flash "sign in" first.
 * Whether it is honoured is the server's call (REQUIRE_BUYER_LOGIN) — this only carries it.
 */
export function useGuestAccess(rfqId: string): { token: string | null; ready: boolean; headers: Record<string, string> } {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("t");
    const t = fromUrl || readGuestToken(rfqId);
    if (fromUrl) saveGuestToken(rfqId, fromUrl);
    setToken(t);
    setReady(true);
  }, [rfqId]);
  return { token, ready, headers: token ? { "x-guest-token": token } : {} };
}
