import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stickerProviderForVin } from "./factoryBuildProviders";

describe("stickerProviderForVin", () => {
  it("routes a Hyundai WMI to the Hyundai provider", () => {
    assert.equal(stickerProviderForVin("KMHL14JA5PA123456")?.id, "hyundai_dealerfire");
  });

  it("routes a pure Genesis WMI (not shared with Hyundai) to the Genesis provider", () => {
    assert.equal(stickerProviderForVin("KMTGB4JEXNU123456")?.id, "genesis_oem");
  });

  it("routes the shared 5NM WMI to Hyundai — its own fetch already falls back to Genesis internally for that WMI", () => {
    assert.equal(stickerProviderForVin("5NMJECDE6TH781852")?.id, "hyundai_dealerfire");
  });

  it("returns null for a brand with no wired provider yet", () => {
    assert.equal(stickerProviderForVin("1FTFW1ED5PFA12345"), null);
  });

  it("returns null for a VIN that isn't 17 characters", () => {
    assert.equal(stickerProviderForVin("SHORT"), null);
  });
});
