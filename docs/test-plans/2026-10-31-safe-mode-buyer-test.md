# SAFE MODE buyer test: 2026-10-31

One test buyer account, one test dealer, website only. Covers #638, #639, #640, #641, #642, #643, #653, #655, #658.

## Ground rules
- **Every email goes to pausmi@outlook.com**, subject tagged `[SAFE MODE ...]`. No real dealer is emailed. Check that inbox after each step marked "Email".
- Use the test buyer's own name, phone and email. Do not use real customer data.
- The test dealer acts through the link in its SAFE MODE email (a quote request page). Open it in a private window so the buyer session stays signed in.
- Do not click anything on a live dealer page that is not part of a step. Stop on any unexpected real-dealer send.
- Record pass/fail and a screenshot per step. Write the actual text if it differs from "Expected".
- Items marked **needs box patch** depend on a box2 change that the PRs did not apply. A failure there is a known gap, not a regression.

Base URL: https://www.trimscout.com

## 0. Setup
1. Open `/` signed in as the test buyer. Click **Request a Quote** (header). Expected: Configure Quote Request opens (see step 7 for the intro first).
2. Have a second private window ready for the test dealer.

## 1. Trade-in question (#639)
1. In the wizard go to step 3, the last section before Review & Send.
2. Expected: heading **Do you have a trade-in?**, hint "Optional. Invited dealers see the vehicle, mileage, condition and photos...", two buttons: **Yes, add my trade** and **Skip**.
3. Click **Yes, add my trade**. Expected: the trade form opens inline; **Continue** stays blocked until the trade is complete (VIN required; photos required).
4. In the form, leave "share payoff" off, enter a payoff amount. Expected: manual entry (under "Not right? Enter manually") shows year/make/model dropdowns.
5. Click **Skip** on a second request. Expected: nothing is collected or sent for a trade.
6. Send the request with the trade attached. Email (pausmi@outlook.com): row reads **Trade-in included**; no contact details, no payoff, the word "bid" does not appear.
7. Test dealer opens the quote request page. Expected: trade vehicle, mileage, condition, photos; **Payoff: Yes (amount not shared)**; no payoff amount, lender or equity.

## 2. GM sticker alternates (#638)
1. In the wizard step 1 search for a Chevrolet or GMC and pick one, then seat two alternates.
2. Open Configure Quote Request step 3 (compare).
3. Expected per alternate, in order: **Checking factory sticker...** while pending, then either the sticker's factory options and trim, **Sticker not published by GM yet**, or **Not verified**.
4. Expected: an alternate with a read sticker shows the sticker's own trim, not the decoder's raw trim ("Trail Boss - LT").
5. Reload and reopen. Expected: answers come from the session cache (no second "Checking" for the same VIN within the session).
6. If a 403/429 is hit, further alternates show **Not verified** and the page makes no more sticker requests. That is correct, not a failure.

## 3. OTD ranking, surcharges, "Best deal" (#640)
1. Send one request with 2 comparable vehicles/dealers (same car) so two quotes can come back. Keep a third request with only one quote for the negative check.
2. Test dealer 1 answers on its quote page: price at MSRP, doc fee, plus a surcharge named **County tax**, reason text "required".
3. Buyer view `/rfq/<id>`. Expected:
   - discount cell reads **At MSRP** (surcharge not counted), not "above MSRP", and not "on price + surcharges";
   - the surcharge line reads **County tax (required)** with no "Dealer-imposed" tag;
   - a non-county surcharge (add one on dealer 2, e.g. "Market adjustment") keeps the Dealer-imposed tag;
   - sales tax is the same with and without the surcharge; out-the-door, amount financed and cash due include it.
4. With only dealer 1's quote live: Expected: **no "Best deal"** chip. Alternates do not count.
5. Dealer 2 submits a comparable quote. Expected: **Best deal** appears on exactly one card; **Lowest out the door** marks the lowest OTD across all live quotes.
6. With a trade attached: Expected: chip reads **Best deal after trade** when sorted post-trade.
7. Buyer notes and the counter-accepted email say "including surcharges:".
8. On the dealer form, the price + add-ons + doc fee share of MSRP excludes surcharges.

## 4. Accept confirm dialog (#641)
1. On `/rfq/<id>` click **Choose this quote** (lease/used/compare cards), or in the staged flow click the OTD accept and **Accept final deal**.
2. Expected next to each Choose button: "Your contact info is shared only with the dealer you choose."
3. Expected dialog: title **Share your info with <Dealer>?**; body "Accepting shares your name, phone and email with <Dealer> only. They'll contact you directly... Other dealers won't get your info."; masked fields (e.g. `P•••`, `•••-•••-0142`, `p•••@outlook.com`), or **Not on file** for a missing field; buttons **Accept and share my info** and **Go back**.
4. Click **Go back**. Expected: dialog closes, nothing accepted, no email.
5. Repeat and click **Accept and share my info**. Expected: acceptance goes through once.
6. Phone width (390 px): Expected bottom sheet. From `sm` up: centred card.
7. Not applicable: the dealer accepting a buyer's counter on the dealer token page has no dialog by design.

## 5. Accepted-offer email and reveal (#643): needs box patch
Reveal needs the box2 deals-api wiring in `docs/BUYER_CONTACT_REVEAL.md`. Until applied, step 5.5 shows the error text instead.
1. After step 4 with **Accept final deal**, check pausmi@outlook.com.
2. Expected email: subject **Your offer was accepted** (tagged `[SAFE MODE ...]`); rows Vehicle, VIN, **Accepted out-the-door price**; button **View buyer contact info**. The email has **no buyer name, email or phone**. Only the winning dealer's notice is sent; losing dealers get the not-selected notice instead.
3. Open the button in the test dealer window: `/quote-request/buyer-contact?t=...`. Expected: vehicle, VIN, total, and a **Reveal buyer contact info** button; no buyer details yet.
4. Check the buyer deal page before pressing. Expected: no "Dealer viewed your contact info" line.
5. Press **Reveal buyer contact info**. Expected (patched box): name, email, phone appear. Unpatched box: "We couldn't open the contact info just now." and nothing revealed (fail closed, correct).
6. Reload the buyer's deal page. Expected: **Dealer viewed your contact info · <date, time>**.
7. Check the dealer's regular quote page. Expected: buyer details are not shown; it says contact info is not shown and to use the "View buyer contact info" link.
8. Optional: edit one character of `t` in the link. Expected: no reveal.

## 6. iX3 VINs submit without error (#653, #658)
1. In the wizard step 1 search `WBX33HR09VDA44039`, pick it. Expected card title: **2027 BMW iX3 50 xDrive** (not "2027 BMW 50 xDrive").
2. Go through to Review & Send and send (SAFE MODE). Expected: the request is created; **no "A specific matched vehicle is required."** error.
3. Repeat with `WBX33HR07VDA46209`.
4. Open the compare view for each request. Expected: title reads 2027 BMW iX3 50 xDrive.
5. Not covered: a factory `match` package with a truly blank trim can still return "vehicleTrim is required" from the box; use a link-style request. Old stored requests are not relabelled.

## 7. Quote intro animation (#642)
1. Open `/`, click **Request a Quote**. Expected: about 1.7 s animation (logo in a glowing ring; chips Your build / Must-haves / Trade-in on the left, Dealer 1 to 3 on the right; streaks flowing through the logo), then a fade into step 1 (Vehicle).
2. Click **Skip** (bottom right) during it. Expected: ends at once.
3. OS setting "Reduce motion" on, reopen. Expected: no animation, straight to step 1.
4. Phone width 390 px. Expected: the graphic scales to fit.
5. Flag: on in Production; `NEXT_PUBLIC_QUOTE_INTRO=0` turns it off (not testable from the site).

## 8. "Unverified email" for BMW of Westlake (#655)
1. Open `/search`. Filter or search for dealer **BMW of Westlake** (Ohio) and a BMW row.
2. Column **Contact on file**. Expected: **Unverified email** (not "No", not "Yes"). The directory holds a Ganley BMW address that is not tied to the store.
3. Check the contact filter. Expected: unchanged behaviour (an unverified address is not counted as on file).
4. In the wizard dealer list the same dealer reads **Unverified email**, and no quote email goes to that address.

## Wrap-up
- Inbox pausmi@outlook.com: expected email count per step 1, 3, 4, 5. All tagged `[SAFE MODE ...]`. Report any untagged email as a stop-everything bug.
- Log results in this file's PR thread or a new `docs/test-plans/` results note.
