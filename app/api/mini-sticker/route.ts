export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { MINI_MAKE, looksLikeMiniPaste } from "@/lib/miniSticker";

// MINI factory options from the dealer's live listing feed — see
// lib/miniSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: MINI_MAKE,
  looksLikePaste: looksLikeMiniPaste,
  notFlag: "notMini",
});
