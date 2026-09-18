import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import { QUOTE_EQUATIONS } from "../components/BiddingWizard";
import path from "node:path";
import { describe, it } from "node:test";
import {
  formatDealStructures,
  paymentMethodFromStructures,
  toggleDealStructure,
} from "./dealStructure";

describe("deal structure multi-select", () => {
  it("formats checked methods as Cash + Finance, never an All label", () => {
    assert.equal(formatDealStructures(["cash"]), "Cash");
    assert.equal(formatDealStructures(["finance"]), "Finance");
    assert.equal(formatDealStructures(["lease"]), "Lease");
    assert.equal(formatDealStructures(["cash", "finance"]), "Cash + Finance");
    assert.equal(formatDealStructures(["lease", "cash"]), "Cash + Lease");
    assert.equal(formatDealStructures(["lease", "finance", "cash"]), "Cash + Finance + Lease");
    assert.equal(formatDealStructures([]), "");
    assert.doesNotMatch(formatDealStructures(["cash", "finance", "lease"]), /all 3|show me all/i);
  });

  it("toggles cash, finance, and lease independently and keeps canonical order", () => {
    assert.deepEqual(toggleDealStructure(["cash"], "finance"), ["cash", "finance"]);
    assert.deepEqual(toggleDealStructure(["cash", "finance"], "cash"), ["finance"]);
    assert.deepEqual(toggleDealStructure(["finance"], "lease"), ["finance", "lease"]);
    assert.deepEqual(toggleDealStructure(["cash", "finance", "lease"], "finance"), ["cash", "lease"]);
    assert.deepEqual(toggleDealStructure([], "lease"), ["lease"]);
  });

  it("legacy paymentMethod is the first checked method, never all_three", () => {
    assert.equal(paymentMethodFromStructures(["cash"]), "cash");
    assert.equal(paymentMethodFromStructures(["finance", "lease"]), "finance");
    assert.equal(paymentMethodFromStructures(["cash", "finance", "lease"]), "cash");
    assert.equal(paymentMethodFromStructures([]), "cash");
    assert.notEqual(paymentMethodFromStructures(["cash", "finance", "lease"]), "all_three");
  });
});

describe("BiddingWizard — Step 1 vehicle; Step 2 payment only; Step 3 quote format (the locks, as a matrix)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
  const step1 = src.slice(src.indexOf("STEP 1: VEHICLE"), src.indexOf("STEP 2: PAYMENT"));
  const paymentStep = src.slice(src.indexOf("STEP 2: PAYMENT"), src.indexOf("STEP 3: QUOTE FORMAT"));
  // The lock sections (term / down / band / ZIP…) live on Step 3 now.
  const step2 = src.slice(src.indexOf("STEP 3: QUOTE FORMAT"), src.indexOf("STEP 4: REVIEW"));

  it("(1) Step 1 has the vehicle flow and no lease term/miles or payment chips", () => {
    assert.ok(step1.length > 0 && step2.length > 0);
    assert.match(step1, /One car is required to continue/);
    assert.doesNotMatch(step1, /Only send this to dealerships in my state/);
    assert.match(step1, /data-testid="alternate-vehicles"/);
    assert.match(step1, /label="Alternate 1"/);
    assert.match(step1, /label="Alternate 2"/);
    assert.doesNotMatch(step1, /Add additional vehicles|showAlternates/, "the two alternate slots are always shown — no reveal link");
    assert.doesNotMatch(step1, /trade in|Trade-in/i, "no trade-in question on Step 1");
    assert.doesNotMatch(step1, /LEASE_TERMS\.map|LEASE_MILES\.map|Lease preferences|DEAL_STRUCTURE_LABELS|toggleDealStructure/);
    assert.match(src, /STEP_LABELS = \["Vehicle", "Payment", "Quote format", "Review & Send"\]/);
  });

  it("(2) Step 2 offers Lease | Finance | Cash as equal options, none assumed — and nothing else; Step 3 holds the type-specific locks", () => {
    assert.match(src, /useState<DealStructureMethod \| null>\(null\)/);
    assert.match(paymentStep, /\["lease", "finance", "cash"\] as const/);
    assert.doesNotMatch(paymentStep, /LEASE_TERMS\.map|Down payment|Credit band|Your ZIP|missing-locks/, "payment step is the tiles only");
    assert.match(step2, /<QuoteFormatMatrix\s+quoteType=\{quoteType\}\s+cars=\{intent === "alternate" \? \[\] : \[selectedVehicle, altVehicle1, altVehicle2\]/);
    // Dealer panel: a green "Sales contact on file" when the desk is known, an adviser-email field when it isn't; the note goes with the request.
    assert.match(step2, /✓ Sales contact on file/);
    assert.match(step2, /placeholder=\{optedOut \? "Sales adviser email" : "Sales adviser email \(optional\)"\}/, "the adviser address is optional once the rooftop is known");
    assert.match(src, /buyerNote: dealComment\.trim\(\) \|\| null,/);
    // Dealer on top, the car under it, then every dealer's return as a vertical equation.
    assert.match(src, /data-testid="format-dealer"[\s\S]*?data-testid="format-vehicle"[\s\S]*?data-testid="format-equation"/);
    assert.deepEqual(QUOTE_EQUATIONS.cash.lines.map((l) => `${l.op} ${l.label}`), ["+ Selling price", "+ Add-ons", "+ Mandatory fees", "+ Sales tax", "− Rebates / credits", "= Out the door"]);
    assert.match(src, /\{quoteType !== "lease" \? \(\s*<div className="space-y-1\.5" data-testid="format-equation">/, "no equation block on a lease request");
    assert.doesNotMatch(src, /You lock<\/p>/, "the locks are asked once, in the fields below — not listed again");
    assert.match(step2, /data-testid="quote-format-step"/);
    assert.match(step2, /quoteType === "lease" && \(/);
    assert.match(step2, /LEASE_TERMS\.map/);
    assert.match(step2, /LEASE_MILES\.map/);
    assert.match(step2, /quoteType === "finance" && \(/);
    assert.match(step2, /Down payment/);
    assert.match(step2, /Credit band/);
    assert.match(step2, /CREDIT_BAND_COPY/);
    assert.doesNotMatch(step2, /Prefer not to say|\(optional\)<\/span>\s*<\/span>\s*<select[^>]*value=\{creditBand\}/, "credit band is required");
    assert.match(step2, /Timeline <span[^>]*>\(optional\)/);
    // Nothing pre-chosen on Quote setup: no term lit up, no miles, no ZIP, no finance term.
    assert.match(src, /useState<LeaseTerm \| "">\(""\)/);
    assert.match(src, /useState<LeaseMiles \| "">\(""\)/);
    assert.match(src, /useState<number \| "">\(""\)/);
    assert.match(src, /const \[huntZip, setHuntZip\] = useState\(""\)/);
    assert.match(step2, /<option value="">Choose a term<\/option>/);
    assert.doesNotMatch(step2, /Not sure yet/);
    assert.match(step2, /autoComplete="off"/);
    // …and a fresh open of the modal resets them, since the wizard stays mounted between opens.
    assert.match(src, /if \(!isOpen\) return;[\s\S]*?setStep\(1\);[\s\S]*?setQuoteType\(null\);\s*setLeaseTerm\(""\);\s*setLeaseMiles\(""\);\s*setFinanceTerm\(""\);[\s\S]*?setHuntZip\(""\);/);
  });

  it("(3) the lease path feeds the lease calculator contract unchanged", () => {
    assert.match(src, /leasePrefs:\s*quoteType === "lease" && !isUsed\s*\? \{\s*termMonths: leaseTerm \|\| null,\s*milesPerYear: leaseMiles \|\| null,\s*zip:/);
  });

  it("(4) Continue into Step 2 needs the vehicle; out of Step 2 a payment method; out of Step 3 every lock plus ≥1 reachable desk and a clean note", () => {
    assert.match(src, /if \(step === 1\) \{[\s\S]*?if \(step1IntentPhase\) \{[\s\S]*?setIntentConfirmed\(true\);[\s\S]*?if \(!vehicleImported\) return;\s*\}/, "Step 1: leave the intent substep on an intent, then the vehicle gates Step 2");
    assert.match(src, /const paymentChosen = Boolean\(quoteType\) && !\(quoteType === "lease" && isUsed\);/);
    assert.match(src, /if \(step === 2 && !paymentChosen\) return;/);
    assert.match(src, /if \(step === 3 && \(!quoteSetupComplete \|\| confirmedDeskCount === 0 \|\| dealCommentContactWarning \|\| tradeInExpected === null\)\) return;/);
    // Every lock must be set: the gate is "nothing missing", and the empty state names what is.
    assert.match(src, /const quoteSetupComplete = Boolean\(quoteType\) && missingLocks\.length === 0 && !\(quoteType === "lease" && isUsed\);/);
    assert.match(src, /quoteType === "finance"\s*\? missingFinanceLocks\(\{ termMonths: financeTerm, downPayment, creditBand, zip: huntZip \}\)/);
    assert.match(src, /quoteType === "cash"\s*\? zipOk \? \[\] : \["ZIP"\]\s*: \[\]/);
    assert.match(step2, /data-testid="missing-locks"/);
    assert.match(step2, /data-testid="missing-contact"/);
    // Step 3 asks whether a trade-in is coming; Continue waits for an answer; the answer rides the request.
    assert.match(step2, /data-testid="trade-in-question"/);
    assert.match(src, /tradeInExpected === null\)\) return;/);
    assert.match(src, /buyerNote: dealComment\.trim\(\) \|\| null,\s*tradeInExpected,/);
    assert.match(src, /TOTAL_STEPS = 4/);
  });

  it("has no All control or all_three id", () => {
    assert.doesNotMatch(src, /all_three/);
    assert.doesNotMatch(src, /Show Me All 3/);
  });
});
