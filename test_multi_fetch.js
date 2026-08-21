async function fetchPage(page) {
  const url = `https://api.auto.dev/api/listings?zip=94107&distance=150&limit=100&page=${page}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': 'Bearer sk_ad_Xc5T6i3mwxFF1X8x_WbFNl5a'
    }
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.records || json.data || [];
}

async function run() {
  const start = Date.now();
  const [p1, p2] = await Promise.all([fetchPage(1), fetchPage(2)]);
  const all = [...p1, ...p2];
  console.log(`Fetched ${all.length} live vehicles in ${Date.now() - start}ms`);
}
run();
