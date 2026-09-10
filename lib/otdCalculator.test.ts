import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getZipCoordinates, STATE_CENTROIDS } from "./otdCalculator";
import { UNRESOLVED_STATE, isResolvedState } from "./sameStateCheck";

describe("getZipCoordinates state resolution", () => {
  it("still resolves the hardcoded metro prefixes exactly as before", () => {
    assert.equal(getZipCoordinates("07030").state, "NJ");
    assert.equal(getZipCoordinates("10001").state, "NY");
    assert.equal(getZipCoordinates("33101").state, "FL");
    assert.equal(getZipCoordinates("75201").state, "TX");
    assert.equal(getZipCoordinates("90210").state, "CA");
    assert.equal(getZipCoordinates("98101").state, "WA");
  });

  it("resolves the states that used to fall through to the sentinel", () => {
    // Every one of these returned state "USA" at San Francisco's coordinates
    // before the ZIP3 table existed, which excluded the buyer from the
    // same-state dealer gate and broke their distance/radius filtering.
    const cases: Array<[string, string]> = [
      ["44101", "OH"], // Cleveland
      ["43215", "OH"], // Columbus
      ["28202", "NC"], // Charlotte
      ["27601", "NC"], // Raleigh
      ["29201", "SC"], // Columbia
      ["37201", "TN"], // Nashville
      ["38103", "TN"], // Memphis
      ["55401", "MN"], // Minneapolis
      ["63101", "MO"], // St. Louis
      ["46204", "IN"], // Indianapolis
      ["53202", "WI"], // Milwaukee
      ["70112", "LA"], // New Orleans
      ["73102", "OK"], // Oklahoma City
      ["87101", "NM"], // Albuquerque
      ["89101", "NV"], // Las Vegas
      ["84101", "UT"], // Salt Lake City
      ["97201", "OR"], // Portland
      ["21201", "MD"], // Baltimore
      ["23219", "VA"], // Richmond
      ["06103", "CT"], // Hartford
      ["35203", "AL"], // Birmingham
      ["40202", "KY"], // Louisville
      ["50309", "IA"], // Des Moines
      ["66101", "KS"], // Kansas City, KS
      ["68102", "NE"], // Omaha
      ["72201", "AR"], // Little Rock
      ["39201", "MS"], // Jackson
      ["59101", "MT"], // Billings
      ["83702", "ID"], // Boise
      ["82001", "WY"], // Cheyenne
      ["57104", "SD"], // Sioux Falls
      ["58102", "ND"], // Fargo
      ["96813", "HI"], // Honolulu
      ["99501", "AK"], // Anchorage
      ["19801", "DE"], // Wilmington
      ["02903", "RI"], // Providence
      ["03301", "NH"], // Concord
      ["04101", "ME"], // Portland, ME
      ["05401", "VT"], // Burlington
      ["25301", "WV"], // Charleston
      ["20001", "DC"], // Washington
    ];
    for (const [zip, state] of cases) {
      assert.equal(getZipCoordinates(zip).state, state, `ZIP ${zip}`);
      assert.equal(isResolvedState(getZipCoordinates(zip).state), true, `ZIP ${zip}`);
    }
  });

  it("places a fallback ZIP at its own state's centroid, not San Francisco", () => {
    const ohio = getZipCoordinates("44101");
    assert.equal(ohio.lat, STATE_CENTROIDS.OH.lat);
    assert.equal(ohio.lng, STATE_CENTROIDS.OH.lng);
    // The old sentinel put every unmapped buyer on San Francisco's coordinates,
    // so a distance or radius calculation for them was pure noise.
    assert.notEqual(Math.round(ohio.lng), -122);
  });

  it("honors the split ZIP prefixes that don't follow their neighbors", () => {
    assert.equal(getZipCoordinates("73301").state, "TX"); // Austin, inside OK's block
    assert.equal(getZipCoordinates("88510").state, "TX"); // El Paso, past NM's block
    assert.equal(getZipCoordinates("39901").state, "GA"); // Atlanta, past MS's block
    assert.equal(getZipCoordinates("20101").state, "VA"); // 201 is VA, not DC
    assert.equal(getZipCoordinates("00501").state, "NY"); // Holtsville
  });

  it("gives the no-sales-tax states a real zero instead of a blanket 8%", () => {
    assert.equal(getZipCoordinates("97201").taxRate, 0); // OR
    assert.equal(getZipCoordinates("03301").taxRate, 0); // NH
    assert.equal(getZipCoordinates("19801").taxRate, 0); // DE
    assert.equal(getZipCoordinates("59101").taxRate, 0); // MT
  });

  it("keeps the sentinel for blocks that genuinely have no state", () => {
    // Military and territory prefixes have no state a dealer could match, so
    // they must stay unresolved rather than be forced into a wrong one.
    assert.equal(getZipCoordinates("09501").state, UNRESOLVED_STATE); // AE
    assert.equal(getZipCoordinates("96201").state, UNRESOLVED_STATE); // AP
    assert.equal(getZipCoordinates("00901").state, UNRESOLVED_STATE); // PR
    assert.equal(getZipCoordinates("96910").state, UNRESOLVED_STATE); // GU
    // 340 (Armed Forces Americas) is the one exception: it sits inside the
    // pre-existing 320-349 Florida metro rule, which this change leaves alone.
    assert.equal(getZipCoordinates("34002").state, "FL");
  });

  it("never returns a state string that isResolvedState would reject as garbage", () => {
    for (let prefix = 0; prefix <= 999; prefix++) {
      const zip = String(prefix).padStart(3, "0") + "01";
      const { state, taxRate } = getZipCoordinates(zip);
      assert.ok(
        isResolvedState(state) || state === UNRESOLVED_STATE,
        `ZIP ${zip} produced state ${JSON.stringify(state)}`
      );
      assert.ok(taxRate >= 0 && taxRate < 0.2, `ZIP ${zip} tax rate ${taxRate}`);
    }
  });
});
