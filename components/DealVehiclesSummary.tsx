import React from "react";
import Link from "next/link";
import type { Vehicle, BiddingRequest, DealStructureMethod } from "../lib/types";
import { reviewTargetFromVehicle } from "../lib/fordCompetitionUi";
import { summarizeVehicleTerms, termsForVin } from "../lib/dealTerms";
import { collectDealVehicles } from "../lib/offerCompare";
import { ChevronDown } from "lucide-react";

function VehicleLine({
  vehicle,
  request,
  requested,
}: {
  vehicle: Vehicle;
  request: BiddingRequest;
  requested: DealStructureMethod[];
}) {
  const review = reviewTargetFromVehicle(vehicle);
  const terms = termsForVin(request.dealStructurePreferences?.vehicleTerms, vehicle.vin);
  const termLines = summarizeVehicleTerms(terms, requested);
  return (
    <div>
      <div className="text-xs font-bold text-white">{review?.title || "Imported vehicle"}</div>
      {review?.vin ? (
        <div className="text-[11px] font-mono text-ink-muted mt-0.5">
          {review.vdpHref ? (
            <a href={review.vdpHref} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
              {review.vin}
            </a>
          ) : (
            review.vin
          )}
        </div>
      ) : null}
      {review?.dealerName ? <div className="text-[11px] text-ink-light mt-0.5">{review.dealerName}</div> : null}
      {termLines.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {termLines.map((line) => (
            <li key={line} className="text-[11px] text-ink-muted">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// One selected vehicle is the hero — up to two others used to render as
// equal sibling cards; now they're a single collapsed "Alternates"
// disclosure so the deal reads as one car, not three competing options.
export function DealVehiclesSummary({
  request,
  compareHref,
  hidePrimary = false,
}: {
  request: BiddingRequest;
  compareHref?: string;
  /** Skip the primary-vehicle line — for callers (like the Deal Tracker
   * hero card) whose own header already shows the primary vehicle's title,
   * VIN, and dealer, so repeating it here would just be the same line twice. */
  hidePrimary?: boolean;
}) {
  const vehicles = collectDealVehicles(request.targetVehicle, request.otherLots || []);
  const requested = request.dealStructurePreferences?.requestedStructures || [];
  if (vehicles.length === 0) return null;
  const [primary, ...alternates] = vehicles;

  if (hidePrimary && alternates.length === 0 && !compareHref) return null;

  return (
    <div className="space-y-2">
      {hidePrimary ? (
        compareHref ? (
          <div className="flex justify-end">
            <Link href={compareHref} className="text-[11px] font-bold text-emerald-400 hover:underline">
              Review offer terms
            </Link>
          </div>
        ) : null
      ) : (
        <div className="flex items-start justify-between gap-2">
          <VehicleLine vehicle={primary} request={request} requested={requested} />
          {compareHref ? (
            <Link href={compareHref} className="text-[11px] font-bold text-emerald-400 hover:underline shrink-0 mt-0.5">
              Review offer terms
            </Link>
          ) : null}
        </div>
      )}

      {alternates.length > 0 && (
        <details className="group rounded-lg border border-border/60">
          <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between gap-2 text-[11px] font-bold text-ink-muted">
            <span>Alternates ({alternates.length})</span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/60">
            {alternates.map((vehicle, index) => (
              <VehicleLine key={vehicle.vin || index} vehicle={vehicle} request={request} requested={requested} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
