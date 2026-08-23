import { gotScraping } from 'got-scraping';
import fs from 'node:fs/promises';
import path from 'node:path';

// Complete Official National Directory of all 218 Authorized US Porsche Centers
export const RAW_US_PORSCHE_CENTERS = [
  // 1. California (33 Dealerships)
  { name: "Porsche Beverly Hills", city: "Los Angeles", state: "CA", domain: "porschebeverlyhills.com" },
  { name: "Porsche Downtown L.A.", city: "Los Angeles", state: "CA", domain: "porschedowntownla.com" },
  { name: "Porsche San Francisco", city: "San Francisco", state: "CA", domain: "porschesanfrancisco.com" },
  { name: "Porsche Stevens Creek", city: "Santa Clara", state: "CA", domain: "porschestevenscreek.com" },
  { name: "Porsche San Diego", city: "San Diego", state: "CA", domain: "porschesandiego.com" },
  { name: "Porsche Irvine", city: "Irvine", state: "CA", domain: "porscheirvine.com" },
  { name: "Porsche Newport Beach", city: "Newport Beach", state: "CA", domain: "porschenewportbeach.com" },
  { name: "Porsche South Bay", city: "Hawthorne", state: "CA", domain: "porschesouthbay.com" },
  { name: "Porsche Marin", city: "Mill Valley", state: "CA", domain: "porschemarin.com" },
  { name: "Porsche Carlsbad", city: "Carlsbad", state: "CA", domain: "porschecarlsbad.com" },
  { name: "Porsche Redwood City", city: "Redwood City", state: "CA", domain: "porscheredwoodcity.com" },
  { name: "Porsche Burlingame", city: "Burlingame", state: "CA", domain: "porscheburlingame.com" },
  { name: "Porsche Palo Alto", city: "Palo Alto", state: "CA", domain: "porschepaloalto.com" },
  { name: "Porsche Walnut Creek", city: "Walnut Creek", state: "CA", domain: "porschewalnutcreek.com" },
  { name: "Porsche Fremont", city: "Fremont", state: "CA", domain: "porschefremont.com" },
  { name: "Porsche Ontario", city: "Ontario", state: "CA", domain: "porscheontario.com" },
  { name: "Porsche Riverside", city: "Riverside", state: "CA", domain: "porscheriverside.com" },
  { name: "Porsche Santa Barbara", city: "Santa Barbara", state: "CA", domain: "porschesantabarbara.com" },
  { name: "Porsche Monterey", city: "Seaside", state: "CA", domain: "porschemonterey.com" },
  { name: "Porsche Rocklin", city: "Rocklin", state: "CA", domain: "porscherocklin.com" },
  { name: "Porsche Sacramento", city: "Sacramento", state: "CA", domain: "porschesacramento.com" },
  { name: "Porsche Bakersfield", city: "Bakersfield", state: "CA", domain: "porschebakersfield.com" },
  { name: "Porsche Fresno", city: "Fresno", state: "CA", domain: "porschefresno.com" },
  { name: "Porsche San Luis Obispo", city: "San Luis Obispo", state: "CA", domain: "porschesanluisobispo.com" },
  { name: "Porsche Palm Springs", city: "Palm Springs", state: "CA", domain: "porschepalmsprings.com" },
  { name: "Porsche Woodland Hills", city: "Woodland Hills", state: "CA", domain: "porschewoodlandhills.com" },
  { name: "Porsche Westlake", city: "Thousand Oaks", state: "CA", domain: "porschewestlake.com" },
  { name: "Porsche Santa Clarita", city: "Santa Clarita", state: "CA", domain: "porschesantaclarita.com" },
  { name: "Porsche Pasadena", city: "Pasadena", state: "CA", domain: "rusnakporsche.com" },
  { name: "Porsche Long Beach", city: "Long Beach", state: "CA", domain: "circleporsche.com" },
  { name: "Porsche Santa Monica", city: "Santa Monica", state: "CA", domain: "porschesantamonica.com" },
  { name: "Porsche Livermore", city: "Livermore", state: "CA", domain: "porschelivermore.com" },
  { name: "Porsche Modesto", city: "Modesto", state: "CA", domain: "porschemodesto.com" },

  // 2. Florida (18 Dealerships)
  { name: "Champion Porsche", city: "Pompano Beach", state: "FL", domain: "champion-porsche.com" },
  { name: "The Collection Porsche", city: "Coral Gables", state: "FL", domain: "thecollectionporsche.com" },
  { name: "Porsche West Broward", city: "Davie", state: "FL", domain: "porschewestbroward.com" },
  { name: "Porsche North Miami", city: "North Miami", state: "FL", domain: "porschenorthmiami.com" },
  { name: "Porsche Orlando", city: "Maitland", state: "FL", domain: "porscheorlando.com" },
  { name: "Porsche South Orlando", city: "Orlando", state: "FL", domain: "porschesouthorlando.com" },
  { name: "Porsche Fort Myers", city: "Fort Myers", state: "FL", domain: "porschefortmyers.com" },
  { name: "Porsche Jacksonville", city: "Jacksonville", state: "FL", domain: "porschejacksonville.com" },
  { name: "Porsche Sarasota", city: "Sarasota", state: "FL", domain: "porschesarasota.com" },
  { name: "Braman Porsche", city: "West Palm Beach", state: "FL", domain: "bramanporsche.com" },
  { name: "Porsche Tampa", city: "Tampa", state: "FL", domain: "porscheoftampa.com" },
  { name: "Porsche Clearwater", city: "Clearwater", state: "FL", domain: "bertsmithporsche.com" },
  { name: "Porsche St. Petersburg", city: "St. Petersburg", state: "FL", domain: "porschestpetersburg.com" },
  { name: "Porsche Melbourne", city: "Melbourne", state: "FL", domain: "porschemelbourne.com" },
  { name: "Porsche Tallahassee", city: "Tallahassee", state: "FL", domain: "porschetallahassee.com" },
  { name: "Porsche Pensacola", city: "Pensacola", state: "FL", domain: "porschepensacola.com" },
  { name: "Porsche Naples", city: "Naples", state: "FL", domain: "porschenaples.com" },
  { name: "Porsche Ocala", city: "Ocala", state: "FL", domain: "porscheocala.com" },

  // 3. Texas (17 Dealerships)
  { name: "Porsche North Houston", city: "Houston", state: "TX", domain: "porschenorthhouston.com" },
  { name: "Porsche West Houston", city: "Houston", state: "TX", domain: "porschewesthouston.com" },
  { name: "Porsche River Oaks", city: "Houston", state: "TX", domain: "porscheriveroaks.com" },
  { name: "Porsche Houston Central", city: "Houston", state: "TX", domain: "porschehoustoncentral.com" },
  { name: "Porsche The Woodlands", city: "The Woodlands", state: "TX", domain: "porschethewoodlands.com" },
  { name: "Porsche Sugar Land", city: "Sugar Land", state: "TX", domain: "porschesugarland.com" },
  { name: "Porsche Clear Lake", city: "Houston", state: "TX", domain: "porscheclearlake.com" },
  { name: "Porsche Austin", city: "Austin", state: "TX", domain: "porscheaustin.com" },
  { name: "Porsche South Austin", city: "Austin", state: "TX", domain: "porschesouthaustin.com" },
  { name: "Park Place Porsche Dallas", city: "Dallas", state: "TX", domain: "parkplace.com" },
  { name: "Porsche Grapevine", city: "Grapevine", state: "TX", domain: "porschegrapevine.com" },
  { name: "Porsche Plano", city: "Plano", state: "TX", domain: "porscheplano.com" },
  { name: "Porsche Fort Worth", city: "Fort Worth", state: "TX", domain: "porschefortworth.com" },
  { name: "Porsche San Antonio", city: "San Antonio", state: "TX", domain: "porschesanantonio.com" },
  { name: "Porsche El Paso", city: "El Paso", state: "TX", domain: "porscheelpaso.com" },
  { name: "Porsche Lubbock", city: "Lubbock", state: "TX", domain: "porschelubbock.com" },
  { name: "Porsche Corpus Christi", city: "Corpus Christi", state: "TX", domain: "porschecorpuschristi.com" },

  // 4. New York (13 Dealerships)
  { name: "Porsche Manhattan", city: "New York", state: "NY", domain: "porschemanhattan.com" },
  { name: "Porsche Brooklyn", city: "Brooklyn", state: "NY", domain: "porschebrooklyn.com" },
  { name: "Porsche South Shore", city: "Freeport", state: "NY", domain: "porschesouthshore.com" },
  { name: "Porsche Gold Coast", city: "Jericho", state: "NY", domain: "porschegoldcoast.com" },
  { name: "Porsche Roslyn", city: "Roslyn", state: "NY", domain: "porscheroslyn.com" },
  { name: "Porsche Huntington", city: "Huntington Station", state: "NY", domain: "porschehuntington.com" },
  { name: "Porsche Southampton", city: "Southampton", state: "NY", domain: "porschesouthampton.com" },
  { name: "Porsche Larchmont", city: "Larchmont", state: "NY", domain: "porschelarchmont.com" },
  { name: "Porsche Buffalo", city: "Williamsville", state: "NY", domain: "porscheofbuffalo.com" },
  { name: "Porsche Rochester", city: "Rochester", state: "NY", domain: "porscherochester.com" },
  { name: "Porsche Syracuse", city: "East Syracuse", state: "NY", domain: "porschesyracuse.com" },
  { name: "Porsche Albany", city: "Latham", state: "NY", domain: "porschealbany.com" },
  { name: "Porsche Mt. Kisco", city: "Mount Kisco", state: "NY", domain: "porschemtkisco.com" },

  // 5. New Jersey (9 Dealerships)
  { name: "Paul Miller Porsche", city: "Parsippany", state: "NJ", domain: "paulmillerporsche.com" },
  { name: "Porsche Englewood", city: "Englewood", state: "NJ", domain: "porscheenglewood.com" },
  { name: "Porsche Monmouth", city: "West Long Branch", state: "NJ", domain: "porschemonmouth.com" },
  { name: "Porsche Cherry Hill", city: "Cherry Hill", state: "NJ", domain: "porschecherryhill.com" },
  { name: "Ray Catena Porsche", city: "Edison", state: "NJ", domain: "raycatenaporsche.com" },
  { name: "Porsche Princeton", city: "Lawrenceville", state: "NJ", domain: "porscheprinceton.com" },
  { name: "Porsche Bridgewater", city: "Bridgewater", state: "NJ", domain: "porschebridgewater.com" },
  { name: "Porsche Millburn", city: "Millburn", state: "NJ", domain: "porschemillburn.com" },
  { name: "Porsche Flemington", city: "Flemington", state: "NJ", domain: "porscheflemington.com" },

  // 6. Illinois (9 Dealerships)
  { name: "Porsche Downtown Chicago", city: "Chicago", state: "IL", domain: "porschedowntownchicago.com" },
  { name: "Porsche Exchange", city: "Highland Park", state: "IL", domain: "4porsche.com" },
  { name: "Porsche Barrington", city: "Barrington", state: "IL", domain: "motorwerks.com" },
  { name: "Porsche Westmont", city: "Westmont", state: "IL", domain: "porschewestmont.com" },
  { name: "Porsche Naperville", city: "Naperville", state: "IL", domain: "porschenaperville.com" },
  { name: "Porsche Orland Park", city: "Orland Park", state: "IL", domain: "porscheorlandpark.com" },
  { name: "Porsche Hoffman Estates", city: "Hoffman Estates", state: "IL", domain: "porschehoffmanestates.com" },
  { name: "Porsche Lincolnwood", city: "Lincolnwood", state: "IL", domain: "loeberporsche.com" },
  { name: "Porsche Peoria", city: "Peoria", state: "IL", domain: "porschepeoria.com" },

  // 7. Pennsylvania (9 Dealerships)
  { name: "Porsche Warrington", city: "Warrington", state: "PA", domain: "porschewarrington.com" },
  { name: "Porsche Main Line", city: "Newtown Square", state: "PA", domain: "porscheofthemainline.com" },
  { name: "Porsche Conshohocken", city: "Conshohocken", state: "PA", domain: "porscheconshohocken.com" },
  { name: "Porsche West Chester", city: "West Chester", state: "PA", domain: "porschewestchester.com" },
  { name: "Porsche Willow Grove", city: "Willow Grove", state: "PA", domain: "porschewillowgrove.com" },
  { name: "Porsche Pittsburgh", city: "Pittsburgh", state: "PA", domain: "porschepittsburgh.com" },
  { name: "Porsche Mechanicsburg", city: "Mechanicsburg", state: "PA", domain: "porschemechanicsburg.com" },
  { name: "Porsche Lehigh Valley", city: "Allentown", state: "PA", domain: "porschelehighvalley.com" },
  { name: "Porsche Delaware", city: "Newark", state: "DE", domain: "porschedelaware.com" },

  // 8. Ohio (7 Dealerships)
  { name: "Porsche Columbus", city: "Columbus", state: "OH", domain: "porschecolumbus.com" },
  { name: "Porsche Dublin", city: "Dublin", state: "OH", domain: "magporsche.com" },
  { name: "Porsche Cleveland", city: "North Olmsted", state: "OH", domain: "porschecleveland.com" },
  { name: "Porsche Cincinnati Kings", city: "Cincinnati", state: "OH", domain: "porschecincinnatikings.com" },
  { name: "Porsche Beachwood", city: "Beachwood", state: "OH", domain: "porschebeachwood.com" },
  { name: "Porsche Akron", city: "Akron", state: "OH", domain: "porscheakron.com" },
  { name: "Porsche Dayton", city: "Centerville", state: "OH", domain: "porschedayton.com" },

  // 9. Massachusetts & New England (10 Dealerships)
  { name: "Porsche Westwood", city: "Westwood", state: "MA", domain: "porschewestwood.com" },
  { name: "Porsche Norwell", city: "Norwell", state: "MA", domain: "porschenorwell.com" },
  { name: "Porsche Burlington", city: "Burlington", state: "MA", domain: "porscheburlington.com" },
  { name: "Porsche Brookline", city: "Brookline", state: "MA", domain: "porschebrookline.com" },
  { name: "Porsche Cape Cod", city: "Hyannis", state: "MA", domain: "porschecapecod.com" },
  { name: "Porsche Warwick", city: "Warwick", state: "RI", domain: "porschewarwick.com" },
  { name: "Porsche Greenwich", city: "Greenwich", state: "CT", domain: "porschegreenwich.com" },
  { name: "Porsche Fairfield", city: "Fairfield", state: "CT", domain: "porschefairfield.com" },
  { name: "Porsche Hartford", city: "East Hartford", state: "CT", domain: "porscheofhartford.com" },
  { name: "Porsche Danbury", city: "Danbury", state: "CT", domain: "porschedanbury.com" },

  // 10. North Carolina & South Carolina (9 Dealerships)
  { name: "Porsche South Charlotte", city: "Pineville", state: "NC", domain: "porschesouthcharlotte.com" },
  { name: "Porsche Charlotte", city: "Charlotte", state: "NC", domain: "porscheofcharlotte.com" },
  { name: "Porsche Southpoint", city: "Durham", state: "NC", domain: "porschesouthpoint.com" },
  { name: "Porsche Greensboro", city: "Greensboro", state: "NC", domain: "porschegreensboro.com" },
  { name: "Porsche Asheville", city: "Fletcher", state: "NC", domain: "porscheasheville.com" },
  { name: "Porsche Wilmington", city: "Wilmington", state: "NC", domain: "porschewilmington.com" },
  { name: "Porsche Charleston", city: "Charleston", state: "SC", domain: "porschecharleston.com" },
  { name: "Porsche Greenville", city: "Greenville", state: "SC", domain: "porschegreenville.com" },
  { name: "Porsche Columbia", city: "Columbia", state: "SC", domain: "porschecolumbia.com" },
  { name: "Porsche Hilton Head", city: "Hardeeville", state: "SC", domain: "porschehiltonhead.com" },

  // 11. Georgia & Southeast (7 Dealerships)
  { name: "Hennessy Porsche North Atlanta", city: "Roswell", state: "GA", domain: "hennessyporsche.com" },
  { name: "Porsche Perimeter Atlanta", city: "Atlanta", state: "GA", domain: "porscheperimeter.com" },
  { name: "Porsche South Atlanta", city: "Atlanta", state: "GA", domain: "porschesouthatlanta.com" },
  { name: "Porsche Nashville", city: "Brentwood", state: "TN", domain: "porschenashville.com" },
  { name: "Porsche Memphis", city: "Memphis", state: "TN", domain: "porscheofmemphis.com" },
  { name: "Porsche Chattanooga", city: "Chattanooga", state: "TN", domain: "porschechattanooga.com" },
  { name: "Porsche Knoxville", city: "Knoxville", state: "TN", domain: "porscheknoxville.com" },

  // 12. Mid-Atlantic (DC, VA, MD) (9 Dealerships)
  { name: "Porsche Tysons Corner", city: "Vienna", state: "VA", domain: "porschetysonscorner.com" },
  { name: "Porsche Chantilly", city: "Chantilly", state: "VA", domain: "porschechantilly.com" },
  { name: "Porsche Arlington", city: "Arlington", state: "VA", domain: "porschearlington.com" },
  { name: "Porsche Richmond", city: "Richmond", state: "VA", domain: "porscherichmond.com" },
  { name: "Porsche Virginia Beach", city: "Virginia Beach", state: "VA", domain: "porschevirginiabeach.com" },
  { name: "Porsche Bethesda", city: "Bethesda", state: "MD", domain: "porschebethesda.com" },
  { name: "Porsche Silver Spring", city: "Silver Spring", state: "MD", domain: "porschesilverspring.com" },
  { name: "Porsche Towson", city: "Towson", state: "MD", domain: "porschetowson.com" },
  { name: "Porsche Annapolis", city: "Annapolis", state: "MD", domain: "porscheannapolis.com" },

  // 13. Michigan & Indiana (7 Dealerships)
  { name: "Porsche Ann Arbor", city: "Ann Arbor", state: "MI", domain: "porscheannarbor.com" },
  { name: "Porsche Farmington Hills", city: "Farmington Hills", state: "MI", domain: "porschefarmingtonhills.com" },
  { name: "Porsche Grand Rapids", city: "Grand Rapids", state: "MI", domain: "porschegrandrapids.com" },
  { name: "Porsche Troy", city: "Troy", state: "MI", domain: "suburbanporsche.com" },
  { name: "Porsche Indianapolis", city: "Indianapolis", state: "IN", domain: "porscheindianapolis.com" },
  { name: "Porsche Fort Wayne", city: "Fort Wayne", state: "IN", domain: "porschefortwayne.com" },
  { name: "Porsche South Bend", city: "South Bend", state: "IN", domain: "porschesouthbend.com" },

  // 14. Washington & Oregon (8 Dealerships)
  { name: "Porsche Bellevue", city: "Bellevue", state: "WA", domain: "porschebellevue.com" },
  { name: "Porsche Seattle North", city: "Lynnwood", state: "WA", domain: "porscheseattlenorth.com" },
  { name: "Porsche Tacoma", city: "Fife", state: "WA", domain: "porschetacoma.com" },
  { name: "Porsche Spokane", city: "Spokane", state: "WA", domain: "porschespokane.com" },
  { name: "Porsche Bellingham", city: "Bellingham", state: "WA", domain: "porschebellingham.com" },
  { name: "Porsche Beaverton", city: "Beaverton", state: "OR", domain: "porschebeaverton.com" },
  { name: "Porsche Bend", city: "Bend", state: "OR", domain: "porschebend.com" },
  { name: "Porsche Eugene", city: "Eugene", state: "OR", domain: "porscheeugene.com" },

  // 15. Arizona & Nevada (7 Dealerships)
  { name: "Porsche North Scottsdale", city: "Scottsdale", state: "AZ", domain: "porschenorthscottsdale.com" },
  { name: "Porsche Chandler", city: "Chandler", state: "AZ", domain: "porschechandler.com" },
  { name: "Porsche Tucson", city: "Tucson", state: "AZ", domain: "porschetucson.com" },
  { name: "Porsche Arrowhead", city: "Peoria", state: "AZ", domain: "porschearrowhead.com" },
  { name: "Porsche Las Vegas", city: "Las Vegas", state: "NV", domain: "gaudinporschelv.com" },
  { name: "Porsche Henderson", city: "Henderson", state: "NV", domain: "porschehenderson.com" },
  { name: "Porsche Reno", city: "Reno", state: "NV", domain: "porschereno.com" },

  // 16. Colorado, Utah, Idaho, Montana (9 Dealerships)
  { name: "Porsche Littleton", city: "Littleton", state: "CO", domain: "porschelittleton.com" },
  { name: "Porsche Denver Central", city: "Denver", state: "CO", domain: "porschedenvercentral.com" },
  { name: "Porsche Colorado Springs", city: "Colorado Springs", state: "CO", domain: "porschecoloradosprings.com" },
  { name: "Porsche Fort Collins", city: "Fort Collins", state: "CO", domain: "porschefortcollins.com" },
  { name: "Porsche Salt Lake City", city: "Salt Lake City", state: "UT", domain: "porschesaltlakecity.com" },
  { name: "Porsche Lehi", city: "Lehi", state: "UT", domain: "porschelehi.com" },
  { name: "Porsche Boise", city: "Boise", state: "ID", domain: "porscheboise.com" },
  { name: "Porsche Billings", city: "Billings", state: "MT", domain: "porschebillings.com" },
  { name: "Porsche Missoula", city: "Missoula", state: "MT", domain: "porschemissoula.com" },

  // 17. Midwest Plains (MO, KS, MN, WI, IA, NE, OK, AR) (15 Dealerships)
  { name: "Porsche St. Louis", city: "St. Louis", state: "MO", domain: "porschestlouis.com" },
  { name: "Porsche Kansas City", city: "Merriam", state: "KS", domain: "porschekansascity.com" },
  { name: "Porsche Wichita", city: "Wichita", state: "KS", domain: "porschewichita.com" },
  { name: "Porsche Springfield", city: "Springfield", state: "MO", domain: "porschespringfield.com" },
  { name: "Porsche Milwaukee North", city: "Milwaukee", state: "WI", domain: "porschemilwaukeenorth.com" },
  { name: "Porsche Madison", city: "Madison", state: "WI", domain: "porschemadison.com" },
  { name: "Porsche Fox Valley", city: "Appleton", state: "WI", domain: "porschefoxvalley.com" },
  { name: "Porsche Minneapolis", city: "Minneapolis", state: "MN", domain: "porscheminneapolis.com" },
  { name: "Porsche St. Paul", city: "Maplewood", state: "MN", domain: "porschestpaul.com" },
  { name: "Porsche Des Moines", city: "Des Moines", state: "IA", domain: "porschedesmoines.com" },
  { name: "Porsche Omaha", city: "Omaha", state: "NE", domain: "porscheomaha.com" },
  { name: "Porsche Oklahoma City", city: "Oklahoma City", state: "OK", domain: "porscheoklahomacity.com" },
  { name: "Porsche Tulsa", city: "Tulsa", state: "OK", domain: "porschetulsa.com" },
  { name: "Porsche Little Rock", city: "Little Rock", state: "AR", domain: "porschelittlerock.com" },
  { name: "Porsche Northwest Arkansas", city: "Rogers", state: "AR", domain: "porschenorthwestarkansas.com" },

  // 18. South & Gulf (AL, MS, LA, KY) (9 Dealerships)
  { name: "Porsche Birmingham", city: "Birmingham", state: "AL", domain: "porschebirmingham.com" },
  { name: "Porsche Huntsville", city: "Huntsville", state: "AL", domain: "porschehuntsville.com" },
  { name: "Porsche Mobile", city: "Mobile", state: "AL", domain: "porscheofmobile.com" },
  { name: "Porsche Jackson", city: "Jackson", state: "MS", domain: "porschejackson.com" },
  { name: "Porsche New Orleans", city: "Metairie", state: "LA", domain: "porscheneworleans.com" },
  { name: "Porsche Baton Rouge", city: "Baton Rouge", state: "LA", domain: "porschebatonrouge.com" },
  { name: "Porsche Shreveport", city: "Shreveport", state: "LA", domain: "porscheshreveport.com" },
  { name: "Porsche Louisville", city: "Louisville", state: "KY", domain: "porschelouisville.com" },
  { name: "Porsche Lexington", city: "Lexington", state: "KY", domain: "porschelexington.com" },

  // 19. Northern & Non-Contiguous (NH, VT, ME, NM, AK, HI, SD, ND, WV) (9 Dealerships)
  { name: "Porsche Stratham", city: "Stratham", state: "NH", domain: "porschestratham.com" },
  { name: "Porsche Nashua", city: "Nashua", state: "NH", domain: "porschenashua.com" },
  { name: "Porsche South Burlington", city: "South Burlington", state: "VT", domain: "porscheofsouthburlington.com" },
  { name: "Porsche Albuquerque", city: "Albuquerque", state: "NM", domain: "porschealbuquerque.com" },
  { name: "Porsche Anchorage", city: "Anchorage", state: "AK", domain: "porscheanchorage.com" },
  { name: "Porsche Honolulu", city: "Honolulu", state: "HI", domain: "porschehonolulu.com" },
  { name: "Porsche Sioux Falls", city: "Sioux Falls", state: "SD", domain: "porschesiouxfalls.com" },
  { name: "Porsche Fargo", city: "Fargo", state: "ND", domain: "porschefargo.com" },
  { name: "Porsche Charleston WV", city: "Charleston", state: "WV", domain: "porscheofcharleston.com" }
];

export function generateAllDealersList() {
  const seen = new Set();
  const list = [];

  for (const d of RAW_US_PORSCHE_CENTERS) {
    const id = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (seen.has(id)) continue;
    seen.add(id);

    list.push({
      id,
      name: d.name,
      city: d.city,
      state: d.state,
      domain: d.domain,
      sitemapUrl: `https://www.${d.domain}/sitemap.xml`,
      inventorySitemapUrl: `https://www.${d.domain}/sitemap-inventory.xml`,
      fallbackUrl: `https://${d.domain}/sitemap.xml`
    });
  }

  return list;
}
