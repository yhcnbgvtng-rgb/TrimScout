export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { NISSAN_MAKE, looksLikeNissanPaste } from "@/lib/nissanSticker";

// Nissan/Infiniti factory options from the dealer's live listing feed — see
// lib/nissanSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: NISSAN_MAKE,
  looksLikePaste: looksLikeNissanPaste,
  notFlag: "notNissan",
});
