export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { MITSUBISHI_MAKE, looksLikeMitsubishiPaste } from "@/lib/mitsubishiSticker";

// Mitsubishi factory options from the dealer's live listing feed — see
// lib/mitsubishiSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: MITSUBISHI_MAKE,
  looksLikePaste: looksLikeMitsubishiPaste,
  notFlag: "notMitsubishi",
});
