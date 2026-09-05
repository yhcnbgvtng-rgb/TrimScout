export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { KIA_MAKE, looksLikeKiaPaste } from "@/lib/kiaSticker";

// Kia factory options from the dealer's live listing feed — see
// lib/kiaSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: KIA_MAKE,
  looksLikePaste: looksLikeKiaPaste,
  notFlag: "notKia",
});
