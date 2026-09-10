import { extractVinFromDealerPage } from "../../lib/fordSticker";
const sites = [
  "https://www.paulmillerbmw.com/new-inventory/index.htm",
  "https://www.princetonbmw.com/new-inventory/index.htm",
  "https://www.bmwofmanhattan.com/new-inventory/index.htm",
  "https://www.openroadbmw.com/new-inventory/index.htm",
];
for (const url of sites) {
  const r = await extractVinFromDealerPage(url);
  console.log(url.split("/")[2].padEnd(28), "status", r.httpStatus, "blocked", r.blocked, "dealer:", r.dealer?.name ?? null, r.dealer?.source ? `(${r.dealer.source})` : "");
}
