// TrimScout's flat platform fee, charged to the buyer when they lock in a
// dealer's winning bid (see components/FeeBreakdownModal.tsx and
// app/api/checkout/create-session). Separate from the vehicle's OTD
// price — that's paid to the dealer directly, not through TrimScout.
// Change this single constant to adjust the fee everywhere it's charged
// or displayed.
export const PLATFORM_FEE_CENTS = 29900; // $299.00
