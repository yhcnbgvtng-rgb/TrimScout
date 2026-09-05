export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { VOLVO_MAKE, looksLikeVolvoPaste } from "@/lib/volvoSticker";

// Volvo factory options from the dealer's live listing feed — see
// lib/volvoSticker.ts and lib/listingFeedBuild.ts.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: VOLVO_MAKE,
  looksLikePaste: looksLikeVolvoPaste,
  notFlag: "notVolvo",
});
