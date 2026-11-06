"use client";

import React, { useEffect, useState } from "react";
import { getSession, signOut } from "next-auth/react";
import { buyerSignInHref, buyerSignInMode, currentCallbackUrl, isBuyerOnlyMessage } from "../lib/buyerSignIn";

/**
 * Rendered right after an error message inside its existing element, so the styling stays the message's own. Does nothing
 * unless the message is the buyer-only one. Signed out: a "Sign in" link to the buyer sign-in with a callbackUrl back to
 * this page. Signed in as a dealer or other non-buyer: says so and offers "Sign in as a buyer" (sign out, then sign in).
 */
export function BuyerSignInLink({
  message,
  role,
  returnTo,
}: {
  message: string | null | undefined;
  /** For tests and callers that already know the session role. Omitted: read from the session when the message matches. */
  role?: string | null;
  /** Defaults to this page's path and query. */
  returnTo?: string;
}) {
  const matches = isBuyerOnlyMessage(message);
  const [liveRole, setLiveRole] = useState<string | null | undefined>(role);
  useEffect(() => {
    if (!matches || role !== undefined) return;
    let cancelled = false;
    getSession().then((s) => { if (!cancelled) setLiveRole(((s?.user as { role?: string } | undefined)?.role) ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [matches, role]);
  if (!matches) return null;

  const back = returnTo ?? (typeof window !== "undefined" ? currentCallbackUrl(window.location.pathname, window.location.search) : "/");
  const href = buyerSignInHref(back);
  const effectiveRole = role !== undefined ? role : liveRole;
  const cls = "ml-1 font-bold underline underline-offset-2 hover:text-white";

  if (buyerSignInMode(effectiveRole) === "switch_account") {
    return (
      <span data-testid="buyer-signin-switch">
        {" "}You're signed in as a {effectiveRole}.{" "}
        <a
          href={href}
          className={cls}
          data-testid="buyer-signin-link"
          onClick={(e) => { e.preventDefault(); void signOut({ redirect: false }).finally(() => window.location.assign(href)); }}
        >
          Sign in as a buyer
        </a>
      </span>
    );
  }
  return <a href={href} className={cls} data-testid="buyer-signin-link">Sign in</a>;
}
