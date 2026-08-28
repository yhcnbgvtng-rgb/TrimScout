import fs from 'node:fs/promises';

const dealers = JSON.parse(await fs.readFile(process.argv[2], 'utf-8'));
const out = [];
const cache = new Map(); // dedupe identical city/state pairs to cut request count

for (let i = 0; i < dealers.length; i++) {
  const d = dealers[i];
  const key = `${d.city}|${d.state}`;
  if (cache.has(key)) {
    out.push({ ...d, lat: cache.get(key).lat, lng: cache.get(key).lng });
    continue;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(d.city)}&state=${encodeURIComponent(d.state)}&country=USA&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'TrimScout-DealerGeocode/1.0 (internal tool, contact: ops@trimscout.com)' } });
    const json = await res.json();
    if (json.length > 0) {
      const lat = parseFloat(json[0].lat);
      const lng = parseFloat(json[0].lon);
      cache.set(key, { lat, lng });
      out.push({ ...d, lat, lng });
      console.error(`[${i + 1}/${dealers.length}] ✓ ${d.name} (${d.city}, ${d.state}) -> ${lat},${lng}`);
    } else {
      out.push({ ...d });
      console.error(`[${i + 1}/${dealers.length}] ✗ NO MATCH: ${d.name} (${d.city}, ${d.state})`);
    }
  } catch (err) {
    out.push({ ...d });
    console.error(`[${i + 1}/${dealers.length}] ✗ ERROR: ${d.name}: ${err.message}`);
  }
  // Nominatim usage policy: max 1 request/sec.
  await new Promise((r) => setTimeout(r, 1100));
}

console.log(JSON.stringify(out, null, 2));
const geocoded = out.filter((d) => typeof d.lat === 'number').length;
console.error(`\nGeocoded ${geocoded}/${dealers.length} dealers (${cache.size} unique city/state pairs queried).`);
