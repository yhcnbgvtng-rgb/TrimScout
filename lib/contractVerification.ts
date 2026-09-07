/**
 * Verifies an uploaded sales contract against the winning bid it's
 * supposed to honor — pricing and dealer identity, so a dealer can't
 * quietly add a fee after winning the bid.
 *
 * Same split as lib/negotiationPolicy.ts: an LLM (lib/contractExtraction.ts)
 * only reads the PDF and returns structured fields. Every pass/fail
 * decision here is plain arithmetic and string comparison — never the
 * LLM's judgment call. The one number that actually can't be gamed by
 * relabeling a fee is the contract's own stated total out-the-door price:
 * any fee a dealer sneaks in has to show up there, so that's the
 * authoritative check. Itemized fee lines are extracted for display only
 * — informational, never the basis for pass/fail, since a contract's line
 * items don't map cleanly onto a bid's four fee buckets by name alone.
 */

export interface ContractFeeLine {
  label: string;
  amount: number;
}

export interface ContractExtractedFields {
  /** The contract's own stated total due / out-the-door price. Null if it couldn't be read. */
  totalOtdPrice: number | null;
  dealerName: string | null;
  buyerName: string | null;
  feeLines: ContractFeeLine[];
}

export interface WinningBidTerms {
  dealerName: string;
  totalOtdPrice: number;
  /** For display next to feeLines only — not used in the pass/fail check. See file header. */
  salesTax?: number;
  dmvFees?: number;
  docFee?: number;
  dealerAccessories?: number;
}

export type ContractFlagSeverity = "info" | "warning" | "critical";

export interface ContractFlag {
  severity: ContractFlagSeverity;
  message: string;
}

export type ContractVerificationStatus = "verified" | "flagged" | "needs_review";

export interface ContractVerificationResult {
  status: ContractVerificationStatus;
  priceMatches: boolean;
  dealerNameMatches: boolean;
  flags: ContractFlag[];
  extracted: ContractExtractedFields;
  checkedAt: string;
}

/** A cent of rounding slack — never more. Contracts and bids should agree to the penny. */
const PRICE_TOLERANCE_DOLLARS = 1;

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function verifyContractAgainstBid(
  extracted: ContractExtractedFields,
  bid: WinningBidTerms
): ContractVerificationResult {
  const flags: ContractFlag[] = [];

  let priceMatches = false;
  if (extracted.totalOtdPrice == null) {
    flags.push({
      severity: "warning",
      message: "Could not read a total out-the-door price from the uploaded document — review it manually.",
    });
  } else {
    const diff = Math.round((extracted.totalOtdPrice - bid.totalOtdPrice) * 100) / 100;
    priceMatches = Math.abs(diff) <= PRICE_TOLERANCE_DOLLARS;
    if (!priceMatches) {
      if (diff > 0) {
        flags.push({
          severity: "critical",
          message: `Contract total is $${diff.toLocaleString("en-US")} HIGHER than the accepted bid — $${extracted.totalOtdPrice.toLocaleString(
            "en-US"
          )} on the contract vs. $${bid.totalOtdPrice.toLocaleString("en-US")} in the winning bid. This looks like an added fee.`,
        });
      } else {
        flags.push({
          severity: "warning",
          message: `Contract total is $${Math.abs(diff).toLocaleString(
            "en-US"
          )} LOWER than the accepted bid — not a buyer risk, but confirm this is intentional before signing.`,
        });
      }
    }
  }

  let dealerNameMatches = false;
  if (extracted.dealerName) {
    const a = normalizeName(extracted.dealerName);
    const b = normalizeName(bid.dealerName);
    dealerNameMatches = a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
    if (!dealerNameMatches) {
      flags.push({
        severity: "critical",
        message: `Contract dealer name ("${extracted.dealerName}") doesn't match the winning bid's dealer ("${bid.dealerName}").`,
      });
    }
  } else {
    flags.push({
      severity: "warning",
      message: "Could not read a dealer name from the uploaded document — review it manually.",
    });
  }

  const hasCritical = flags.some((f) => f.severity === "critical");
  const hasAnyFlag = flags.length > 0;
  const status: ContractVerificationStatus = hasCritical
    ? "flagged"
    : extracted.totalOtdPrice == null || !extracted.dealerName
      ? "needs_review"
      : hasAnyFlag
        ? "flagged"
        : "verified";

  return {
    status,
    priceMatches,
    dealerNameMatches,
    flags,
    extracted,
    checkedAt: new Date().toISOString(),
  };
}
