// Fixed fixture lists for the conversation identity filter. BLOCK: disguised ways of sharing who you are (split digits, number words,
// look-alike and emoji characters, "at gmail dot com", handles, platforms, links, names, ...): every one must be refused by the rules alone.
// PASS: ordinary deal talk (prices, VINs, stock numbers, APRs, dates, mileage): every one must go straight through with no AI check.
export const BLOCK: string[] = [
 // split digits
 "5 5 5 1 2 3 4","5.5.5.1.2.3.4","5-5-5-1-2-3-4","555 - 123 - 4567","(555)123-4567","555.123.4567","+1 555 123 4567","5551234567","555 123 4567","five five five one two three four","five five five 1 2 3 4",
 // number words
 "my number is five five five one two three four five six seven","double five one two three four","triple five two two two one","oh one oh two oh three four","nine one seven five five five oh one four seven","five.five.five","five-five-five","nine one one",
 // look-alike chars / emoji digits / fullwidth
 "５５５１２３４５６７８","5️⃣5️⃣5️⃣1️⃣2️⃣3️⃣4️⃣","𝟓𝟓𝟓𝟏𝟐𝟑𝟒","٥٥٥١٢٣٤٥٦٧٨","call me on ５５５-１２３４","jаne@gmail.com","jane＠gmail.com","ⓕⓐⓒⓔⓑⓞⓞⓚ","іnstagram","f​a​c​e​b​o​o​k",
 // spaced letters / emails
 "j a n e @ g m a i l . c o m","jane at gmail dot com","jane (at) gmail (dot) com","jane[at]gmail[dot]com","reach me at jane dot doe at yahoo dot com","my gmail is jane","jane @ g mail",
 // handles / platforms
 "@jane_doe","find me on instagram","dm me on X","my X handle is jd","add me on snap","I'm on Facebook","message me on Meta","follow me on twitter","whatsapp me","telegram","i n s t a g r a m","insta: janedoe",
 // links / files
 "facebook.com/jane","bit.ly/abc","www.example.com/me","https://evil.example/profile","![me](https://x.test/a.png)",
 // addresses / names
 "I live at 12 Main Street","ship it to 450 Oak Ave","my name is Jane","Hi, I'm John, interested in the RAV4","This is Maria speaking","Thanks,\nJohn Smith","Mr. Rivera will pick it up","ask for Dave when you arrive",
 // leet
 "555l2O4","5ive 5ive 5ive 1 2 3 4",
 // instructions
 "text me","call me","my cell is on the card",
 // more split digits / number words / look-alikes / handles
 "6 0 9 . 5 5 5 . 0 1 9 9","six oh nine five five five oh one nine nine","triple seven double one two","５５５.１２３.４５６７","ⓕⓐⓒⓔⓑⓞⓞⓚ.com/jane","t.w.i.t.t.e.r","w h a t s a p p","I am @ g m a i l",
];
export const PASS: string[] = [
 "Can you hold it until Friday?","The price is $44,000 out the door","Is the 2026 RAV4 VIN 2T36CRAVXTC39J403 still available?","Stock number S12345 please","Can you do 38,500 with the doc fee at 799?","I need 36 months at 5.9% APR","Down payment of $3,000 and 60 months","The doc fee is $799 and tax is $2,650",
 "It has 45,000 miles on it","Can we do the signing on 10/15/2026?","Pickup Saturday at 10:30 am works","ZIP 07030, the tax rate there is 6.625%","Is the 2024 F-150 stock #A48213 the XLT?","Can you take 1,500 off the price?","Is the nitrogen fill $400?","One hundred fifty dollars off would do it",
 "Please send two quotes, one with and one without nitrogen","I'm interested in the XLE","It's Friday so I can come Saturday","Thanks, that works","Best price you can do?","Do you have the Model X in stock?","Trade-in value of 9,000 and payoff of 4,250","Out the door at 52,310.45 total",
 "APR 4.9% for 72 months, 0 down","Mileage is 12,400 and the VIN ends in C39J403","The MSRP is $41,985 and the sticker adds $995","Can you do a 24 month lease at 12,000 miles a year?","Two weeks from now works","Option package 2 and trim 3 please","Let's do 5 or 6 percent off MSRP","We agreed on $38,900 plus tax and tags",
];
