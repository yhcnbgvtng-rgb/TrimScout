// The seed adapter behind lib/optionsProvider.ts's OptionsProvider
// interface. Sources from MOCK_VEHICLES — real, dealer-confirmed VINs with
// real factory-option codes/prices (Paul Miller Porsche and friends), not
// fabricated data. This is "curated, hand-verified" inventory, not a scrape
// of the whole market — see sourceLabel, which the UI shows verbatim so
// buyers know what they're looking at.
//
// Swap target: a live adapter (e.g. MarketCheck NeoVIN) implementing the
// same OptionsProvider interface. Nothing outside this file should need to
// change when that happens.
import { MOCK_VEHICLES } from "./mockData";
import type { OptionsProvider, MatchableVehicle } from "./optionsProvider";

export const SEED_SOURCE_LABEL = "Curated, hand-verified seed inventory";

export const seedOptionsProvider: OptionsProvider = {
  sourceLabel: SEED_SOURCE_LABEL,
  async listMatchableVehicles(): Promise<MatchableVehicle[]> {
    return MOCK_VEHICLES.filter((v) => v.options.length > 0).map((v) => ({
      vehicle: v,
      options: v.options.map((o) => ({ code: o.code, name: o.name, price: o.price })),
    }));
  },
};
