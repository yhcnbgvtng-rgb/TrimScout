const dealers = [
  { domain: "https://www.hilltopkia.com", vin: "3KPFW4DE6TE275034" },
  { domain: "https://www.bmwsanrafael.com", vin: "5UX23EU0XT9421388" },
  { domain: "https://www.vallejohyundai.com", vin: "KMHL64JA0TA547418" },
  { domain: "https://www.sanleandrocdjr.com", vin: "2C3CDANPXTR276729" },
  { domain: "https://www.oaklandkia.com", vin: "5XYK6CDF9SG277542" }
];

const patterns = [
  (d, v) => `${d}/new-vehicles/?_dFR[vin][0]=${v}`,
  (d, v) => `${d}/new-inventory/?vin=${v}`,
  (d, v) => `${d}/new-inventory/index.htm?search=${v}`,
  (d, v) => `${d}/search/new/?q=${v}`,
  (d, v) => `${d}/inventory/?keyword=${v}`,
  (d, v) => `${d}/?s=${v}`,
  (d, v) => `${d}/inventory?q=${v}`,
  (d, v) => `${d}`
];

async function testAll() {
  for (const dealer of dealers) {
    console.log(`\nTesting ${dealer.domain}...`);
    for (const p of patterns) {
      const url = p(dealer.domain, dealer.vin);
      try {
        const res = await fetch(url, { 
          method: "GET",
          headers: { 
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
          }
        });
        console.log(`  [${res.status}] ${url}`);
      } catch (e) {
        console.log(`  [ERR] ${url} -> ${e.message}`);
      }
    }
  }
}

testAll();
