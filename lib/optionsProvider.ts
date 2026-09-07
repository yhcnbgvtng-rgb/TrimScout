// A vendor-neutral source of "vehicles with known factory options" for the
// factory-option match flow. The UI (components/FactoryMatchFlow.tsx) only
// ever talks to this interface — never to a specific vendor — so swapping
// the seed adapter (lib/seedOptionsProvider.ts) for a live one (e.g.
// MarketCheck NeoVIN) later is a one-line change with no UI/copy impact.
import type { Vehicle } from "./types";

export interface FactoryOptionRef {
  code: string;
  name: string;
  price?: number;
}

export interface MatchableVehicle {
  vehicle: Vehicle;
  /** Every factory option this vehicle is confirmed (not guessed) to carry. */
  options: FactoryOptionRef[];
}

export interface OptionsProvider {
  /** Shown to buyers so they know how this inventory was sourced/verified. */
  readonly sourceLabel: string;
  listMatchableVehicles(): Promise<MatchableVehicle[]>;
}
