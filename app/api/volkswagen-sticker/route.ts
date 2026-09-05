export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { VOLKSWAGEN_MAKE, looksLikeVolkswagenPaste } from "@/lib/volkswagenSticker";

// Volkswagen factory options from the dealer's live listing feed — see
// lib/volkswagenSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: VOLKSWAGEN_MAKE,
  looksLikePaste: looksLikeVolkswagenPaste,
  notFlag: "notVolkswagen",
});
