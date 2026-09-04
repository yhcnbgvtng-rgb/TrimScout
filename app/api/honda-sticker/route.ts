export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { HONDA_MAKE, looksLikeHondaPaste } from "@/lib/hondaSticker";

// Honda/Acura factory options from the dealer's live listing feed — see
// lib/hondaSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: HONDA_MAKE,
  looksLikePaste: looksLikeHondaPaste,
  notFlag: "notHonda",
});
