"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ListChecks,
  CircleCheck as CheckCircle2,
  CircleX as XCircle,
  ChevronDown,
  ChevronUp,
  SendHorizontal,
  Users,
  ArrowLeft,
  Search,
} from "lucide-react";
import type { UserProfile, Vehicle } from "../lib/types";
import type { MatchableVehicle } from "../lib/optionsProvider";
import { seedOptionsProvider, SEED_SOURCE_LABEL } from "../lib/seedOptionsProvider";
import { buildOptionCatalog, matchVehicle, rankMatches, type VehicleMatchResult } from "../lib/optionsMatch";
import { formatFactoryOptionLine } from "../lib/fordCompetitionUi";
import { formatCurrency } from "../lib/otdCalculator";
import { RfqInviteDraft } from "./RfqInviteDraft";

interface FactoryMatchFlowProps {
  onRequestQuote: (vehicle: Vehicle) => void;
  /** "I don't see my car here" escape hatch back to the paste-your-own-VIN flow. */
  onSearchInstead: () => void;
  onBack: () => void;
  currentUser?: UserProfile | null;
  onRequireLogin?: () => void;
}

function OptionCheckList({
  entries,
  checked,
  onToggle,
}: {
  entries: { code: string; name: string }[];
  checked: string[];
  onToggle: (code: string) => void;
}) {
  return (
    <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
      {entries.map((opt) => {
        const isChecked = checked.includes(opt.code);
        return (
          <label key={opt.code} className="flex items-start gap-2 py-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggle(opt.code)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-emerald-500 focus:ring-0"
            />
            <span className={`leading-snug ${isChecked ? "text-white" : "text-ink-light"}`}>
              {formatFactoryOptionLine({ code: opt.code, description: opt.name })}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function MatchCard({
  result,
  onRequestQuote,
  onInviteToQuote,
}: {
  result: VehicleMatchResult;
  onRequestQuote: (v: Vehicle) => void;
  onInviteToQuote?: (result: VehicleMatchResult) => void;
}) {
  const v = result.vehicle;
  return (
    <div className={`rounded-2xl border p-4 space-y-3 bg-surface ${result.isFullMatch ? "border-emerald-500/60" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-white">
            {v.year} {v.make} {v.model} {v.trim}
          </div>
          <div className="text-[11px] text-ink-muted">
            {v.location.dealerName} · {v.location.city}, {v.location.state}
          </div>
        </div>
        <div className="text-sm font-extrabold text-emerald-400 shrink-0">{formatCurrency(v.dealerPrice)}</div>
      </div>

      <div className="space-y-1">
        {result.mustHavesHit.map((opt) => (
          <div key={opt.code} className="flex items-start gap-1.5 text-[11px] text-white">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <span>{formatFactoryOptionLine({ code: opt.code, description: opt.name })}</span>
          </div>
        ))}
        {result.mustHavesMissed.map((opt) => (
          <div key={opt.code} className="flex items-start gap-1.5 text-[11px] text-ink-muted">
            <XCircle className="h-3.5 w-3.5 text-red-400/70 shrink-0 mt-0.5" />
            <span>{formatFactoryOptionLine({ code: opt.code, description: opt.name })} — not confirmed on this VIN</span>
          </div>
        ))}
      </div>

      {result.isFullMatch && onInviteToQuote ? (
        <button
          onClick={() => onInviteToQuote(result)}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all"
        >
          <Users className="h-3.5 w-3.5" />
          Invite Dealers to Quote
        </button>
      ) : (
        <button
          onClick={() => onRequestQuote(v)}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all"
        >
          <SendHorizontal className="h-3.5 w-3.5" />
          Request quote
        </button>
      )}
    </div>
  );
}

export const FactoryMatchFlow: React.FC<FactoryMatchFlowProps> = ({
  onRequestQuote,
  onSearchInstead,
  onBack,
  currentUser,
  onRequireLogin,
}) => {
  const [inventory, setInventory] = useState<MatchableVehicle[] | null>(null);
  const [mustHaveCodes, setMustHaveCodes] = useState<string[]>([]);
  const [niceToHaveCodes, setNiceToHaveCodes] = useState<string[]>([]);
  const [showNiceToHave, setShowNiceToHave] = useState(false);
  const [inviteDraftFor, setInviteDraftFor] = useState<VehicleMatchResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    seedOptionsProvider.listMatchableVehicles().then((vehicles) => {
      if (!cancelled) setInventory(vehicles);
    });
    // Fire-and-forget — logged separately from paid_decode so seed-tier
    // usage never gets conflated with paid vendor spend in the logs.
    fetch("/api/events/seed-match", { method: "POST" }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const catalog = useMemo(() => buildOptionCatalog(inventory || []), [inventory]);

  const toggleMustHave = (code: string) => {
    setMustHaveCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    setNiceToHaveCodes((prev) => prev.filter((c) => c !== code));
  };
  const toggleNiceToHave = (code: string) => {
    setNiceToHaveCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const hasPicked = mustHaveCodes.length > 0;
  const ranked = useMemo(() => {
    if (!inventory || !hasPicked) return [];
    return rankMatches(inventory.map((mv) => matchVehicle(mv, mustHaveCodes, niceToHaveCodes, catalog)));
  }, [inventory, mustHaveCodes, niceToHaveCodes, hasPicked]);

  const fullMatches = ranked.filter((r) => r.isFullMatch);
  const closest = ranked.filter((r) => !r.isFullMatch).slice(0, 3);

  if (inviteDraftFor) {
    return (
      <RfqInviteDraft
        result={inviteDraftFor}
        currentUser={currentUser}
        onRequireLogin={onRequireLogin}
        onCancel={() => setInviteDraftFor(null)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8 space-y-8 animate-fadeIn">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-white transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </button>

      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-white">Match Your Must-Have Options</h1>
        <p className="text-sm text-ink-muted leading-relaxed max-w-2xl">
          Check the factory options you actually need. We&apos;ll show you which cars in our{" "}
          <span className="text-white font-semibold">{SEED_SOURCE_LABEL.toLowerCase()}</span> actually have them — never a
          guess, always the specific code confirmed on that VIN.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-bold text-white">Must-have factory options</h2>
        </div>
        <p className="text-[11px] text-ink-muted">Check only what you require. Unchecked options are never held against a car.</p>
        {inventory === null ? (
          <p className="text-xs text-ink-muted py-4">Loading inventory…</p>
        ) : (
          <OptionCheckList entries={catalog} checked={mustHaveCodes} onToggle={toggleMustHave} />
        )}
      </div>

      {inventory !== null && (
        <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
          <button
            onClick={() => setShowNiceToHave((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-sm font-bold text-white">Nice-to-haves (optional)</span>
            {showNiceToHave ? <ChevronUp className="h-4 w-4 text-ink-muted" /> : <ChevronDown className="h-4 w-4 text-ink-muted" />}
          </button>
          {showNiceToHave && (
            <>
              <p className="text-[11px] text-ink-muted">
                These never filter out a car — they just get called out when a match happens to have them too.
              </p>
              <OptionCheckList
                entries={catalog.filter((c) => !mustHaveCodes.includes(c.code))}
                checked={niceToHaveCodes}
                onToggle={toggleNiceToHave}
              />
            </>
          )}
        </div>
      )}

      <div className="space-y-4">
        {!hasPicked ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center space-y-1">
            <p className="text-sm text-white font-semibold">Check at least one must-have to see your shortlist</p>
            <p className="text-xs text-ink-muted">Nothing is filtered until you pick something you actually need.</p>
          </div>
        ) : fullMatches.length > 0 ? (
          <>
            <h2 className="text-sm font-bold text-white">
              {fullMatches.length} {fullMatches.length === 1 ? "car hits" : "cars hit"} every must-have you picked
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fullMatches.map((r) => (
                <MatchCard key={r.vehicle.id} result={r} onRequestQuote={onRequestQuote} onInviteToQuote={setInviteDraftFor} />
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-1">
              <p className="text-sm text-white font-semibold">
                No car in our curated inventory hits every must-have you picked yet
              </p>
              <p className="text-xs text-ink-muted leading-relaxed">
                We won&apos;t show you a car and pretend it matches. Here are the closest cars we do have — each one clearly
                marked with what it has and what it&apos;s missing — or paste a VIN or listing link and we&apos;ll check that
                specific car&apos;s real build sheet instead.
              </p>
            </div>
            {closest.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {closest.map((r) => (
                  <MatchCard key={r.vehicle.id} result={r} onRequestQuote={onRequestQuote} />
                ))}
              </div>
            )}
            <button
              onClick={onSearchInstead}
              className="flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-xs font-bold text-white hover:border-border-strong transition-all"
            >
              <Search className="h-3.5 w-3.5" />
              Paste a VIN or listing link instead
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
