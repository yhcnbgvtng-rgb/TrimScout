/**
 * DEALER_TEST_MODE_EMAILS — dealer accounts that belong to the owner / the audit team.
 *
 * A comma-separated list of account emails, off by default (unset / empty / junk = nobody). A listed dealer account
 * sees audit / test requests in My Quotes, each badged TEST; every other dealer never sees them. Read on the server
 * only: the browser learns "test" per row from /api/dealer-quotes, never from the list.
 */
import { env } from "node:process";

type EnvSource = Record<string, string | undefined>;

export function dealerTestEmails(source: EnvSource = env as EnvSource): string[] {
  return (source.DEALER_TEST_MODE_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(e));
}

export function isDealerTestAccount(user: { email?: string | null } | null | undefined, source?: EnvSource): boolean {
  const email = (user?.email || "").trim().toLowerCase();
  return email !== "" && dealerTestEmails(source).includes(email);
}
