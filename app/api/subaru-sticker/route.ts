export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { SUBARU_MAKE, looksLikeSubaruPaste } from "@/lib/subaruSticker";

// Subaru factory options from the dealer's live listing feed — see
// lib/subaruSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: SUBARU_MAKE,
  looksLikePaste: looksLikeSubaruPaste,
  notFlag: "notSubaru",
});
