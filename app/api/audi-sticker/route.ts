export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { AUDI_MAKE, looksLikeAudiPaste } from "@/lib/audiSticker";

// Audi factory options from the dealer's live listing feed — see
// lib/audiSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: AUDI_MAKE,
  looksLikePaste: looksLikeAudiPaste,
  notFlag: "notAudi",
});
