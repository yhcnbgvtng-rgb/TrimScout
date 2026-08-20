export interface ExactZipData {
  lat: number;
  lng: number;
  city: string;
  state: string;
  taxRate: number;
}

export const EXACT_ZIP_LOOKUP: Record<string, ExactZipData> = {
  // --- SAN FRANCISCO BAY AREA ---
  "94101": { lat: 37.7749, lng: -122.4194, city: "San Francisco", state: "CA", taxRate: 0.08625 },
  "94102": { lat: 37.7780, lng: -122.4210, city: "San Francisco (Civic Center)", state: "CA", taxRate: 0.08625 },
  "94103": { lat: 37.7726, lng: -122.4099, city: "San Francisco (SoMa)", state: "CA", taxRate: 0.08625 },
  "94105": { lat: 37.7890, lng: -122.3950, city: "San Francisco (Financial)", state: "CA", taxRate: 0.08625 },
  "94107": { lat: 37.7690, lng: -122.3950, city: "San Francisco (Potrero/Mission Bay)", state: "CA", taxRate: 0.08625 },
  "94108": { lat: 37.7920, lng: -122.4080, city: "San Francisco (Chinatown)", state: "CA", taxRate: 0.08625 },
  "94109": { lat: 37.7930, lng: -122.4220, city: "San Francisco (Nob Hill)", state: "CA", taxRate: 0.08625 },
  "94110": { lat: 37.7500, lng: -122.4150, city: "San Francisco (Mission)", state: "CA", taxRate: 0.08625 },
  "94114": { lat: 37.7580, lng: -122.4350, city: "San Francisco (Castro)", state: "CA", taxRate: 0.08625 },
  "94115": { lat: 37.7870, lng: -122.4380, city: "San Francisco (Pacific Heights)", state: "CA", taxRate: 0.08625 },
  "94117": { lat: 37.7700, lng: -122.4450, city: "San Francisco (Haight-Ashbury)", state: "CA", taxRate: 0.08625 },
  "94118": { lat: 37.7831, lng: -122.4533, city: "San Francisco (Richmond)", state: "CA", taxRate: 0.08625 },
  "94122": { lat: 37.7590, lng: -122.4850, city: "San Francisco (Sunset)", state: "CA", taxRate: 0.08625 },
  "94123": { lat: 37.8000, lng: -122.4360, city: "San Francisco (Marina)", state: "CA", taxRate: 0.08625 },
  "94015": { lat: 37.6769, lng: -122.4597, city: "Colma / Daly City", state: "CA", taxRate: 0.09125 },
  "94016": { lat: 37.6890, lng: -122.4690, city: "Daly City", state: "CA", taxRate: 0.09125 },
  "94080": { lat: 37.6540, lng: -122.4230, city: "South San Francisco", state: "CA", taxRate: 0.09125 },
  "94010": { lat: 37.5850, lng: -122.3650, city: "Burlingame", state: "CA", taxRate: 0.09125 },
  "94401": { lat: 37.5750, lng: -122.3150, city: "San Mateo (Downtown)", state: "CA", taxRate: 0.09125 },
  "94402": { lat: 37.5630, lng: -122.3255, city: "San Mateo", state: "CA", taxRate: 0.09125 },
  "94025": { lat: 37.4530, lng: -122.1820, city: "Menlo Park", state: "CA", taxRate: 0.09125 },
  "94301": { lat: 37.4440, lng: -122.1610, city: "Palo Alto", state: "CA", taxRate: 0.09125 },
  "94063": { lat: 37.4852, lng: -122.2364, city: "Redwood City", state: "CA", taxRate: 0.09125 },
  "94040": { lat: 37.3860, lng: -122.0840, city: "Mountain View", state: "CA", taxRate: 0.09125 },
  "94086": { lat: 37.3680, lng: -122.0360, city: "Sunnyvale", state: "CA", taxRate: 0.09125 },
  "95050": { lat: 37.3541, lng: -121.9552, city: "Santa Clara", state: "CA", taxRate: 0.09125 },
  "95110": { lat: 37.3400, lng: -121.8990, city: "San Jose (Downtown)", state: "CA", taxRate: 0.09375 },
  "94901": { lat: 37.9735, lng: -122.5311, city: "San Rafael", state: "CA", taxRate: 0.090 },
  "94925": { lat: 37.9255, lng: -122.5275, city: "Corte Madera", state: "CA", taxRate: 0.090 },
  "94941": { lat: 37.9060, lng: -122.5450, city: "Mill Valley", state: "CA", taxRate: 0.0875 },
  "94965": { lat: 37.8590, lng: -122.4850, city: "Sausalito", state: "CA", taxRate: 0.0875 },
  "94710": { lat: 37.8715, lng: -122.2730, city: "Berkeley", state: "CA", taxRate: 0.0925 },
  "94601": { lat: 37.7750, lng: -122.2240, city: "Oakland", state: "CA", taxRate: 0.0925 },
  "94538": { lat: 37.5483, lng: -121.9886, city: "Fremont", state: "CA", taxRate: 0.0925 },

  // --- LOS ANGELES / SOCAL ---
  "90001": { lat: 33.9730, lng: -118.2480, city: "Los Angeles", state: "CA", taxRate: 0.095 },
  "90012": { lat: 34.0620, lng: -118.2380, city: "Los Angeles (Downtown)", state: "CA", taxRate: 0.095 },
  "90024": { lat: 34.0630, lng: -118.4440, city: "Los Angeles (Westwood/UCLA)", state: "CA", taxRate: 0.095 },
  "90028": { lat: 34.1010, lng: -118.3270, city: "Hollywood", state: "CA", taxRate: 0.095 },
  "90067": { lat: 34.0590, lng: -118.4180, city: "Century City", state: "CA", taxRate: 0.095 },
  "90210": { lat: 34.0736, lng: -118.4004, city: "Beverly Hills", state: "CA", taxRate: 0.095 },
  "90401": { lat: 34.0195, lng: -118.4912, city: "Santa Monica", state: "CA", taxRate: 0.1025 },
  "91101": { lat: 34.1478, lng: -118.1445, city: "Pasadena", state: "CA", taxRate: 0.1025 },
  "92101": { lat: 32.7157, lng: -117.1611, city: "San Diego", state: "CA", taxRate: 0.0775 },
  "92660": { lat: 33.6189, lng: -117.8730, city: "Newport Beach", state: "CA", taxRate: 0.0775 },
  "92618": { lat: 33.6595, lng: -117.7420, city: "Irvine", state: "CA", taxRate: 0.0775 },

  // --- NEW YORK METRO ---
  "10001": { lat: 40.7505, lng: -73.9934, city: "New York (Chelsea)", state: "NY", taxRate: 0.08875 },
  "10010": { lat: 40.7390, lng: -73.9840, city: "New York (Gramercy)", state: "NY", taxRate: 0.08875 },
  "10012": { lat: 40.7255, lng: -73.9980, city: "New York (SoHo)", state: "NY", taxRate: 0.08875 },
  "10019": { lat: 40.7690, lng: -73.9890, city: "New York (Midtown West)", state: "NY", taxRate: 0.08875 },
  "10021": { lat: 40.7690, lng: -73.9580, city: "New York (Upper East Side)", state: "NY", taxRate: 0.08875 },
  "10024": { lat: 40.7900, lng: -73.9740, city: "New York (Upper West Side)", state: "NY", taxRate: 0.08875 },
  "11201": { lat: 40.6950, lng: -73.9890, city: "Brooklyn (Heights/DUMBO)", state: "NY", taxRate: 0.08875 },
  "11232": { lat: 40.6580, lng: -74.0080, city: "Brooklyn (Industry City)", state: "NY", taxRate: 0.08875 },
  "11101": { lat: 40.7480, lng: -73.9390, city: "Long Island City", state: "NY", taxRate: 0.08875 },
  "07030": { lat: 40.7440, lng: -74.0320, city: "Hoboken", state: "NJ", taxRate: 0.06625 },
  "07302": { lat: 40.7180, lng: -74.0430, city: "Jersey City", state: "NJ", taxRate: 0.06625 },

  // --- TEXAS METROS ---
  "75201": { lat: 32.7880, lng: -96.7990, city: "Dallas (Downtown)", state: "TX", taxRate: 0.0825 },
  "75205": { lat: 32.8360, lng: -96.7990, city: "Dallas (Highland Park)", state: "TX", taxRate: 0.0825 },
  "75220": { lat: 32.8680, lng: -96.8620, city: "Dallas (Love Field)", state: "TX", taxRate: 0.0825 },
  "75229": { lat: 32.8950, lng: -96.8780, city: "Dallas (North Dallas)", state: "TX", taxRate: 0.0825 },
  "75001": { lat: 32.9610, lng: -96.8370, city: "Addison", state: "TX", taxRate: 0.0825 },
  "75024": { lat: 33.0780, lng: -96.8220, city: "Plano", state: "TX", taxRate: 0.0825 },
  "75034": { lat: 33.1500, lng: -96.8200, city: "Frisco", state: "TX", taxRate: 0.0825 },
  "77002": { lat: 29.7560, lng: -95.3680, city: "Houston (Downtown)", state: "TX", taxRate: 0.0825 },
  "77024": { lat: 29.7730, lng: -95.5250, city: "Houston (Memorial)", state: "TX", taxRate: 0.0825 },
  "78701": { lat: 30.2672, lng: -97.7431, city: "Austin (Downtown)", state: "TX", taxRate: 0.0825 },
  "78746": { lat: 30.2830, lng: -97.8090, city: "Austin (West Lake Hills)", state: "TX", taxRate: 0.0825 },

  // --- ILLINOIS / CHICAGO ---
  "60601": { lat: 41.8860, lng: -87.6220, city: "Chicago (Loop)", state: "IL", taxRate: 0.0875 },
  "60611": { lat: 41.8980, lng: -87.6230, city: "Chicago (Magnificent Mile)", state: "IL", taxRate: 0.0875 },
  "60614": { lat: 41.9220, lng: -87.6530, city: "Chicago (Lincoln Park)", state: "IL", taxRate: 0.0875 },
  "60091": { lat: 42.0810, lng: -87.7330, city: "Wilmette", state: "IL", taxRate: 0.0825 },

  // --- FLORIDA ---
  "33101": { lat: 25.7743, lng: -80.1937, city: "Miami (Downtown)", state: "FL", taxRate: 0.07 },
  "33139": { lat: 25.7780, lng: -80.1310, city: "Miami Beach", state: "FL", taxRate: 0.07 },
  "33131": { lat: 25.7650, lng: -80.1910, city: "Miami (Brickell)", state: "FL", taxRate: 0.07 },
  "32801": { lat: 28.5383, lng: -81.3792, city: "Orlando", state: "FL", taxRate: 0.065 },
  "33602": { lat: 27.9506, lng: -82.4572, city: "Tampa", state: "FL", taxRate: 0.075 },

  // --- MASSACHUSETTS / BOSTON ---
  "02108": { lat: 42.3588, lng: -71.0638, city: "Boston (Beacon Hill)", state: "MA", taxRate: 0.0625 },
  "02116": { lat: 42.3505, lng: -71.0760, city: "Boston (Back Bay)", state: "MA", taxRate: 0.0625 },
  "02138": { lat: 42.3736, lng: -71.1097, city: "Cambridge (Harvard Sq)", state: "MA", taxRate: 0.0625 },
  "02446": { lat: 42.3420, lng: -71.1210, city: "Brookline", state: "MA", taxRate: 0.0625 },

  // --- GEORGIA / ATLANTA ---
  "30301": { lat: 33.7490, lng: -84.3880, city: "Atlanta", state: "GA", taxRate: 0.089 },
  "30309": { lat: 33.7990, lng: -84.3880, city: "Atlanta (Midtown)", state: "GA", taxRate: 0.089 },
  "30326": { lat: 33.8500, lng: -84.3600, city: "Atlanta (Buckhead)", state: "GA", taxRate: 0.089 },

  // --- WASHINGTON / SEATTLE ---
  "98101": { lat: 47.6101, lng: -122.3340, city: "Seattle (Downtown)", state: "WA", taxRate: 0.1025 },
  "98109": { lat: 47.6280, lng: -122.3480, city: "Seattle (South Lake Union)", state: "WA", taxRate: 0.1025 },
  "98004": { lat: 47.6104, lng: -122.2007, city: "Bellevue", state: "WA", taxRate: 0.101 },

  // --- COLORADO / DENVER ---
  "80202": { lat: 39.7530, lng: -104.9980, city: "Denver (LoDo)", state: "CO", taxRate: 0.0881 },
  "80206": { lat: 39.7300, lng: -104.9500, city: "Denver (Cherry Creek)", state: "CO", taxRate: 0.0881 },
  "80302": { lat: 40.0150, lng: -105.2705, city: "Boulder", state: "CO", taxRate: 0.08845 },

  // --- ARIZONA / PHOENIX ---
  "85001": { lat: 33.4484, lng: -112.0740, city: "Phoenix", state: "AZ", taxRate: 0.086 },
  "85251": { lat: 33.4942, lng: -111.9261, city: "Scottsdale", state: "AZ", taxRate: 0.0805 }
};
