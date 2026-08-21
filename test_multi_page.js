const https = require('https');

async function fetchPage(page) {
  return new Promise((resolve, reject) => {
    const url = `https://api.auto.dev/api/listings?zip=94107&distance=150&limit=100&page=${page}`;
    const req = https.get(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer sk_ad_Xc5T6i3mwxFF1X8x_WbFNl5a'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.records || json.data || []);
        } catch (e) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
  });
}

async function run() {
  const start = Date.now();
  const [p1, p2] = await Promise.all([fetchPage(1), fetchPage(2)]);
  const all = [...p1, ...p2];
  console.log(`Fetched ${all.length} live vehicles in ${Date.now() - start}ms`);
}
run();
