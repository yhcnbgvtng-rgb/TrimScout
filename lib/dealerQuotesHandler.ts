/**
 * The whole of GET /api/dealer-quotes minus Next plumbing, so the gate and the data flow are testable without
 * Auth.js or a box. The dealer is the SESSION's user id — there is no query parameter to widen it.
 */
import { buildDealerQuoteRows, type DealerInviteRecord, type DealerQuoteRow } from "./dealerQuotes";
import { isDealerTestAccount } from "./dealerTestMode";

export interface DealerQuotesDeps {
  listInvites: (dealerUserId: string, opts: { includeAudit: boolean }) => Promise<DealerInviteRecord[]>;
  isTestAccount?: (user: { email?: string | null }) => boolean;
  viewUrlFor?: (token: string) => string;
  referenceSecret?: string;
}

export type DealerQuotesResult =
  | { status: 200; body: { quotes: DealerQuoteRow[]; testAccount: boolean } }
  | { status: 401 | 502; body: { error: string } };

export async function dealerQuotesResponse(user: { id?: string | null; role?: string | null; email?: string | null } | null | undefined, deps: DealerQuotesDeps): Promise<DealerQuotesResult> {
  // 401 unless this is a signed-in dealer: a buyer, an admin and a signed-out visitor all stop here.
  if (!user?.id || user.role !== "dealer") return { status: 401, body: { error: "Sign in as a dealer to see your quotes." } };
  const dealerTest = (deps.isTestAccount ?? ((u) => isDealerTestAccount(u)))(user);
  try {
    const records = await deps.listInvites(String(user.id), { includeAudit: dealerTest });
    const quotes = buildDealerQuoteRows(records, {
      dealerTest,
      viewUrlFor: deps.viewUrlFor ?? ((token) => `/quote-request/received?t=${encodeURIComponent(token)}`),
      referenceSecret: deps.referenceSecret,
    });
    return { status: 200, body: { quotes, testAccount: dealerTest } };
  } catch {
    return { status: 502, body: { error: "Could not load your quotes right now." } };
  }
}
