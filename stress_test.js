const https = require('https');

const BASE_URL = 'https://temporary-rushing-birch-1zmkdsr.vercel.app';

async function request(path) {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const duration = Date.now() - start;
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          url,
          path,
          status: res.statusCode,
          duration,
          json,
          dataLength: data.length,
        });
      });
    }).on('error', (err) => {
      resolve({
        url,
        path,
        status: 0,
        duration: Date.now() - start,
        error: err.message,
      });
    });
  });
}

async function runStressTest() {
  console.log("=================================================");
  console.log("⚡ STARTING TRIMSCOUT PRODUCTION STRESS TEST ⚡");
  console.log(`Target: ${BASE_URL}`);
  console.log("=================================================\n");

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    durations: [],
  };

  function record(res, testName, validator) {
    results.total++;
    results.durations.push(res.duration);
    const pass = res.status >= 200 && res.status < 400 && (!validator || validator(res));
    if (pass) {
      results.passed++;
      console.log(`✅ [${res.status}] ${testName} (${res.duration}ms)`);
    } else {
      results.failed++;
      console.log(`❌ [${res.status}] ${testName} (${res.duration}ms) - Failed validator`);
    }
  }

  // --- SUITE 1: Core Static & Dynamic Pages ---
  console.log("--- 1. CORE PAGE INTEGRITY ---");
  const homeRes = await request('/');
  record(homeRes, "Homepage Load (200 OK & Next.js HTML)", (r) => r.dataLength > 5000);

  // --- SUITE 2: Multi-City Geographic Search Matrix ---
  console.log("\n--- 2. GEOGRAPHIC & MULTI-METRO MATRIX ---");
  const metros = [
    { name: "San Francisco (94107)", path: "/api/inventory?zip=94107&radius=50" },
    { name: "Beverly Hills (90210)", path: "/api/inventory?zip=90210&radius=50" },
    { name: "Manhattan (10001)", path: "/api/inventory?zip=10001&radius=50" },
    { name: "Dallas (75001)", path: "/api/inventory?zip=75001&radius=50" },
    { name: "Miami (33101)", path: "/api/inventory?zip=33101&radius=50" },
    { name: "Chicago (60601)", path: "/api/inventory?zip=60601&radius=50" },
  ];

  for (const m of metros) {
    const res = await request(m.path);
    record(res, `Metro Search: ${m.name}`, (r) => r.json && r.json.success && r.json.data.length > 0);
  }

  // --- SUITE 3: Brand & Make Filtering Matrix ---
  console.log("\n--- 3. BRAND & MAKE FILTERING MATRIX ---");
  const makes = ["Porsche", "BMW", "Ford", "Toyota", "Mercedes-Benz", "Audi", "Kia", "Hyundai"];
  for (const make of makes) {
    const res = await request(`/api/inventory?zip=94107&radius=150&make=${encodeURIComponent(make)}`);
    record(res, `Make Filter: ${make}`, (r) => r.json && r.json.success && r.json.data.length > 0);
  }

  // --- SUITE 4: NHTSA Live VIN Decoder Concurrency ---
  console.log("\n--- 4. NHTSA VIN DECODER PARALLEL BATCH ---");
  const vins = [
    { label: "BMW 330i", vin: "WBA33AY09RF611293" },
    { label: "Porsche 911", vin: "WP0AA2A94RS210492" },
    { label: "Ford F-150", vin: "1FTFW1ED5PFA12345" },
    { label: "Tesla Model 3", vin: "5YJ3E1EB9PF192841" },
  ];

  const vinPromises = vins.map((v) => request(`/api/vin-decode?vin=${v.vin}`));
  const vinResults = await Promise.all(vinPromises);
  vinResults.forEach((r, idx) => {
    record(r, `VIN Decode: ${vins[idx].label} (${vins[idx].vin})`, (res) => res.json && res.json.success && res.json.data.make);
  });

  // --- SUITE 5: Boundary & Edge Cases ---
  console.log("\n--- 5. EDGE CASES & BOUNDARY TESTING ---");
  
  // Edge Case A: Invalid VIN length (400 expected)
  const shortVinRes = await request('/api/vin-decode?vin=INVALID123');
  record(shortVinRes, "Short VIN (400 validation error expected)", (r) => r.status === 400);

  // Edge Case B: Empty Query
  const emptyQueryRes = await request('/api/inventory?query=');
  record(emptyQueryRes, "Empty Query Parameter", (r) => r.json && r.json.success);

  // Edge Case C: Zero Results Exact Match (e.g. Nonexistent vehicle)
  const zeroResultRes = await request('/api/inventory?query=NonExistentCarXYZ99999&zip=94107');
  record(zeroResultRes, "Zero-Match Query Precision (returns clean empty data)", (r) => r.json && r.json.success && Array.isArray(r.json.data));

  // Edge Case D: Nationwide 3500mi search
  const nationwideRes = await request('/api/inventory?zip=94107&radius=3500');
  record(nationwideRes, "Nationwide Radius (3500 mi)", (r) => r.json && r.json.success && r.json.data.length > 0);

  // --- SUITE 6: High-Concurrency Burst Load ---
  console.log("\n--- 6. HIGH-CONCURRENCY PARALLEL BURST (25 CONCURRENT REQUESTS) ---");
  const burstRequests = Array.from({ length: 25 }, (_, i) => {
    const make = makes[i % makes.length];
    return request(`/api/inventory?make=${encodeURIComponent(make)}&zip=94107&radius=100`);
  });

  const burstStart = Date.now();
  const burstResponses = await Promise.all(burstRequests);
  const burstDuration = Date.now() - burstStart;
  
  let burstSuccessCount = 0;
  burstResponses.forEach((r, i) => {
    if (r.status === 200 && r.json && r.json.success) {
      burstSuccessCount++;
    }
  });

  console.log(`⚡ 25 Concurrent Requests completed in ${burstDuration}ms (${(burstDuration / 25).toFixed(1)}ms per request)`);
  console.log(`⚡ Concurrency Success Rate: ${burstSuccessCount}/25 (${((burstSuccessCount / 25) * 100).toFixed(0)}%)`);

  // --- SUMMARY STATS ---
  results.durations.sort((a, b) => a - b);
  const p50 = results.durations[Math.floor(results.durations.length * 0.5)];
  const p95 = results.durations[Math.floor(results.durations.length * 0.95)];
  const min = results.durations[0];
  const max = results.durations[results.durations.length - 1];

  console.log("\n=================================================");
  console.log("📊 STRESS TEST SUMMARY REPORT");
  console.log("=================================================");
  console.log(`Total Test Runs:   ${results.total + 25}`);
  console.log(`Passed:            ${results.passed + burstSuccessCount}`);
  console.log(`Failed:            ${results.failed + (25 - burstSuccessCount)}`);
  console.log(`Overall Pass Rate: ${(((results.passed + burstSuccessCount) / (results.total + 25)) * 100).toFixed(1)}%`);
  console.log(`Latency p50:       ${p50}ms`);
  console.log(`Latency p95:       ${p95}ms`);
  console.log(`Min Response Time: ${min}ms`);
  console.log(`Max Response Time: ${max}ms`);
  console.log("=================================================\n");
}

runStressTest();
