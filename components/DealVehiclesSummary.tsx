import React from "react";
import Link from "next/link";
import type { BiddingRequest } from "../lib/types";
import { reviewTargetFromVehicle } from "../lib/fordCompetitionUi";
import { summarizeVehicleTerms, termsForVin } from "../lib/dealTerms";
import { collectDealVehicles } from "../lib/offerCompare";

export function DealVehiclesSummary({
  request,
  compareHref,
}: {
  request: BiddingRequest;
  compareHref?: string;
}) {
  const vehicles = collectDealVehicles(request.targetVehicle, request.otherLots || []);
  const requested = request.dealStructurePreferences?.requestedStructures || [];
  if (vehicles.length === 0) return null;
  const labels = ["Imported favorite", "Other lot 1", "Other lot 2"];

  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
          Vehicles in this deal ({vehicles.length})
        </h3>
        {compareHref ? (
          <Link href={compareHref} className="text-[11px] font-bold text-emerald-400 hover:underline">
            Review offer terms
          </Link>
        ) : null}
      </div>
      <div className={`grid gap-2 ${vehicles.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
        {vehicles.map((vehicle, index) => {
          const review = reviewTargetFromVehicle(vehicle);
          const terms = termsForVin(request.dealStructurePreferences?.vehicleTerms, vehicle.vin);
          const termLines = summarizeVehicleTerms(terms, requested);
          return (
            <div key={vehicle.vin || index} className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                {labels[index] || `Lot ${index + 1}`}
              </div>
              <div className="text-xs font-bold text-white mt-0.5">
                {review?.title || "Imported vehicle"}
              </div>
              {review?.vin ? (
                <div className="text-[11px] font-mono text-ink-muted">
                  {review.vdpHref ? (
                    <a href={review.vdpHref} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                      {review.vin}
                    </a>
                  ) : (
                    review.vin
                  )}
                </div>
              ) : null}
              {review?.dealerName ? (
                <div className="text-[11px] text-ink-light">{review.dealerName}</div>
              ) : null}
              {termLines.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {termLines.map((line) => (
                    <li key={line} className="text-[11px] text-ink-muted">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
