const dealers = [
  { name: "BMW of San Rafael", make: "BMW", vin: "5UX23EU0XT9421388" },
  { name: "Michael Steads Hilltop Ford Kia", make: "Kia", vin: "5XYAB5S12TG024221" },
  { name: "Michael Steads Hilltop Ford Kia", make: "Ford", vin: "1FMDE6BH6SLB59790" },
  { name: "Hilltop Chrysler Jeep Dodge", make: "Dodge", vin: "2C3CDAMP1TR219711" },
  { name: "San Leandro Chrysler Dodge Jeep Ram", make: "Ram", vin: "2C3CDANPXTR276729" },
  { name: "Vallejo Hyundai", make: "Hyundai", vin: "KMHL64JA0TA547418" },
  { name: "Vallejo Chrysler Dodge Jeep Ram", make: "Dodge", vin: "1C6SRFJPXSN672531" },
  { name: "Ford Fairfield", make: "Ford", vin: "1FTEW3LP8TKE67089" },
  { name: "Fremont Chevrolet", make: "Chevrolet", vin: "3GNKDBRJ0RS252607" },
  { name: "Oakland Kia", make: "Kia", vin: "5XYK6CDF9SG277542" },
  { name: "North Bay Hyundai", make: "Hyundai", vin: "7YAMUFS31TY007294" },
  { name: "Future Hyundai of Concord", make: "Hyundai", vin: "KMHL64JA4TA529438" },
  { name: "Autoworld Chrysler Dodge Jeep Ram", make: "Jeep", vin: "2C3CDAPP8TR268819" },
  { name: "BMW of Fremont", make: "BMW", vin: "WBA33AY09RF994182" },
  { name: "Peter Pan BMW", make: "BMW", vin: "WBA33AY09RF611293" }
];

function resolveDirectDealerUrl(dealerName, make, vin) {
  const norm = (dealerName || "").toLowerCase();
  const makeLower = (make || "").toLowerCase();

  if (norm.includes("hilltop") && norm.includes("ford") && norm.includes("kia")) {
    if (makeLower.includes("kia")) return `https://www.hilltopkia.com/new-inventory/?vin=${vin}`;
    return `https://www.hilltopfordca.com/new-inventory/?vin=${vin}`;
  }
  if (norm.includes("hilltop") && norm.includes("kia")) {
    return `https://www.hilltopkia.com/new-inventory/?vin=${vin}`;
  }
  if (norm.includes("hilltop") && (norm.includes("chrysler") || norm.includes("dodge") || norm.includes("jeep") || norm.includes("ram"))) {
    return `https://www.hilltopchryslerjeepdodge.com/?s=${vin}`;
  }
  if (norm.includes("san leandro") && (norm.includes("cdjr") || norm.includes("chrysler") || norm.includes("dodge") || norm.includes("jeep") || norm.includes("ram"))) {
    return `https://www.sanleandrocdjr.com/?s=${vin}`;
  }
  if (norm.includes("stevens creek") && (norm.includes("cdjr") || norm.includes("chrysler") || norm.includes("dodge") || norm.includes("jeep") || norm.includes("ram"))) {
    return `https://www.stevenscreekcdjr.com/?s=${vin}`;
  }
  if (norm.includes("stevens creek") && (norm.includes("chevy") || norm.includes("chevrolet"))) {
    return `https://www.stevenscreekchevy.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("vallejo") && norm.includes("hyundai")) {
    return `https://www.vallejohyundai.com/inventory/?q=${vin}`;
  }
  if (norm.includes("vallejo") && norm.includes("cdjr")) {
    return `https://www.vallejocdjr.com/?s=${vin}`;
  }
  if (norm.includes("ford") && norm.includes("fairfield")) {
    return `https://www.fordfairfield.com/inventory/?q=${vin}`;
  }
  if (norm.includes("fremont") && norm.includes("chevrolet")) {
    return `https://www.fremontchevrolet.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("albany") && norm.includes("subaru")) {
    return `https://www.albanysubaru.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("oakland") && norm.includes("kia")) {
    return `https://www.oaklandkia.com/new-inventory/?vin=${vin}`;
  }
  if (norm.includes("north bay") && norm.includes("hyundai")) {
    return `https://www.northbayhyundai.com/inventory/?q=${vin}`;
  }
  if (norm.includes("hayward") && norm.includes("mitsubishi")) {
    return `https://www.haywardmitsubishi.com/?s=${vin}`;
  }
  if (norm.includes("subaru of hayward") || (norm.includes("hayward") && norm.includes("subaru"))) {
    return `https://www.subaruofhayward.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("bmw") && norm.includes("san rafael")) {
    return `https://www.bmwofsanrafael.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("bmw") && norm.includes("fremont")) {
    return `https://www.bmwoffremont.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("peter pan") && norm.includes("bmw")) {
    return `https://www.peterpanbmw.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("porsche") && norm.includes("san francisco")) {
    return `https://www.porschesanfrancisco.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("porsche") && norm.includes("walnut creek")) {
    return `https://www.porschewalnutcreek.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("audi") && norm.includes("concord")) {
    return `https://www.audiconcord.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("lamborghini") && norm.includes("san francisco")) {
    return `https://www.lamborghinisanfrancisco.com/?s=${vin}`;
  }
  if (norm.includes("autoworld")) {
    return `https://www.autoworldcdjr.com/?s=${vin}`;
  }
  if (norm.includes("future hyundai")) {
    return `https://www.futurehyundaiofconcord.com/inventory/?q=${vin}`;
  }
  if (norm.includes("pleasanton") && norm.includes("mercedes")) {
    return `https://www.mbofpleasanton.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("east bay bmw")) {
    return `https://www.eastbaybmw.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("beverly hills") && norm.includes("bmw")) {
    return `https://www.bmwofbeverlyhills.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("beverly hills") && norm.includes("honda")) {
    return `https://www.hondaofbeverlyhills.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("lithia")) {
    const slug = norm.replace(/[^a-z0-9]/g, "");
    return `https://www.${slug}.com/new-inventory/index.htm?search=${vin}`;
  }
  if (norm.includes("samotors")) {
    return `https://www.samotors.com/?s=${vin}`;
  }
  if (norm.includes("mcbay")) {
    return `https://www.mcbayauto.com/?s=${vin}`;
  }

  const cleanDomain = norm
    .replace(/\b(llc|inc|corp|co|the|of)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  if (cleanDomain.length > 3) {
    return `https://www.${cleanDomain}.com/?s=${vin}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(dealerName + " " + vin)}`;
}

async function testAll() {
  for (const d of dealers) {
    const url = resolveDirectDealerUrl(d.name, d.make, d.vin);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      console.log(`[${res.status}] ${d.name} (${d.make}) -> ${url}`);
    } catch (e) {
      console.log(`[ERR] ${d.name} -> ${e.message}`);
    }
  }
}

testAll();
