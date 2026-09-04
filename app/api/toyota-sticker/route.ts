export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { TOYOTA_MAKE, looksLikeToyotaPaste } from "@/lib/toyotaSticker";

// Toyota/Lexus factory options from the dealer's live listing feed — see
// lib/toyotaSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: TOYOTA_MAKE,
  looksLikePaste: looksLikeToyotaPaste,
  notFlag: "notToyota",
});
