export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { MAZDA_MAKE, looksLikeMazdaPaste } from "@/lib/mazdaSticker";

// Mazda factory options from the dealer's live listing feed — see
// lib/mazdaSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: MAZDA_MAKE,
  looksLikePaste: looksLikeMazdaPaste,
  notFlag: "notMazda",
});
