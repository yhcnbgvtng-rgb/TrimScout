export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { BMW_MAKE, looksLikeBmwPaste } from "@/lib/bmwSticker";

// BMW factory options from the dealer's live listing feed — see
// lib/bmwSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: BMW_MAKE,
  looksLikePaste: looksLikeBmwPaste,
  notFlag: "notBmw",
});
