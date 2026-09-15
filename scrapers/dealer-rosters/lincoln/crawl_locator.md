Lincoln roster source (2026-09-15): lincoln.com/dealerships/ calls `/cxservices/dealer/Dealers.json?make=Lincoln&radius=&maxDealers=&postalCode=`
which needs a registered `application-id` header the page mints at runtime (curl and even in-page fetch get 401),
so the roster was pulled in the Browser pane through the page's own service object:

  FD.Brand.NgpServices.dealers({make:'Lincoln', radius:150, filter:'', minDealers:1, maxDealers:100, postalCode:ZIP})

Caps: radius <= 500 mi, maxDealers <= 100. ~130 spread ZIPs at 150 mi (then 64 at 400 mi) converged at 403 rooftops.
Fields kept: PACode, SalesCode, Name, Address, Phone, Email (store lead inbox; 273/403 have one), URL, lat/lng,
LocationType (P = primary; the one SVO service-only site was dropped).
