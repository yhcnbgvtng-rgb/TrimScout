import { Vehicle, DealerBid, UserProfile, TradeInVehicle } from "./types";

export const MOCK_VEHICLES: Vehicle[] = [
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
    "id": "live-WA1GAAFY1P2132482",
    "vin": "WA1GAAFY1P2132482",
    "year": 2023,
    "make": "Audi",
    "model": "Q5",
    "trim": "Shop Online & Buy   Q5 45 S line Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Glacier White",
    "interiorColor": "Black",
    "msrp": 31434.0,
    "dealerPrice": 31434.0,
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
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-Q5-fee0552fac18376f832cfc06fa6aea62.htm"
  },
  {
    "id": "live-WAUGUDGY9RA034013",
    "vin": "WAUGUDGY9RA034013",
    "year": 2024,
    "make": "Audi",
    "model": "A3",
    "trim": "Shop Online & Buy   A3 40 Premium",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Mythos Black",
    "interiorColor": "Black/Rock Gray Stitching",
    "msrp": 30570.0,
    "dealerPrice": 30570.0,
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
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2024-Audi-A3-293dda35ac1819229d5476faee0a308b.htm"
  },
  {
    "id": "live-WAUGUDGY6PA072120",
    "vin": "WAUGUDGY6PA072120",
    "year": 2023,
    "make": "Audi",
    "model": "A3",
    "trim": "Shop Online & Buy   A3 40 Premium",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Navarra Blue",
    "interiorColor": "Black/Rock Gray Stitching",
    "msrp": 29210.0,
    "dealerPrice": 29210.0,
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
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2023-Audi-A3-5db9dfadac1813cdd93b471376687e6a.htm"
  },
  {
    "id": "live-WA1BBAFY6N2095188",
    "vin": "WA1BBAFY6N2095188",
    "year": 2022,
    "make": "Audi",
    "model": "Q5",
    "trim": "Shop Online & Buy   Q5 40 Premium",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Black Metallic",
    "interiorColor": "Atlas Beige",
    "msrp": 27933.0,
    "dealerPrice": 27933.0,
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
    "dealerUrl": "https://www.auditurnersville.com/certified/Audi/2022-Audi-Q5-48244fb2ac183b168f093f16fe6ee75b.htm"
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
    "id": "live-5YM23ET04T9371761",
    "vin": "5YM23ET04T9371761",
    "year": 2026,
    "make": "BMW",
    "model": "X6 M",
    "trim": "New   X6 M Competition",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Alpine White",
    "interiorColor": "Sakhir Orange/Black",
    "msrp": 146880.0,
    "dealerPrice": 146880.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Stevens Creek BMW",
      "city": "San Jose",
      "state": "CA",
      "zip": "90210",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Stevens Creek BMW"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.stevenscreekbmw.com/new/BMW/2026-BMW-X6-M-near-San-Jose-0a94f553ac182ad257728253179bb2b8.htm"
  },
  {
    "id": "live-WBS33HK08VCY13486",
    "vin": "WBS33HK08VCY13486",
    "year": 2027,
    "make": "BMW",
    "model": "M4",
    "trim": "All  New Inventory   M4 Competition xDrive",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "AWD",
    "transmission": "Automatic",
    "exteriorColor": "Brooklyn Grey Metallic",
    "interiorColor": "Black",
    "msrp": 125895.0,
    "dealerPrice": 125895.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
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
      "Audio: Standard Audio System",
      "Dealership: Fields BMW Winter Park"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.fieldsbmworlando.com/new/BMW/2027-BMW-M4-Orlando-For-Sale-2241706bac181a5d5d3a64b146728aad.htm"
  },
  {
    "id": "live-5YM13ET03S9X45643",
    "vin": "5YM13ET03S9X45643",
    "year": 2025,
    "make": "BMW",
    "model": "X5 M",
    "trim": "Certified   X5 M",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Black Sapphire Metallic",
    "interiorColor": "Sakhir Orange Black",
    "msrp": 120644.0,
    "dealerPrice": 120644.0,
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
      "Audio: Standard Audio System",
      "Dealership: Fields BMW Winter Park"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.fieldsbmworlando.com/certified/BMW/2025-BMW-X5-M-Orlando-For-Sale-f4a5a5e8ac185c3035c89e23f04f4368.htm"
  },
  {
    "id": "live-WBA33EH06TCW02889",
    "vin": "WBA33EH06TCW02889",
    "year": 2026,
    "make": "BMW",
    "model": "740i",
    "trim": "Used   740i xDrive",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "AWD",
    "transmission": "Automatic",
    "exteriorColor": "Black Sapphire Metallic",
    "interiorColor": "Tartufo",
    "msrp": 116255.0,
    "dealerPrice": 116255.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "used",
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
      "Audio: Standard Audio System",
      "Dealership: BMW of San Antonio"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.bmwofsanantonio.com/used/BMW/2026-BMW-740i-fc8fe371ac18490df7541314853f2d36.htm"
  },
  {
    "id": "live-5YM23ET02S9W70017",
    "vin": "5YM23ET02S9W70017",
    "year": 2025,
    "make": "BMW",
    "model": "X6 M",
    "trim": "Used   X6 M Base",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Brooklyn Grey Metallic",
    "interiorColor": "Black",
    "msrp": 113617.0,
    "dealerPrice": 113617.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "used",
    "location": {
      "dealerName": "BMW of Springfield",
      "city": "Springfield",
      "state": "NJ",
      "zip": "07054",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: BMW of Springfield"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 12500,
    "dealerUrl": "https://www.bmwofspringfield.com/used/BMW/2025-BMW-X6-M-9bb44516ac18347aee8c697dfeec411a.htm"
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
    "id": "live-WBADZ4C01TCW57853",
    "vin": "WBADZ4C01TCW57853",
    "year": 2026,
    "make": "BMW",
    "model": "840i",
    "trim": "New   840i xDrive",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "AWD",
    "transmission": "Automatic",
    "exteriorColor": "Mineral White Metallic",
    "interiorColor": "Tartufo/Black Extended Merino Leather",
    "msrp": 113000.0,
    "dealerPrice": 113000.0,
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
      "Audio: Standard Audio System",
      "Dealership: BMW of San Antonio"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.bmwofsanantonio.com/new/BMW/2026-BMW-840i-3af67431ac18191c4139ee0f1a01ec69.htm"
  },
  {
    "id": "live-WBAGV4C05TCX76028",
    "vin": "WBAGV4C05TCX76028",
    "year": 2026,
    "make": "BMW",
    "model": "840i",
    "trim": "New   840i xDrive",
    "bodyType": "Sedan",
    "engine": "Factory Spec",
    "drivetrain": "AWD",
    "transmission": "Automatic",
    "exteriorColor": "Dravit Grey Metallic",
    "interiorColor": "Black Extended Merino Leather",
    "msrp": 106735.0,
    "dealerPrice": 106735.0,
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
      "Audio: Standard Audio System",
      "Dealership: BMW of San Antonio"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.bmwofsanantonio.com/new/BMW/2026-BMW-840i-1c54c51bac181d0a4090da90e6afb059.htm"
  },
  {
    "id": "live-5UX23EM0XV9536673",
    "vin": "5UX23EM0XV9536673",
    "year": 2027,
    "make": "BMW",
    "model": "X7",
    "trim": "New   X7 xDrive40i",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "AWD",
    "transmission": "Automatic",
    "exteriorColor": "Carbon Black Metallic",
    "interiorColor": "Black",
    "msrp": 106445.0,
    "dealerPrice": 106445.0,
    "daysOnLot": 12,
    "status": "on_lot",
    "condition": "new",
    "location": {
      "dealerName": "Stevens Creek BMW",
      "city": "San Jose",
      "state": "CA",
      "zip": "90210",
      "distanceMiles": 15,
      "lat": 40.7128,
      "lng": -74.006
    },
    "packages": [
      "Audio: Standard Audio System",
      "Dealership: Stevens Creek BMW"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.stevenscreekbmw.com/new/BMW/2027-BMW-X7-near-San-Jose-0518ca7aac180fc2ce3670fe117d5687.htm"
  },
  {
    "id": "live-5UX33EU05T9339623",
    "vin": "5UX33EU05T9339623",
    "year": 2026,
    "make": "BMW",
    "model": "X5",
    "trim": "New   X5 M60i",
    "bodyType": "SUV",
    "engine": "Factory Spec",
    "drivetrain": "RWD",
    "transmission": "Automatic",
    "exteriorColor": "Alpine White",
    "interiorColor": "Black Sensafin",
    "msrp": 102275.0,
    "dealerPrice": 102275.0,
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
      "Audio: Standard Audio System",
      "Dealership: BMW of San Antonio"
    ],
    "options": [
      {
        "code": "AUDIO",
        "name": "Standard Audio System",
        "price": 0.0,
        "category": "package"
      }
    ],
    "imageUrl": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80",
    "mileage": 15,
    "dealerUrl": "https://www.bmwofsanantonio.com/new/BMW/2026-BMW-X5-c196993cac18503236358d39138bd482.htm"
  }
];

export const MOCK_POPULAR_PACKAGES = [
  { name: "Bowers & Wilkins Diamond Sound", count: 28, category: "Audio" },
  { name: "Burmester 3D / 4D High-End Sound", count: 32, category: "Audio" },
  { name: "Bang & Olufsen 3D Sound", count: 24, category: "Audio" },
  { name: "M Sport Package", count: 45, category: "Performance" },
  { name: "AMG Line Package", count: 38, category: "Performance" },
  { name: "Sport Chrono Package", count: 29, category: "Performance" },
  { name: "Front Axle Lift System", count: 18, category: "Performance" },
  { name: "Mark Levinson Reference Audio", count: 14, category: "Audio" },
  { name: "AKG Studio Reference 36-Spk", count: 12, category: "Audio" },
  { name: "Driving Assistance Professional", count: 52, category: "Tech" },
];

export const INITIAL_DEMO_BIDS: DealerBid[] = [
  {
    id: "bid-1",
    dealRequestId: "req-demo-1",
    dealerName: "BMW of San Rafael",
    dealerCity: "San Rafael",
    dealerState: "CA",
    distanceMiles: 14,
    matchedVin: "WBA33AY08RF892110",
    matchedVehicleTitle: "2026 BMW 330i M Sport",
    matchedVehicleSpec: 'Mineral Grey • Shadowline • Premium Pkg • 19" Wheels',
    matchedVehicleImageUrl: "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=800&q=80",
    vehicleStatus: "on_lot",
    msrp: 54200,
    dealerDiscountDollars: 4607,
    dealerDiscountPercent: 8.5,
    manufacturerRebates: 1000,
    sellingPrice: 48593,
    salesTax: 4191,
    dmvFees: 612,
    docFee: 85,
    dealerAccessories: 0,
    totalOtdPrice: 53481,
    notes: "Vehicle in stock on showroom floor. Verified $0 add-ons.",
    rank: 1,
    createdAt: "10m ago",
    isTopDeal: true,
    salesRep: {
      name: "Marcus Vance",
      title: "Sales Director",
      phone: "(415) 555-0199",
    },
  }
];

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
  avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80",
  savedVehicleIds: ["live-WU1ARBF13TD036352", "live-WA1CWBF17TD029011"],
  status: "active",
  createdAt: "2026-07-14",
  lastLogin: "10 mins ago",
  totalDealsCount: 3,
  activeBidsCount: 2,
};

export const DEMO_DEALER_USER: UserProfile = {
  id: "user-dealer-202",
  name: "Marcus Vance",
  email: "marcus.vance@bmwsanrafael.com",
  role: "dealer",
  phone: "(415) 555-0199",
  zipCode: "94901",
  dealerName: "BMW of San Rafael",
  dealerTitle: "General Sales Manager",
  avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80",
  savedVehicleIds: [],
  status: "active",
  createdAt: "2026-06-20",
  lastLogin: "Just now",
  totalDealsCount: 28,
  activeBidsCount: 5,
};

export const DEMO_ADMIN_USER: UserProfile = {
  id: "user-admin-001",
  name: "Master Administrator",
  email: "admin@trimscout.com",
  role: "admin",
  phone: "(800) 555-TRIM",
  zipCode: "94107",
  avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80",
  savedVehicleIds: [],
  status: "active",
  createdAt: "2026-01-01",
  lastLogin: "Active Now",
  notes: "Superuser Master Security Level 5",
};

export const INITIAL_ALL_ACCOUNTS: UserProfile[] = [
  DEMO_ADMIN_USER,
  DEMO_BUYER_USER,
  DEMO_DEALER_USER,
  {
    id: "user-buyer-102",
    name: "Samantha Chang",
    email: "samantha.c@gmail.com",
    role: "buyer",
    phone: "(510) 555-3341",
    zipCode: "94611",
    buyerAlias: "Buyer #CA-8832",
    avatarUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80",
    savedVehicleIds: ["live-WA1EVBF10TD035390"],
    status: "active",
    createdAt: "2026-08-01",
    lastLogin: "2 hours ago",
    totalDealsCount: 1,
    activeBidsCount: 3,
  }
];
