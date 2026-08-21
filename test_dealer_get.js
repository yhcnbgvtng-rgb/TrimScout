const testUrls = [
  "https://www.hilltopkia.com/new-vehicles/?q=5XYAB5S12TG024221",
  "https://www.bmwsanrafael.com/new-inventory/index.htm?search=5UX23EU0XT9421388",
  "https://www.oaklandkia.com/new-vehicles/?q=5XYK6CDF9SG277542",
  "https://www.sanleandrocdjr.com/new-inventory/index.htm?search=2C3CDANPXTR276729",
  "https://www.vallejohyundai.com/new-vehicles/?q=KMHL64JA0TA547418"
];

async function checkUrls() {
  for (const url of testUrls) {
    try {
      const res = await fetch(url, { 
        method: "GET", 
        headers: { 
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        } 
      });
      console.log(`[${res.status}] ${url}`);
    } catch (e) {
      console.log(`[ERR] ${url} -> ${e.message}`);
    }
  }
}

checkUrls();
