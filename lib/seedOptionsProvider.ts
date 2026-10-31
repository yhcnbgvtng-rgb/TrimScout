// The seed adapter behind lib/optionsProvider.ts's OptionsProvider
// interface. Sources from MOCK_VEHICLES — real, dealer-confirmed VINs with
// real factory-option codes/prices (Paul Miller Porsche and friends), not
// fabricated data. This is a small sample set, not the searchable inventory
// — see sourceLabel, which the UI shows verbatim so buyers know what they're
// looking at.
//
// Swap target: a live adapter (e.g. MarketCheck NeoVIN) implementing the
// same OptionsProvider interface. Nothing outside this file should need to
// change when that happens.
import { MOCK_VEHICLES } from "./mockData";
import type { OptionsProvider, MatchableVehicle } from "./optionsProvider";

export const SEED_SOURCE_LABEL = "Sample inventory with confirmed options";

export const seedOptionsProvider: OptionsProvider = {
  sourceLabel: SEED_SOURCE_LABEL,
  async listMatchableVehicles(): Promise<MatchableVehicle[]> {
    return MOCK_VEHICLES.filter((v) => v.options.length > 0).map((v) => ({
      vehicle: v,
      options: v.options.map((o) => ({ code: o.code, name: o.name, price: o.price })),
    }));
  },
};
