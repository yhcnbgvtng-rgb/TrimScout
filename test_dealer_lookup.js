const dealers = [
  { name: "Michael Stead's Hilltop Ford Kia", make: "Kia", city: "San Pablo", state: "CA" },
  { name: "Michael Stead's Hilltop Ford Kia", make: "Ford", city: "San Pablo", state: "CA" },
  { name: "Hilltop Chrysler Jeep Dodge", make: "Dodge", city: "Richmond", state: "CA" },
  { name: "Vallejo Hyundai", make: "Hyundai", city: "Vallejo", state: "CA" },
  { name: "San Leandro Chrysler Dodge Jeep Ram", make: "Ram", city: "San Leandro", state: "CA" },
  { name: "BMW of San Rafael", make: "BMW", city: "San Rafael", state: "CA" },
  { name: "Ford Fairfield", make: "Ford", city: "Fairfield", state: "CA" },
  { name: "Fremont Chevrolet", make: "Chevrolet", city: "Fremont", state: "CA" },
  { name: "Albany Subaru", make: "Subaru", city: "Albany", state: "CA" },
  { name: "Oakland Kia", make: "Kia", city: "Oakland", state: "CA" },
  { name: "Stevens Creek Chevrolet", make: "Chevrolet", city: "San Jose", state: "CA" },
  { name: "Hayward Mitsubishi", make: "Mitsubishi", city: "Hayward", state: "CA" },
  { name: "North Bay Hyundai", make: "Hyundai", city: "Petaluma", state: "CA" },
  { name: "BMW of Fremont", make: "BMW", city: "Fremont", state: "CA" },
  { name: "Peter Pan BMW", make: "BMW", city: "San Mateo", state: "CA" }
];

function resolveDirectDealerUrl(dealerName, make, vin, clickoffUrl) {
  if (clickoffUrl && typeof clickoffUrl === "string" && clickoffUrl.startsWith("http")) {
    return clickoffUrl;
  }

  const norm = (dealerName || "").toLowerCase();
  const makeLower = (make || "").toLowerCase();

  // Multi-franchise dual rooftop splits (e.g. Hilltop Ford Kia)
  if (norm.includes("hilltop") && norm.includes("ford") && norm.includes("kia")) {
    if (makeLower.includes("kia")) return "https://www.hilltopkia.com";
    return "https://www.hilltopfordca.com";
  }
  if (norm.includes("hilltop") && (norm.includes("chrysler") || norm.includes("dodge") || norm.includes("jeep") || norm.includes("ram"))) {
    return "https://www.hilltopchryslerjeepdodge.com";
  }
  if (norm.includes("san leandro") && (norm.includes("cdjr") || norm.includes("chrysler") || norm.includes("dodge") || norm.includes("jeep") || norm.includes("ram"))) {
    return "https://www.sanleandrocdjr.com";
  }
  if (norm.includes("stevens creek") && (norm.includes("cdjr") || norm.includes("chrysler") || norm.includes("dodge") || norm.includes("jeep") || norm.includes("ram"))) {
    return "https://www.stevenscreekcdjr.com";
  }
  if (norm.includes("stevens creek") && norm.includes("chevrolet")) {
    return "https://www.stevenscreekchevy.com";
  }
  if (norm.includes("vallejo") && norm.includes("hyundai")) {
    return "https://www.vallejohyundai.com";
  }
  if (norm.includes("ford") && norm.includes("fairfield")) {
    return "https://www.fordfairfield.com";
  }
  if (norm.includes("fremont") && norm.includes("chevrolet")) {
    return "https://www.fremontchevrolet.com";
  }
  if (norm.includes("albany") && norm.includes("subaru")) {
    return "https://www.albanysubaru.com";
  }
  if (norm.includes("oakland") && norm.includes("kia")) {
    return "https://www.oaklandkia.com";
  }
  if (norm.includes("north bay") && norm.includes("hyundai")) {
    return "https://www.northbayhyundai.com";
  }
  if (norm.includes("hayward") && norm.includes("mitsubishi")) {
    return "https://www.haywardmitsubishi.com";
  }
  if (norm.includes("bmw") && norm.includes("san rafael")) {
    return "https://www.bmwsanrafael.com";
  }
  if (norm.includes("bmw") && norm.includes("fremont")) {
    return "https://www.bmwoffremont.com";
  }
  if (norm.includes("peter pan") && norm.includes("bmw")) {
    return "https://www.peterpanbmw.com";
  }
  if (norm.includes("porsche") && norm.includes("san francisco")) {
    return "https://www.porschesanfrancisco.com";
  }
  if (norm.includes("audi") && norm.includes("concord")) {
    return "https://www.audiconcord.com";
  }

  // Canonical US automotive domain slug
  let cleanDomain = norm
    .replace(/\b(llc|inc|corp|co|the|of)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  if (cleanDomain.length > 3) {
    return `https://www.${cleanDomain}.com`;
  }

  return `https://www.edmunds.com/inventory/vin/${vin}`;
}

dealers.forEach(d => {
  console.log(`[${d.name} | ${d.make}] -> ${resolveDirectDealerUrl(d.name, d.make, "VIN123")}`);
});
