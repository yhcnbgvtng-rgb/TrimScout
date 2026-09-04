export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { createListingFeedStickerHandlers } from "@/lib/listingFeedStickerRoute";
import { PORSCHE_MAKE, looksLikePorschePaste } from "@/lib/porscheSticker";

// Porsche factory options from the dealer's live listing feed — see
// lib/porscheSticker.ts and lib/listingFeedBuild.ts for the why and how.
export const { GET, POST } = createListingFeedStickerHandlers({
  make: PORSCHE_MAKE,
  looksLikePaste: looksLikePorschePaste,
  notFlag: "notPorsche",
});
