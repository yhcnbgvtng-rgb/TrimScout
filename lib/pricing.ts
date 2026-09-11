// TrimScout's one paid product: the Deal Certificate. Requesting and
// comparing quotes is free; a buyer who wants to pick a quote *through*
// TrimScout — which holds the dealer to the quoted out-the-door price and
// unlocks the voucher, paperwork verification and trade-in appraisal —
// pays this flat fee (see components/FeeBreakdownModal.tsx and
// app/api/checkout/create-session). Separate from the vehicle's OTD price,
// which is paid to the dealer directly, not through TrimScout. Change this
// single constant to adjust the fee everywhere it's charged or displayed.
export const PLATFORM_FEE_CENTS = 29900; // $299.00

/** The product's name, as shown to buyers and on the Stripe receipt. */
export const DEAL_CERTIFICATE_NAME = "TrimScout Deal Certificate";
