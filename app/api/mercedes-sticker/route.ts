export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { MERCEDES_MAKE, looksLikeMercedesPaste } from "@/lib/mercedesSticker";

// Mercedes-Benz factory options from the dealer's live listing feed — see
// lib/mercedesSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: MERCEDES_MAKE,
  looksLikePaste: looksLikeMercedesPaste,
  notFlag: "notMercedes",
});
