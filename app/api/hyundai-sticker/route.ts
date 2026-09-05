export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { HYUNDAI_MAKE, looksLikeHyundaiPaste } from "@/lib/hyundaiSticker";

// Hyundai factory options from the dealer's live listing feed — see
// lib/hyundaiSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: HYUNDAI_MAKE,
  looksLikePaste: looksLikeHyundaiPaste,
  notFlag: "notHyundai",
});
