const dealers = [
  { name: "BMW of San Rafael", domain: "https://www.bmwsanrafael.com", vin: "5UX23EU0XT9421388", platform: "dealer_com" },
  { name: "Michael Steads Hilltop Ford Kia", domain: "https://www.hilltopkia.com", vin: "5XYAB5S12TG024221", platform: "dealer_on" },
  { name: "Hilltop Chrysler Jeep Dodge", domain: "https://www.hilltopchryslerjeepdodge.com", vin: "2C3CDAMP1TR219711", platform: "dealer_on" },
  { name: "San Leandro Chrysler Dodge Jeep Ram", domain: "https://www.sanleandrocdjr.com", vin: "2C3CDANPXTR276729", platform: "dealer_com" },
  { name: "Vallejo Hyundai", domain: "https://www.vallejohyundai.com", vin: "KMHL64JA0TA547418", platform: "dealer_inspire" },
  { name: "Ford Fairfield", domain: "https://www.fordfairfield.com", vin: "1FTEW3LP8TKE67089", platform: "dealer_inspire" },
  { name: "Fremont Chevrolet", domain: "https://www.fremontchevrolet.com", vin: "3GNKDBRJ0RS252607", platform: "dealer_com" },
  { name: "Oakland Kia", domain: "https://www.oaklandkia.com", vin: "5XYK6CDF9SG277542", platform: "dealer_on" }
];

function getDirectVehicleUrl(domain, vin, make) {
  const norm = domain.toLowerCase();
  
  // DealerInspire platforms
  if (norm.includes("vallejohyundai") || norm.includes("fordfairfield") || norm.includes("futurehyundai") || norm.includes("northbayhyundai")) {
    return `${domain}/inventory/?q=${vin}`;
  }
  
  // Dealer.com platforms
  if (norm.includes("bmwsanrafael") || norm.includes("sanleandrocdjr") || norm.includes("fremontchevrolet") || norm.includes("peterpanbmw") || norm.includes("eastbaybmw") || norm.includes("stevenscreekchevy")) {
    return `${domain}/new-inventory/index.htm?search=${vin}`;
  }
  
  // DealerOn platforms
  if (norm.includes("hilltop") || norm.includes("oaklandkia") || norm.includes("stevenscreekcdjr")) {
    return `${domain}/searchall.aspx?q=${vin}`;
  }
  
  // Default direct VIN search
  return `${domain}/new-inventory/index.htm?search=${vin}`;
}

dealers.forEach(d => {
  console.log(`[${d.name}] -> ${getDirectVehicleUrl(d.domain, d.vin, "Car")}`);
});
