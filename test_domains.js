const https = require('https');

const domains = [
  "https://www.hilltopkia.com",
  "https://www.porschesanfrancisco.com",
  "https://www.audiconcord.com",
  "https://www.porschewalnutcreek.com",
  "https://www.autoworldcdjr.com",
  "https://www.futurehyundaiofconcord.com",
  "https://www.mbofpleasanton.com",
  "https://www.eastbaybmw.com",
  "https://www.stevenscreekcdjr.com",
  "https://www.subaruofhayward.com"
];

async function check(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      resolve({ url, status: res.statusCode });
    }).on('error', (e) => {
      resolve({ url, status: 0, error: e.message });
    });
  });
}

Promise.all(domains.map(check)).then((results) => {
  results.forEach(r => console.log(`[${r.status}] ${r.url}`));
});
