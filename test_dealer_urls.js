function resolveDirectDealerUrl(dealerName, make, vin, clickoffUrl) {
  if (clickoffUrl && typeof clickoffUrl === "string" && clickoffUrl.startsWith("http")) {
    return clickoffUrl;
  }

  const normalized = (dealerName || "").toLowerCase();
  
  if (normalized.includes("porsche") && normalized.includes("san francisco")) {
    return `https://www.porschesanfrancisco.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("porsche") && normalized.includes("walnut creek")) {
    return `https://www.porschewalnutcreek.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("audi") && normalized.includes("concord")) {
    return `https://www.audiconcord.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("lamborghini") && normalized.includes("san francisco")) {
    return `https://www.lamborghinisanfrancisco.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("hilltop") && normalized.includes("kia")) {
    return `https://www.hilltopkia.com/inventory/new?q=${vin}`;
  }
  if (normalized.includes("hilltop") && (normalized.includes("chrysler") || normalized.includes("dodge") || normalized.includes("jeep"))) {
    return `https://www.hilltopchryslerjeepdodge.com/inventory?q=${vin}`;
  }
  if (normalized.includes("autoworld")) {
    return `https://www.autoworldcdjr.com/inventory?q=${vin}`;
  }
  if (normalized.includes("vallejo") && normalized.includes("cdjr")) {
    return `https://www.vallejocdjr.com/inventory?q=${vin}`;
  }
  if (normalized.includes("future hyundai")) {
    return `https://www.futurehyundaiofconcord.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("san leandro")) {
    return `https://www.sanleandrocdjr.com/inventory?q=${vin}`;
  }
  if (normalized.includes("pleasanton") && normalized.includes("mercedes")) {
    return `https://www.mbofpleasanton.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("east bay bmw")) {
    return `https://www.eastbaybmw.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("stevens creek")) {
    return `https://www.stevenscreekcdjr.com/inventory?q=${vin}`;
  }
  if (normalized.includes("subaru of hayward")) {
    return `https://www.subaruofhayward.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("bmw") && normalized.includes("san rafael")) {
    return `https://www.bmwsanrafael.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("beverly hills") && normalized.includes("bmw")) {
    return `https://www.bmwofbeverlyhills.com/searchall.aspx?q=${vin}`;
  }
  if (normalized.includes("beverly hills") && normalized.includes("honda")) {
    return `https://www.hondaofbeverlyhills.com/searchall.aspx?q=${vin}`;
  }

  let cleanDomain = normalized
    .replace(/\b(llc|inc|corp|co|the|of)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  if (cleanDomain.length > 3) {
    return `https://www.${cleanDomain}.com/searchall.aspx?q=${vin}`;
  }

  return `https://www.google.com/search?btnI=1&q=${encodeURIComponent(`${dealerName} ${vin}`)}`;
}

const testCases = [
  { name: "Porsche San Francisco", vin: "WP1AA2A53LLB05236" },
  { name: "Michael Steads Hilltop Ford Kia", vin: "5XYAB5S19TG024829" },
  { name: "Audi Concord", vin: "WAUH9BFW8S7001310" },
  { name: "Autoworld Chrysler Dodge Jeep Ram", vin: "2C3CDAPP8TR268819" },
  { name: "Future Hyundai of Concord", vin: "KM8JBDD28SU392525" },
  { name: "Lithia Ford Lincoln of Grand Forks", vin: "1FTFW3L82TKD27777", clickoffUrl: "https://www.lithia.com/catcher.esl?vin=1FTFW3L82TKD27777" }
];

testCases.forEach(tc => {
  console.log(`[${tc.name}] -> ${resolveDirectDealerUrl(tc.name, "Make", tc.vin, tc.clickoffUrl)}`);
});
