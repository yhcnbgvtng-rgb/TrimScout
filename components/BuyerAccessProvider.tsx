"use client";

import React, { createContext, useContext } from "react";

// REQUIRE_BUYER_LOGIN as the server saw it when this page was built. UI only — the API routes
// re-check the flag themselves (lib/buyerAccess.ts), so this can never grant anything.
const Ctx = createContext<boolean>(true);

export function BuyerAccessProvider({ requireLogin, children }: { requireLogin: boolean; children: React.ReactNode }) {
  return <Ctx.Provider value={requireLogin}>{children}</Ctx.Provider>;
}

/** True (the default) when buyers must sign in; false when guests may send RFQs. */
export const useRequireBuyerLogin = (): boolean => useContext(Ctx);
