import { Vehicle, DealerBid, UserProfile, TradeInVehicle } from "./types";

export const MOCK_VEHICLES: Vehicle[] = [
  {
    "id": "live-WA1EVBF10TD035390",
    "vin": "WA1EVBF10TD035390",
    "year": 2026,
    "make": "Audi",
    "model": "Q8",
    "trim": "New   Q8 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Satellite Silver Metallic",
    "interiorColor": "Black",
    "msrp": 83349.0,
    "dealerPrice": 83349.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q8-0079596cac184175bd038961d4a7f5b1.htm"
  },
  {
    "id": "live-WA1EVBF17TD035757",
    "vin": "WA1EVBF17TD035757",
    "year": 2026,
    "make": "Audi",
    "model": "Q8",
    "trim": "New   Q8 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black Metallic",
    "interiorColor": "Okapi Brown",
    "msrp": 83164.0,
    "dealerPrice": 83164.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q8-5c4fe86fac1802934a2c939fc5da4a49.htm"
  },
  {
    "id": "live-WA1EVBF13TD035707",
    "vin": "WA1EVBF13TD035707",
    "year": 2026,
    "make": "Audi",
    "model": "Q8",
    "trim": "New   Q8 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Waitomo Blue Metallic",
    "interiorColor": "Black",
    "msrp": 82779.0,
    "dealerPrice": 82779.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q8-60b575c7ac1847198987293d75c25075.htm"
  },
  {
    "id": "live-WA1BVBF18TD034670",
    "vin": "WA1BVBF18TD034670",
    "year": 2026,
    "make": "Audi",
    "model": "Q8",
    "trim": "New   Q8 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Samurai Gray Metallic",
    "interiorColor": "Black",
    "msrp": 80590.0,
    "dealerPrice": 80590.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q8-143713faac182d12aed28c66c6df26bc.htm"
  },
  {
    "id": "live-WA1MVBF72TD015710",
    "vin": "WA1MVBF72TD015710",
    "year": 2026,
    "make": "Audi",
    "model": "Q7",
    "trim": "New   Q7 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Waitomo Blue Metallic",
    "interiorColor": "Pando Gray",
    "msrp": 76172.0,
    "dealerPrice": 76172.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q7-60b5733fac183200ff501480255f75ad.htm"
  },
  {
    "id": "live-WA1MVBF71TD015052",
    "vin": "WA1MVBF71TD015052",
    "year": 2026,
    "make": "Audi",
    "model": "Q7",
    "trim": "New   Q7 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Daytona Gray Pearl Effect",
    "interiorColor": "Black",
    "msrp": 75089.0,
    "dealerPrice": 75089.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q7-14371680ac1827da357610e25b1afc9d.htm"
  },
  {
    "id": "live-WA1MVBF7XTD015308",
    "vin": "WA1MVBF7XTD015308",
    "year": 2026,
    "make": "Audi",
    "model": "Q7",
    "trim": "New   Q7 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Satellite Silver Metallic",
    "interiorColor": "Black",
    "msrp": 74419.0,
    "dealerPrice": 74419.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q7-f5be97b3ac183129742ac8165cd18075.htm"
  },
  {
    "id": "live-WAU35CFU8TN010788",
    "vin": "WAU35CFU8TN010788",
    "year": 2026,
    "make": "Audi",
    "model": "S5",
    "trim": "New   S5 Prestige",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black Metallic",
    "interiorColor": "Arras Red",
    "msrp": 73412.0,
    "dealerPrice": 73412.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-S5-b2288874ac1828a5426f66e1d51c1565.htm"
  },
  {
    "id": "live-WA1EVBF16TD011238",
    "vin": "WA1EVBF16TD011238",
    "year": 2026,
    "make": "Audi",
    "model": "Q8",
    "trim": "Shop Online & Buy   Q8 55 Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black",
    "interiorColor": "Black",
    "msrp": 73117.0,
    "dealerPrice": 73117.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2026-Audi-Q8-b9023ab2ac183b7cfe9e7d69f512a59a.htm"
  },
  {
    "id": "live-WAU25CFUXTN015387",
    "vin": "WAU25CFUXTN015387",
    "year": 2026,
    "make": "Audi",
    "model": "S5",
    "trim": "New   S5 Premium Plus",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Glacier White Metallic",
    "interiorColor": "Black",
    "msrp": 72358.0,
    "dealerPrice": 72358.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-S5-f51b705aac18162841248f686143c2e7.htm"
  },
  {
    "id": "live-WAU25CFU3TN032791",
    "vin": "WAU25CFU3TN032791",
    "year": 2026,
    "make": "Audi",
    "model": "S5",
    "trim": "New   S5 Premium Plus",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Grenadine Red Metallic",
    "interiorColor": "Black",
    "msrp": 70277.0,
    "dealerPrice": 70277.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-S5-090e3f30ac18518c6587a1f0d704c349.htm"
  },
  {
    "id": "live-WAU55CFN3TN049371",
    "vin": "WAU55CFN3TN049371",
    "year": 2026,
    "make": "Audi",
    "model": "A6",
    "trim": "New   A6 Premium Plus",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black Metallic",
    "interiorColor": "Black",
    "msrp": 70168.0,
    "dealerPrice": 70168.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-A6-aa36bc85ac1818bd061bbe1310509b97.htm"
  },
  {
    "id": "live-WA1AWBF17ND032288",
    "vin": "WA1AWBF17ND032288",
    "year": 2022,
    "make": "Audi",
    "model": "SQ8",
    "trim": "Shop Online & Buy   SQ8 4.0T Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black",
    "interiorColor": "Black",
    "msrp": 65787.0,
    "dealerPrice": 65787.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2022-Audi-SQ8-a5b2605bac180c97dc3ffb0c21caf817.htm"
  },
  {
    "id": "live-WAU55CFN4TN024141",
    "vin": "WAU55CFN4TN024141",
    "year": 2026,
    "make": "Audi",
    "model": "A6",
    "trim": "Shop Online & Buy   A6 Premium",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black",
    "interiorColor": "Black",
    "msrp": 61676.0,
    "dealerPrice": 61676.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2026-Audi-A6-700d9ebaac183586ac64e56a4d49c5c8.htm"
  },
  {
    "id": "live-WA12AAGU6T2036122",
    "vin": "WA12AAGU6T2036122",
    "year": 2026,
    "make": "Audi",
    "model": "Q5",
    "trim": "New   Q5 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black Metallic",
    "interiorColor": "Black",
    "msrp": 58407.0,
    "dealerPrice": 58407.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q5-97c25d55ac183e4956f34a83898df342.htm"
  },
  {
    "id": "live-WA12AAGU7T2036226",
    "vin": "WA12AAGU7T2036226",
    "year": 2026,
    "make": "Audi",
    "model": "Q5",
    "trim": "New   Q5 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Tambora Gray Metallic",
    "interiorColor": "Black",
    "msrp": 58407.0,
    "dealerPrice": 58407.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q5-97c25ff6ac181a3dcd6e49c35d8bcfd7.htm"
  },
  {
    "id": "live-WAULDAF82PN012794",
    "vin": "WAULDAF82PN012794",
    "year": 2023,
    "make": "Audi",
    "model": "A8",
    "trim": "Shop Online & Buy   A8 L 55",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Glacier White",
    "interiorColor": "Sarder Brown",
    "msrp": 57295.0,
    "dealerPrice": 57295.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-A8-84a6cd8cac18013719a6da348e823f4d.htm"
  },
  {
    "id": "live-WAU5ACFU8TN025313",
    "vin": "WAU5ACFU8TN025313",
    "year": 2026,
    "make": "Audi",
    "model": "A5",
    "trim": "New   A5 Premium Plus",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Firmament Blue Metallic",
    "interiorColor": "Black",
    "msrp": 55210.0,
    "dealerPrice": 55210.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-A5-510ffc3cac1849d2c697a70a066eee08.htm"
  },
  {
    "id": "live-WAUC4CF55RA079207",
    "vin": "WAUC4CF55RA079207",
    "year": 2024,
    "make": "Audi",
    "model": "S5",
    "trim": "Shop Online & Buy   S5 3.0T Premium",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Black Metallic",
    "interiorColor": "Red",
    "msrp": 54648.0,
    "dealerPrice": 54648.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2024-Audi-S5-005b5c98ac1829bdcb8ca5156b860d1c.htm"
  },
  {
    "id": "live-WA15AAFY3R2003718",
    "vin": "WA15AAFY3R2003718",
    "year": 2024,
    "make": "Audi",
    "model": "Q5 Sportback",
    "trim": "Shop Online & Buy   Q5 Sportback 45 S line Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Glacier White",
    "interiorColor": "Brown",
    "msrp": 42037.0,
    "dealerPrice": 42037.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2024-Audi-Q5-Sportback-963f6ab2ac18347aee8c697dd5ff62ae.htm"
  },
  {
    "id": "live-WA15AAFY5P2183605",
    "vin": "WA15AAFY5P2183605",
    "year": 2023,
    "make": "Audi",
    "model": "Q5 Sportback",
    "trim": "Shop Online & Buy   Q5 Sportback 45 S line Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Daytona Gray Pearl",
    "interiorColor": "Okapi Brown",
    "msrp": 36522.0,
    "dealerPrice": 36522.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-Q5-Sportback-b9e0c383ac1810ac5033d1c651a0cb82.htm"
  },
  {
    "id": "live-WA16AAFY8P2148612",
    "vin": "WA16AAFY8P2148612",
    "year": 2023,
    "make": "Audi",
    "model": "Q5 Sportback",
    "trim": "Shop Online & Buy   Q5 Sportback 45 S line Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black",
    "interiorColor": "Rock Gray",
    "msrp": 34883.0,
    "dealerPrice": 34883.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-Q5-Sportback-6ff89370ac184db46fa63ee495a1a8f5.htm"
  },
  {
    "id": "live-WAUEAAF43PN014360",
    "vin": "WAUEAAF43PN014360",
    "year": 2023,
    "make": "Audi",
    "model": "A4",
    "trim": "Shop Online & Buy   A4 45 S line Premium",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Glacier White",
    "interiorColor": "Black",
    "msrp": 33472.0,
    "dealerPrice": 33472.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-A4-99e7b5bcac1818bd061bbe13898507fe.htm"
  },
  {
    "id": "live-WAUE3BF27PN054648",
    "vin": "WAUE3BF27PN054648",
    "year": 2023,
    "make": "Audi",
    "model": "A6",
    "trim": "Shop Online & Buy   A6 45 Premium",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Gray Metallic",
    "interiorColor": "Black",
    "msrp": 33373.0,
    "dealerPrice": 33373.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bang & Olufsen\u00ae 3D Premium Sound System",
      "Ultra-HiFi Audio Verified",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bang & Olufsen\u00ae 3D Premium Sound System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-A6-07ac3a8cac1839c94c8d3a4ac1e63f34.htm"
  },
  {
    "id": "live-5YM33CS02T9232741",
    "vin": "5YM33CS02T9232741",
    "year": 2026,
    "make": "BMW",
    "model": "XM",
    "trim": "Certified   XM Label",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mineral White Metallic",
    "interiorColor": "Sakhir Orange/Black",
    "msrp": 149795.0,
    "dealerPrice": 149795.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "BMW of San Antonio",
      "city": "San Antonio",
      "state": "TX",
      "zip": "75201",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
      "Ultra-HiFi Audio Verified",
      "Dealership: BMW of San Antonio"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.bmwofsanantonio.com/certified/BMW/2026-BMW-XM-b01a2ee9ac18065879bcb5eb44a91053.htm"
  },
  {
    "id": "live-5YM13ET03T9410383",
    "vin": "5YM13ET03T9410383",
    "year": 2026,
    "make": "BMW",
    "model": "X5 M",
    "trim": "New   X5 M Competition",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mineral White Metallic",
    "interiorColor": "Taruma Brown Full Merino Leather",
    "msrp": 147725.0,
    "dealerPrice": 147725.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "BMW of San Antonio",
      "city": "San Antonio",
      "state": "TX",
      "zip": "75201",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
      "Ultra-HiFi Audio Verified",
      "Dealership: BMW of San Antonio"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.bmwofsanantonio.com/new/BMW/2026-BMW-X5-M-05946c47ac18107eb3503fd136d3714d.htm"
  },
  {
    "id": "live-WBS83GV06SCU55859",
    "vin": "WBS83GV06SCU55859",
    "year": 2025,
    "make": "BMW",
    "model": "M5",
    "trim": "Certified   M5",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Black Sapphire Metallic",
    "interiorColor": "Black",
    "msrp": 113590.0,
    "dealerPrice": 113590.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Fields BMW Winter Park",
      "city": "Winter Park",
      "state": "FL",
      "zip": "75201",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
      "Ultra-HiFi Audio Verified",
      "Dealership: Fields BMW Winter Park"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.fieldsbmworlando.com/certified/BMW/2025-BMW-M5-Orlando-For-Sale-ed75e01bac185c3035c89e23ac160574.htm"
  },
  {
    "id": "live-WBA53FJ00VCY60238",
    "vin": "WBA53FJ00VCY60238",
    "year": 2027,
    "make": "BMW",
    "model": "530i",
    "trim": "New   530i xDrive",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "AWD",
    "transmission": "Automatic",
    "exteriorColor": "Black Sapphire Metallic",
    "interiorColor": "Black",
    "msrp": 74450.0,
    "dealerPrice": 74450.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "BMW of Tenafly",
      "city": "Tenafly",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
      "Ultra-HiFi Audio Verified",
      "Dealership: BMW of Tenafly"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.bmwoftenafly.com/new/BMW/2027-BMW-530i-143bdea9ac1819229d5476fa66c8569f.htm"
  },
  {
    "id": "live-WBA53FJ05VCY48134",
    "vin": "WBA53FJ05VCY48134",
    "year": 2027,
    "make": "BMW",
    "model": "530i",
    "trim": "New   530i xDrive",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "AWD",
    "transmission": "Automatic",
    "exteriorColor": "Black Sapphire Metallic",
    "interiorColor": "Black",
    "msrp": 74275.0,
    "dealerPrice": 74275.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "BMW of Tenafly",
      "city": "Tenafly",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
      "Ultra-HiFi Audio Verified",
      "Dealership: BMW of Tenafly"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.bmwoftenafly.com/new/BMW/2027-BMW-530i-143badc8ac18424fa430750e370ec428.htm"
  },
  {
    "id": "live-WBA53FJ0XVCY31751",
    "vin": "WBA53FJ0XVCY31751",
    "year": 2027,
    "make": "BMW",
    "model": "530i",
    "trim": "New   530i xDrive",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "AWD",
    "transmission": "Automatic",
    "exteriorColor": "Tanzanite Blue II Metallic",
    "interiorColor": "Espresso Brown",
    "msrp": 72700.0,
    "dealerPrice": 72700.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "BMW of Tenafly",
      "city": "Tenafly",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
      "Ultra-HiFi Audio Verified",
      "Dealership: BMW of Tenafly"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Bowers & Wilkins\u00ae Diamond / Surround Sound (6F1)",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.bmwoftenafly.com/new/BMW/2027-BMW-530i-143b9d86ac1819229d5476fa5a97850d.htm"
  },
  {
    "id": "live-WU1ARBF13TD036352",
    "vin": "WU1ARBF13TD036352",
    "year": 2026,
    "make": "Audi",
    "model": "RS Q8",
    "trim": "New   RS Q8 Performance",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Glacier White Metallic",
    "interiorColor": "Black",
    "msrp": 160009.0,
    "dealerPrice": 160009.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-RS-Q8-5db4ed5eac1809e136d79eb22bf64082.htm"
  },
  {
    "id": "live-WA1CWBF17TD029011",
    "vin": "WA1CWBF17TD029011",
    "year": 2026,
    "make": "Audi",
    "model": "SQ8",
    "trim": "New   SQ8 Prestige",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black Metallic",
    "interiorColor": "Black",
    "msrp": 119217.0,
    "dealerPrice": 119217.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-SQ8-892b577dac18475961637c0479480ced.htm"
  },
  {
    "id": "live-WA1MVBF73TD013822",
    "vin": "WA1MVBF73TD013822",
    "year": 2026,
    "make": "Audi",
    "model": "Q7",
    "trim": "New   Q7 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Waitomo Blue Metallic",
    "interiorColor": "Pando Gray",
    "msrp": 75127.0,
    "dealerPrice": 75127.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q7-aa36bf29ac185770be9bb43222555e00.htm"
  },
  {
    "id": "live-WAU25CFU9TN022296",
    "vin": "WAU25CFU9TN022296",
    "year": 2026,
    "make": "Audi",
    "model": "S5",
    "trim": "New   S5 Premium Plus",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Glacier White Metallic",
    "interiorColor": "Black",
    "msrp": 70838.0,
    "dealerPrice": 70838.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-S5-17deb741ac182b40ac5f1a024d0d4235.htm"
  },
  {
    "id": "live-WA125AGU7T2046338",
    "vin": "WA125AGU7T2046338",
    "year": 2026,
    "make": "Audi",
    "model": "SQ5",
    "trim": "New   SQ5 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Ultra Blue Metallic",
    "interiorColor": "Black",
    "msrp": 70705.0,
    "dealerPrice": 70705.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-SQ5-b84be8a3ac1828bf091d8701621e4a7d.htm"
  },
  {
    "id": "live-WAU55CFN7TN050619",
    "vin": "WAU55CFN7TN050619",
    "year": 2026,
    "make": "Audi",
    "model": "A6",
    "trim": "New   A6 Premium Plus",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black Metallic",
    "interiorColor": "Muscat Brown",
    "msrp": 70168.0,
    "dealerPrice": 70168.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-A6-aa36ba06ac18152ec7ee597365fb5b48.htm"
  },
  {
    "id": "live-WA125AGU4T2027715",
    "vin": "WA125AGU4T2027715",
    "year": 2026,
    "make": "Audi",
    "model": "SQ5",
    "trim": "New   SQ5 Premium Plus",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Tambora Gray Metallic",
    "interiorColor": "Black",
    "msrp": 67765.0,
    "dealerPrice": 67765.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-SQ5-425af603ac18460841a55025d0b9ad71.htm"
  },
  {
    "id": "live-WA1ABCFJ0T1078626",
    "vin": "WA1ABCFJ0T1078626",
    "year": 2026,
    "make": "Audi",
    "model": "Q3",
    "trim": "New   Q3",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Arrow Gray Pearl Effect",
    "interiorColor": "Black",
    "msrp": 48366.0,
    "dealerPrice": 48366.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q3-ae81eb45ac180302593716fc54f15842.htm"
  },
  {
    "id": "live-WA1ABCFJ8T1093858",
    "vin": "WA1ABCFJ8T1093858",
    "year": 2026,
    "make": "Audi",
    "model": "Q3",
    "trim": "New   Q3 S Line",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Arrow Gray Pearl Effect",
    "interiorColor": "Black",
    "msrp": 48128.0,
    "dealerPrice": 48128.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q3-00795c36ac1855c3e43e5f2ba40bb028.htm"
  },
  {
    "id": "live-WA11AAGU0S2034232",
    "vin": "WA11AAGU0S2034232",
    "year": 2025,
    "make": "Audi",
    "model": "Q5",
    "trim": "Shop Online & Buy   Q5 2.0T Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Tambora Gray",
    "interiorColor": "Black",
    "msrp": 47171.0,
    "dealerPrice": 47171.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2025-Audi-Q5-d2020770ac18139d42132c36e434f7c1.htm"
  },
  {
    "id": "live-WA1B4AFY7R2002517",
    "vin": "WA1B4AFY7R2002517",
    "year": 2024,
    "make": "Audi",
    "model": "SQ5",
    "trim": "Shop Online & Buy   SQ5 3.0T Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Green",
    "interiorColor": "Black",
    "msrp": 46799.0,
    "dealerPrice": 46799.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2024-Audi-SQ5-51ceb81eac183497454cbb82589986a0.htm"
  },
  {
    "id": "live-WA1ABCFJ2T1097274",
    "vin": "WA1ABCFJ2T1097274",
    "year": 2026,
    "make": "Audi",
    "model": "Q3",
    "trim": "New   Q3",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Arkona White",
    "interiorColor": "Parchment Beige",
    "msrp": 46613.0,
    "dealerPrice": 46613.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.auditurnersville.com/new/Audi/2026-Audi-Q3-60b5772cac1814b5a599b79d25e74c08.htm"
  },
  {
    "id": "live-WA12AAGU0S2097464",
    "vin": "WA12AAGU0S2097464",
    "year": 2025,
    "make": "Audi",
    "model": "Q5",
    "trim": "Shop Online & Buy   Q5 2.0T Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Glacier White",
    "interiorColor": "Murillo Brown",
    "msrp": 46590.0,
    "dealerPrice": 46590.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2025-Audi-Q5-23fdc8f7ac183bfdace2606ec2f43653.htm"
  },
  {
    "id": "live-WA11AAGU9S2053085",
    "vin": "WA11AAGU9S2053085",
    "year": 2025,
    "make": "Audi",
    "model": "Q5",
    "trim": "Shop Online & Buy   Q5 2.0T Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Tambora Gray",
    "interiorColor": "Brown",
    "msrp": 46480.0,
    "dealerPrice": 46480.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2025-Audi-Q5-cb3a9cfaac183d5c47ce2979db084156.htm"
  },
  {
    "id": "live-WA11AAGU3S2081545",
    "vin": "WA11AAGU3S2081545",
    "year": 2025,
    "make": "Audi",
    "model": "Q5",
    "trim": "Shop Online & Buy   Q5 2.0T Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black",
    "interiorColor": "Murillo Brown",
    "msrp": 46076.0,
    "dealerPrice": 46076.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2025-Audi-Q5-d58ef211ac180c8409390766fce0f7a1.htm"
  },
  {
    "id": "live-WA1B4AFY4P2152498",
    "vin": "WA1B4AFY4P2152498",
    "year": 2023,
    "make": "Audi",
    "model": "SQ5",
    "trim": "Shop Online & Buy   SQ5 3.0T Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Daytona Gray Pearl",
    "interiorColor": "Black",
    "msrp": 44486.0,
    "dealerPrice": 44486.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-SQ5-93e582abac181ad191cd6ee4ba22d578.htm"
  },
  {
    "id": "live-WA1FAAFY8R2015027",
    "vin": "WA1FAAFY8R2015027",
    "year": 2024,
    "make": "Audi",
    "model": "Q5",
    "trim": "Shop Online & Buy   Q5 45 S line Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Chronos Gray Metallic",
    "interiorColor": "Black",
    "msrp": 42417.0,
    "dealerPrice": 42417.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2024-Audi-Q5-dbfe9919ac1829d834f74c6f04bbca4f.htm"
  },
  {
    "id": "live-WAUD3BF29RN004574",
    "vin": "WAUD3BF29RN004574",
    "year": 2024,
    "make": "Audi",
    "model": "A6",
    "trim": "Shop Online & Buy   A6 45 Premium",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Black Metallic",
    "interiorColor": "Black",
    "msrp": 36928.0,
    "dealerPrice": 36928.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2024-Audi-A6-b320dd0bac185a7cf19ec64105d7d737.htm"
  },
  {
    "id": "live-WA14AAFY6P2153718",
    "vin": "WA14AAFY6P2153718",
    "year": 2023,
    "make": "Audi",
    "model": "Q5 Sportback",
    "trim": "Shop Online & Buy   Q5 Sportback 45 S line Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Glacier White",
    "interiorColor": "Atlas Beige",
    "msrp": 35578.0,
    "dealerPrice": 35578.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-Q5-Sportback-431dae59ac1813cdd93b4713d5c74a59.htm"
  },
  {
    "id": "live-WAUD3BF29PN048751",
    "vin": "WAUD3BF29PN048751",
    "year": 2023,
    "make": "Audi",
    "model": "A6",
    "trim": "Shop Online & Buy   A6 45 Premium",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Black",
    "interiorColor": "Standard",
    "msrp": 33999.0,
    "dealerPrice": 33999.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "cpo",
    "location": {
      "dealerName": "Audi Turnersville",
      "city": "Turnersville",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Audi Turnersville"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-A6-005b599fac185c8404187ace053f31c9.htm"
  }
];

export const INITIAL_DEMO_BIDS: DealerBid[] = [];

export const SAMPLE_TRADE_IN_VEHICLE: TradeInVehicle = {
  hasTradeIn: true,
  year: 2022,
  make: "BMW",
  model: "3 Series",
  trim: "330i xDrive",
  mileage: 28450,
  vin: "WBA33AY08RF892110",
  condition: "excellent",
  estimatedValueMin: 30000,
  estimatedValueMax: 33000,
  photos: [],
};

export const DEMO_BUYER_USER: UserProfile = {
  id: "user-demo-1",
  name: "Paul",
  email: "paul@trimscout.io",
  role: "buyer",
  buyerAlias: "BayAreaBuyer_941",
  phone: "(415) 555-0188",
  zipCode: "94107",
  savedVehicleIds: ["live-WA1EVBF10TD035390", "live-WA1EVBF17TD035757"],
};
