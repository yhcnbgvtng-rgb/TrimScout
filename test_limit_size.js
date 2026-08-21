async function testLimit(limit) {
  try {
    const url = `https://api.auto.dev/api/listings?zip=94107&distance=150&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer sk_ad_Xc5T6i3mwxFF1X8x_WbFNl5a'
      }
    });
    const json = await res.json();
    const count = (json.records || json.data || []).length;
    console.log(`Limit ${limit} -> SUCCESS: ${count} vehicles`);
  } catch (err) {
    console.log(`Limit ${limit} -> ERROR: ${err.message}`);
  }
}

async function run() {
  await testLimit(35);
  await testLimit(50);
  await testLimit(60);
  await testLimit(75);
  await testLimit(100);
}
run();
