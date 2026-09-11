import { importPastedFactoryVehicle } from "../../lib/pasteImport";
import { extractVinFromDealerPage } from "../../lib/fordSticker";
const url = process.argv[2] || "https://www.loubachrodtbmw.com/new-Rockford-2026-BMW-X3-30+xDrive-5UX53GP01T9190742";
const page = await extractVinFromDealerPage(url);
console.log("page fetch:", JSON.stringify({ status: page.httpStatus, blocked: page.blocked, vin: page.vin, price: page.listingPrice, dealer: page.dealer }));
