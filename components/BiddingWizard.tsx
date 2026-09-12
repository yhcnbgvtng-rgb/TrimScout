"use client";

import React, { useState, useEffect } from "react";
import { Vehicle, BiddingStrategy, BiddingRequest, UserProfile, type DealStructureMethod, type PurchaseTimeline, type TradeInVehicle } from "../lib/types";
import {
  DEAL_STRUCTURE_LABELS,
  formatDealStructures,
  paymentMethodFromStructures,
  toggleDealStructure,
} from "../lib/dealStructure";
import { formatCurrency, getZipCoordinates } from "../lib/otdCalculator";
import { outOfStateVehicles, formatOutOfStateWarning, stateGatePlan, formatExpandNudge } from "../lib/sameStateCheck";
import { diffVsPrimary, mustHaveHeadline, mustHaveReport, type MustHaveRef } from "../lib/alternateCompare";
import { isPlausibleDealerEmail, type DealerContactStatus } from "../lib/dealerContactLookup";
import { formatBuyerAlias } from "../lib/buyerAlias";
import {
  NON_BINDING_COPY,
  DESK_ROLE_LABELS,
  MAX_PACKAGE_LINKS,
  INVITE_STAGE_LABELS,
  inviteStage,
  type DealerLinkPaste,
  type QuoteInviteStage,
} from "../lib/quotePackage";
import type { PublicDesk } from "../app/api/quote-desks/route";
import type { RfqInvite } from "../lib/rfq";
import { newDealReference } from "../lib/dealReference";
import { findContactInfo } from "../lib/piiFilter";
import { formatDealerResponsivenessLabel, type DealerResponsivenessStats } from "../lib/dealerResponsiveness";
import { formatTypicalOtdLabel, type TypicalOtdStats } from "../lib/typicalOtd";
import { discountRealismWarning } from "../lib/discountRealism";
import {
  FORD_BUILD_SHEET_LINK,
  FORD_MUST_HAVE_HEADING,
  FORD_MUST_HAVE_HELP,
  formatFactoryOptionLine,
  reviewTargetFromVehicle,
} from "../lib/fordCompetitionUi";
import { brandCodeFromMake } from "../lib/oemWmi";
import {
  classifyPaste,
  importPastedFactoryVehicle,
  type FactoryBuildOem,
  type FactoryFilterableOption,
  type PasteImportSuccess,
} from "../lib/pasteImport";
import {
  attachLinkToVehicle,
  dealerSourceLabel,
  deskLocationLine,
  hasVinResolvedDealer,
  isPlausibleVin,
  resolveVdpLink,
  searchDealers,
  type DeskMatch,
  type LinkResolution,
} from "../lib/linkImport";
import { shopperDealStructurePayload, mapDealRequestJson } from "../lib/shopperDeal";
import { defaultTermsForVehicles } from "../lib/dealTerms";
import {
  buildOfferCompareSnapshot,
  collectDealVehicles,
  saveOfferCompareSnapshot,
  upsertShopperRequest,
} from "../lib/offerCompare";
import {
  X,
  ShieldCheck,
  Zap,
  ArrowRight,
  ArrowLeft,
  CircleCheck as CheckCircle2,
  ChevronDown,
  MapPin,
  Globe,
  LoaderCircle as Loader2,
  Handshake,
  FileText,
  ExternalLink,
} from "lucide-react";

type FilterableFactoryOption = FactoryFilterableOption;


function FactoryMustHavePicker({
  options,
  checked,
  onToggle,
}: {
  options: FilterableFactoryOption[];
  checked: string[];
  onToggle: (name: string) => void;
}) {
  return (
    <div className="max-h-56 overflow-y-auto">
      {options.map((opt) => {
        const isChecked = checked.includes(opt.name);
        const line = formatFactoryOptionLine({
          code: opt.code ?? null,
          description: opt.description || opt.name,
        });
        return (
          <label key={opt.name} className="flex items-start gap-2 py-0.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggle(opt.name)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-emerald-500 focus:ring-0"
            />
            <span className={`leading-snug ${isChecked ? "text-white" : "text-ink-light"}`}>
              {line}
              {opt.price != null && opt.price > 0 ? (
                <span className="text-ink-faint"> · {formatCurrency(opt.price)}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** One labeled group inside a wizard step — keeps every section's heading, hint, and spacing identical. */
function WizardSection({
  title,
  hint,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`space-y-3 ${className}`}>
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">{title}</h4>
        {hint ? <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

interface BiddingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
  preselectedVehicle?: Vehicle | null;
  initialStrategy?: BiddingStrategy;
  onSubmitBidRequest: (request: BiddingRequest) => void;
  // Real reverse-auction flow: the buyer already picked a specific real
  // vehicle from live inventory, so Step 1's fake paste-link/catalog-search
  // UI is skipped entirely, and submission goes through a real backend
  // instead of building a client-side-only BiddingRequest.
  lockVehicleSelection?: boolean;
  referenceBrandCode?: string;
  currentUser?: UserProfile | null;
  onRequireLogin?: () => void;
  onRealBidRequestCreated?: (request: BiddingRequest) => void;
}

/** One alternate-vehicle slot in Step 1 — resolved via the same real factory-build import as the primary VIN. */
/** Placeholder shared by the primary and alternate vehicle boxes. */
const VEHICLE_INPUT_PLACEHOLDER = "Dealership link to exact vehicle";

/** Which Step 1 box a link confirmation belongs to. */
type VehicleSlot = "primary" | "alt1" | "alt2";

/**
 * A pasted link, waiting on the buyer. We never fetch the page: the desk
 * came from the hostname and the contacts on file, the VIN from the URL
 * text (or the buyer), and the car is then built from the VIN alone.
 */
type PendingLink =
  | {
      kind: "link";
      slot: VehicleSlot;
      resolution: Extract<LinkResolution, { ok: true }>;
      /** Built from the URL's VIN while the panel opened, so the store the VIN names is known before the buyer confirms. */
      prebuilt: PasteImportSuccess | null;
    }
  | { kind: "pick_dealer"; slot: VehicleSlot };

function deskLine(d: DeskMatch | null | undefined): string {
  if (!d) return "";
  const where = deskLocationLine(d);
  return where ? `${d.dealerName} · ${where}` : d.dealerName;
}

/** Search-by-name-and-ZIP over the contacts on file. Path/slug words only ever seed the box. */
function DealerPicker({
  candidates,
  zipHint,
  onPick,
  onCancel,
}: {
  candidates: DeskMatch[];
  /** The buyer's ZIP when known — narrows the search by state. The name box always starts empty. */
  zipHint?: string | null;
  onPick: (desk: DeskMatch) => void;
  onCancel?: () => void;
}) {
  const [q, setQ] = useState("");
  const [zip, setZip] = useState(zipHint && /^\d{5}$/.test(zipHint) ? zipHint : "");
  const [results, setResults] = useState<DeskMatch[]>(candidates);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const runSearch = async () => {
    if (q.trim().length < 2) return;
    setSearching(true);
    const hits = await searchDealers(q, zip);
    setResults(hits);
    setSearched(true);
    setSearching(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder="Dealership name"
          className="w-full rounded-lg border border-border bg-background py-2 px-3 text-[11px] text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
        />
        <input
          type="text"
          inputMode="numeric"
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="ZIP"
          className="w-20 shrink-0 rounded-lg border border-border bg-background py-2 px-3 text-[11px] text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={searching || q.trim().length < 2}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-[11px] font-bold text-ink-light hover:border-emerald-500 hover:text-white transition-all disabled:opacity-50"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>
      {results.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {results.map((d) => (
            <li key={d.deskId}>
              <button
                type="button"
                onClick={() => onPick(d)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-elevated"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-semibold text-white">{d.dealerName}</span>
                  <span className="block truncate text-[10px] text-ink-muted">{deskLocationLine(d) || "Location not on file"}</span>
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    d.knownNamed ? "bg-emerald-500/15 text-emerald-300" : "bg-border text-ink-muted"
                  }`}
                >
                  {d.knownNamed ? "Contact on file" : "No sales contact"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : searched ? (
        <p className="text-[10px] text-ink-muted">No dealership by that name{zip ? " near that ZIP" : ""}. Try fewer words.</p>
      ) : null}
      {onCancel ? (
        <button type="button" onClick={onCancel} className="text-[10px] font-bold text-ink-muted hover:text-white">
          Cancel
        </button>
      ) : null}
    </div>
  );
}

/**
 * Paste → match → VIN → confirm. The dealership is settled from the VIN
 * first (our inventory, then the window sticker); the link's hostname is
 * only the fallback, and neither overwrites the other silently. When both
 * come up empty the panel says so instead of inventing a store — the
 * picker is there for the buyer, not for us to guess with.
 */
function LinkConfirmPanel({
  pending,
  busy,
  error,
  zipHint,
  onConfirm,
  onCancel,
}: {
  pending: Extract<PendingLink, { kind: "link" }>;
  busy: boolean;
  error: string | null;
  zipHint?: string | null;
  onConfirm: (choice: { vin: string; desk: DeskMatch | null; deskSource: "listing_domain" | "buyer_picked" }) => void;
  onCancel: () => void;
}) {
  const r = pending.resolution;
  const [vin, setVin] = useState(r.vinFromUrl || "");
  const cleanVin = vin.trim().toUpperCase();
  // What the VIN itself said about the store — only valid for the VIN it was built for.
  const vinDealer =
    pending.prebuilt && pending.prebuilt.vehicle.vin === cleanVin && hasVinResolvedDealer(pending.prebuilt.vehicle)
      ? pending.prebuilt.vehicle.location
      : null;
  const [picked, setPicked] = useState<DeskMatch | null>(null);
  const [picking, setPicking] = useState(false);
  const linkDesk = r.desk;
  const shown: { name: string; where: string; note: string; tone: "vin" | "link" | "picked" } | null = picked
    ? { name: picked.dealerName, where: deskLocationLine(picked), note: "picked by you", tone: "picked" }
    : vinDealer
      ? {
          name: vinDealer.dealerName,
          where: [vinDealer.city, vinDealer.state].filter(Boolean).join(", "),
          note: dealerSourceLabel(vinDealer.dealerSource),
          tone: "vin",
        }
      : linkDesk
        ? {
            name: linkDesk.dealerName,
            where: deskLocationLine(linkDesk),
            note: r.via === "redirect" ? "from the listing link (the site's former address is on file)" : "from the listing link",
            tone: "link",
          }
        : null;
  const contactNote = picked
    ? picked.knownNamed
    : shown?.tone === "link" && linkDesk
      ? linkDesk.knownNamed
      : null;
  const pick = (d: DeskMatch) => {
    setPicked(d);
    setPicking(false);
  };
  return (
    <div className="space-y-3 rounded-xl border border-sky-500/40 bg-sky-950/20 px-3.5 py-3 text-[11px] animate-fadeIn">
      <div className="flex items-start justify-between gap-3">
        <p className="font-bold text-sky-200">Confirm the vehicle and the dealership</p>
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold text-sky-300 hover:text-white"
        >
          <ExternalLink className="h-3 w-3" />
          Open the listing
        </a>
      </div>

      <div className="space-y-1">
        <label className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">
          VIN{" "}
          {r.vinFromUrl ? (
            <span className="font-normal normal-case text-ink-muted">— read from the link, check it matches the page</span>
          ) : (
            <span className="font-normal normal-case text-ink-muted">— copy it from the listing</span>
          )}
        </label>
        <input
          type="text"
          value={vin}
          onChange={(e) => setVin(e.target.value)}
          placeholder="17-character VIN"
          maxLength={17}
          className="w-full rounded-lg border border-border bg-background py-2 px-3 font-mono text-[11px] uppercase text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Dealership</p>
        {shown && !picking ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[11px] text-ink-light">
                We&apos;ll send this to <span className="font-semibold text-white">{shown.name}</span>
                {shown.where ? <span className="text-ink-muted"> · {shown.where}</span> : null}
              </span>
              <span className="block text-[10px] text-ink-muted">
                <span className={shown.tone === "vin" ? "text-emerald-300" : shown.tone === "picked" ? "text-sky-300" : "text-amber-300"}>
                  {shown.note}
                </span>
                {contactNote === true ? <span className="text-emerald-300"> · sales contact on file</span> : null}
                {contactNote === false ? <span className="text-amber-300"> · no named sales contact on file yet</span> : null}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-sky-300 hover:text-white"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {!shown ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2">
                <p className="text-[11px] font-bold text-amber-200">Dealer not found</p>
                <p className="text-[10px] leading-snug text-amber-200/90">
                  {cleanVin.length === 17
                    ? `We couldn't match ${r.host} to a store on file, and the factory record for this VIN names none. Search for the dealership by name below, or add the car without one.`
                    : `We couldn't match ${r.host} to a store on file. Enter the VIN, or search for the dealership by name below.`}
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-amber-200">
                {r.candidates.length > 1 ? "That site is shared by more than one store — pick yours." : "Pick the right store."}
              </p>
            )}
            <DealerPicker
              candidates={r.candidates}
              zipHint={zipHint}
              onPick={pick}
              onCancel={shown ? () => setPicking(false) : undefined}
            />
          </div>
        )}
      </div>

      <p className="text-[10px] leading-snug text-ink-faint">
        We don&apos;t read the dealer&apos;s page. The build comes from the factory record for this VIN; you&apos;re
        vouching that this VIN at this store is the car.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            onConfirm(
              picked
                ? { vin: cleanVin, desk: picked, deskSource: "buyer_picked" }
                : { vin: cleanVin, desk: linkDesk, deskSource: "listing_domain" }
            )
          }
          disabled={busy || !isPlausibleVin(cleanVin)}
          className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-[11px] font-black text-black hover:bg-emerald-400 transition-all disabled:opacity-50"
        >
          {busy ? "Adding…" : shown ? "Confirm & add" : "Add without a dealership"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3.5 py-1.5 text-[11px] font-bold text-ink-light hover:border-rose-500 hover:text-white transition-all"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}

function AlternateVinField({
  label,
  value,
  onChange,
  onImport,
  vehicle,
  error,
  parsing,
  onRemove,
  onChangeDealer,
  primary,
  mustHaves,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onImport: () => void;
  vehicle: Vehicle | null;
  error: string | null;
  parsing: boolean;
  onRemove: () => void;
  onChangeDealer?: () => void;
  /** The favorite and the buyer's must-haves — what the alternate is measured against. */
  primary?: Vehicle | null;
  mustHaves?: MustHaveRef[];
}) {
  if (vehicle) {
    const report = primary ? mustHaveReport(mustHaves || [], vehicle) : null;
    const chips = primary ? diffVsPrimary(primary, vehicle, mustHaves || []) : [];
    return (
      <div
        className={`rounded-xl border px-3 py-2.5 ${
          vehicle.buildConfidence === "dealer_listing_only"
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-emerald-500/40 bg-emerald-500/5"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase text-emerald-400">
            {label} — added
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] tracking-wide ${
                vehicle.buildConfidence === "dealer_listing_only"
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {vehicle.buildConfidence === "dealer_listing_only" ? "Unconfirmed build" : "Factory verified"}
            </span>
          </p>
          <p className="text-xs text-white font-semibold truncate">
            {[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ")}
          </p>
          <p className="truncate text-[10px] text-ink-muted">
            <span className="font-mono">{vehicle.vin}</span>
            {vehicle.location?.dealerName ? (
              <>
                {" · "}
                {vehicle.location.dealerName}
                {dealerSourceLabel(vehicle.location.dealerSource) ? (
                  <span className={vehicle.location.dealerSource === "window_sticker" ? "text-amber-300/90" : "text-ink-faint"}>
                    {" "}
                    ({dealerSourceLabel(vehicle.location.dealerSource)})
                  </span>
                ) : null}
              </>
            ) : (
              <span className="font-bold text-amber-300"> · Dealer not found</span>
            )}
            {onChangeDealer ? (
              <>
                {" · "}
                <button type="button" onClick={onChangeDealer} className="font-bold text-sky-300 hover:text-white">
                  {vehicle.location?.dealerName ? "Change dealer" : "Pick dealer"}
                </button>
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label.toLowerCase()}`}
          className="shrink-0 text-ink-muted hover:text-rose-400 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        </div>
        {report ? (
          <div className="mt-2 space-y-1 border-t border-border/60 pt-2" data-testid="alternate-compare">
            <p
              className={`text-[11px] font-bold ${
                report.kind === "scored"
                  ? report.missing.length === 0
                    ? "text-emerald-300"
                    : "text-amber-200"
                  : "text-ink-muted"
              }`}
            >
              {mustHaveHeadline(report)}
              {report.kind === "scored" ? <span className="font-normal text-ink-faint"> vs your favorite</span> : null}
            </p>
            {report.kind === "scored" && report.total > 1 ? (
              <div className="flex flex-wrap gap-1">
                {report.hits.map((h) => (
                  <span
                    key={h.name}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      h.present ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/20 text-amber-200 line-through decoration-amber-400/70"
                    }`}
                  >
                    {h.present ? "✓ " : "✕ "}
                    {h.name}
                  </span>
                ))}
              </div>
            ) : null}
            {chips.length > 0 ? (
              <p className="text-[10px] leading-snug text-ink-muted">
                {chips.map((c, i) => (
                  <span key={`${c.kind}-${c.text}`}>
                    {i > 0 ? " · " : ""}
                    <span className={c.kind === "missing" ? "text-amber-300" : c.kind === "different" ? "text-ink-light" : c.kind === "extra" ? "text-sky-300" : ""}>
                      {c.text}
                    </span>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-bold uppercase text-ink-faint">{label} (optional)</span>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={VEHICLE_INPUT_PLACEHOLDER}
          className="w-full rounded-lg border border-border bg-background py-2 px-3 text-[11px] text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onImport}
          disabled={parsing || !value.trim()}
          className="rounded-lg border border-border px-3.5 py-2 text-[11px] font-bold text-ink-light hover:border-emerald-500 hover:text-white transition-all disabled:opacity-50 shrink-0"
        >
          {parsing ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}

export const BiddingWizard: React.FC<BiddingWizardProps> = ({
  isOpen,
  onClose,
  preselectedVehicle,
  initialStrategy = "flexible_discount",
  onSubmitBidRequest,
  lockVehicleSelection,
  referenceBrandCode,
  currentUser,
  onRequireLogin,
  onRealBidRequestCreated,
}) => {
  const [step, setStep] = useState<number>(1);
  const [, setStrategy] = useState<BiddingStrategy>(initialStrategy);

  const [dealerUrlInput, setDealerUrlInput] = useState<string>("");
  const [isParsingLink, setIsParsingLink] = useState<boolean>(false);
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [factoryBuildOem, setFactoryBuildOem] = useState<FactoryBuildOem | null>(null);
  const [fordStickerStatus, setFordStickerStatus] = useState<"released" | "unreleased" | "error" | null>(null);
  const [fordPdfUrl, setFordPdfUrl] = useState<string | null>(null);
  const [fordFilterableOptions, setFordFilterableOptions] = useState<FilterableFactoryOption[]>([]);
  const [niceToHavePackages, setNiceToHavePackages] = useState<string[]>([]);
  const [huntZip, setHuntZip] = useState("");
  const [huntRadius, setHuntRadius] = useState("");
  // Alternate vehicles are optional, so Step 1 keeps them behind a link
  // until asked for — or auto-reveals them once one is actually imported.
  const [showAlternates, setShowAlternates] = useState(false);

  // Up to 2 alternate vehicles to ride along with the primary in the same
  // offer (see lib/offerCompare.ts's collectDealVehicles, which already
  // caps a deal at 3 vehicles total — this just finally feeds it real
  // ones instead of the hardcoded empty array the wizard used before).
  // Each resolves through the same real factory-build import as the
  // primary, so the compare page can show real specs/photos for them too.
  const [altVin1, setAltVin1] = useState("");
  const [altVehicle1, setAltVehicle1] = useState<Vehicle | null>(null);
  const [altParsing1, setAltParsing1] = useState(false);
  const [altError1, setAltError1] = useState<string | null>(null);
  const [altVin2, setAltVin2] = useState("");
  const [altVehicle2, setAltVehicle2] = useState<Vehicle | null>(null);
  const [altParsing2, setAltParsing2] = useState(false);
  const [altError2, setAltError2] = useState<string | null>(null);
  // A pasted link waiting on the buyer's confirmation — one at a time.
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Set when the buyer explicitly chooses to skip the multi-dealer auction
  // and send a single, anonymized offer straight to the favorite vehicle's
  // dealer instead (only offered when no secondary vehicles are attached).
  const [directOfferMode, setDirectOfferMode] = useState(false);
  const [offerPath, setOfferPath] = useState<"direct" | "auction" | null>(null);

  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(preselectedVehicle || null);

  // Custom/Flexible Spec Fields
  const [make, setMake] = useState<string>("BMW");
  const [model, setModel] = useState<string>("3 Series");
  const [selectedTrims, setSelectedTrims] = useState<string[]>(["330i M Sport", "330i xDrive"]);
  const [mustHavePackages, setMustHavePackages] = useState<string[]>(["M Sport Package", "Premium Package"]);

  // Trade-in is now just a yes/no flag collected here — the actual
  // appraisal (value, photos, condition) happens later, once a selling
  // price is agreed with the dealer (see the note shown when this is on).
  const [hasTradeIn, setHasTradeIn] = useState<boolean>(false);
  const [financingSource, setFinancingSource] = useState<"buyer_own" | "dealer" | null>(null);

  // The flag itself is real and worth sending — the Deal Tracker shows and
  // lets the buyer toggle it after the fact. Every detail field beyond the
  // flag stays honestly empty/zero rather than a fabricated value, since
  // that appraisal genuinely hasn't happened yet.
  const tradeInForRequest: TradeInVehicle | undefined = hasTradeIn
    ? { hasTradeIn: true, year: 0, make: "", model: "", trim: "", mileage: 0, condition: "good", estimatedValueMin: 0, estimatedValueMax: 0, photos: [] }
    : undefined;

  // Step 1: independently checked cash / finance / lease (at least one required)
  const [requestedStructures, setRequestedStructures] = useState<DealStructureMethod[]>(["cash"]);
  const paymentMethod = paymentMethodFromStructures(requestedStructures);
  const financeTerm = 60;
  const downPayment = 5000;
  const leaseMileage = 12000;
  const leaseTerm = 36;

  // Financial & Geographic fields
  const [targetOtdPrice, setTargetOtdPrice] = useState<number>(52000);
  // Who sets the price: the dealer quotes their own best OTD (blind bid, no
  // targetOtdPrice sent), or the buyer names a firm target the dealer can
  // accept or counter. Defaults follow chooseDirectOffer/chooseMultiDealer
  // below — direct offers used to always send targetOtdPrice silently, and
  // the auction path never did; this just makes that choice visible and
  // buyer-editable instead of flipping the previous defaults.
  const [pricingChoice, setPricingChoice] = useState<"dealer_names" | "buyer_names">("dealer_names");
  const [buyerZip, setBuyerZip] = useState<string>("94107");
  // The picker's ZIP assist — only a ZIP the buyer actually entered, never the default.
  const buyerZipHint =
    buyerZip && buyerZip !== "94107" && /^\d{5}$/.test(buyerZip) ? buyerZip : huntZip && /^\d{5}$/.test(huntZip) ? huntZip : null;
  const [searchRadius, setSearchRadius] = useState<number>(100);
  // Checked by default — buyer can uncheck to widen the match to any state
  // within the radius, per Step 1's location controls.
  const [sameStateOnly, setSameStateOnly] = useState<boolean>(true);
  // Minted once when the wizard mounts; the same number on the review screen,
  // in the stored deal, and on the confirmation.
  const [dealReference] = useState<string>(() => newDealReference());
  const [isSubmittingReal, setIsSubmittingReal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 5: optional free-text note to the dealer. Real-time-checked for
  // contact info (email/phone/link/handle) — the masked-identity system
  // only holds if a buyer can't just paste it in here; server-side
  // (app/api/deal-requests and the box) re-checks authoritatively.
  const [dealComment, setDealComment] = useState("");
  const dealCommentContactWarning = findContactInfo(dealComment);

  // Step 3: how soon the buyer wants to close — round-trips through the
  // existing deal_structure_json blob, no new column needed.
  const [purchaseTimeline, setPurchaseTimeline] = useState<PurchaseTimeline | "">("");

  // Real deal_requests.id, shown as a confirmation once a real submission
  // (broadcast or direct offer) succeeds.
  const [createdDealId, setCreatedDealId] = useState<string | null>(null);
  const handleCloseConfirmation = () => {
    setCreatedDealId(null);
    onClose();
  };

  useEffect(() => {
    if (preselectedVehicle) {
      setSelectedVehicle(preselectedVehicle);
      setMake(preselectedVehicle.make);
      setModel(preselectedVehicle.model);
      setSelectedTrims([preselectedVehicle.trim]);
      setMustHavePackages(preselectedVehicle.packages);
      setTargetOtdPrice(Math.round(preselectedVehicle.msrp * 0.92));
      // Mirrors handleParseDealerUrl's success state — a preselected vehicle
      // (e.g. from the factory-match flow) already has a confirmed build, so
      // Step 1's "already imported" preview and must-have picker should show
      // immediately instead of leaving the paste-a-VIN box stuck open.
      setParseSuccessMsg(`${preselectedVehicle.year} ${preselectedVehicle.make} ${preselectedVehicle.trim} — confirmed`);
      setFordStickerStatus("released");
      setFordFilterableOptions(
        preselectedVehicle.options.map((o) => ({
          name: o.name,
          code: o.code,
          description: o.name,
          price: o.price,
        }))
      );
    }
  }, [preselectedVehicle, lockVehicleSelection]);

  // 3 steps total: (1) payment + vehicle + trade-in flag, (2) direct offer
  // vs. multi-dealer, (3) review & broadcast. Payment and vehicle selection
  // used to be separate steps and are now merged into step 1.
  const TOTAL_STEPS = 3;
  // Single source of the step's short label — shown once in the header
  // subtitle, not repeated as a "Step N:" prefix inside each step's own
  // heading below.
  const STEP_LABELS = ["Payment & Vehicle", "Dealers & Location", "Review & Send"];
  // Step 1's Continue is blocked until Import Car actually loaded a
  // vehicle — unless a real vehicle was already locked in via
  // lockVehicleSelection, in which case there's nothing to import.
  // Typing a VIN/URL, or merely arriving on this step, is not enough.
  const vehicleImported = Boolean(lockVehicleSelection || (parseSuccessMsg && selectedVehicle));
  const financingSourceMissing = requestedStructures.includes("finance") && financingSource == null;
  const reviewTarget = reviewTargetFromVehicle(selectedVehicle);

  // Step 2 asks "who gets this offer", so it has to name the dealerships the
  // imported vehicles actually sit at rather than say "this dealer" and leave
  // the buyer guessing. Same formatter as step 3's review, so the name, the
  // location line and the not-confirmed caveat all read identically.
  const importedDealerships = [selectedVehicle, altVehicle1, altVehicle2]
    .map((vehicle) => {
      const target = reviewTargetFromVehicle(vehicle);
      const dealerName = target?.dealerName?.trim();
      if (!target || !dealerName) return null;
      // Carry the raw state through too — the contact directory matches on name
      // plus state, since a chain can repeat one name across several of them.
      return { ...target, dealerName, state: (vehicle?.location?.state || "").trim().toUpperCase() };
    })
    .filter((target): target is NonNullable<typeof target> => Boolean(target))
    .filter(
      (target, index, all) =>
        all.findIndex((other) => other.dealerName === target.dealerName) === index
    );

  // Whether each dealership is reachable. Looked up as soon as the vehicles are
  // known, so step 2 can say up front which dealers we have no way to email
  // instead of the buyer finding out after the offer has gone out.
  const [dealerContacts, setDealerContacts] = useState<Record<string, DealerContactStatus>>({});
  // Sales-adviser addresses the buyer supplied for dealerships we have none for.
  const [buyerDealerEmails, setBuyerDealerEmails] = useState<Record<string, string>>({});

  // The v1 core loop's confirm step: who, by name, each quote request goes
  // to. Looked up with the contacts; the buyer confirms (or unticks) each.
  const [quoteDesks, setQuoteDesks] = useState<Record<string, PublicDesk>>({});
  const [confirmedDesks, setConfirmedDesks] = useState<Record<string, boolean>>({});
  // What came back from sending: one row per desk, with its audit stage.
  const [sentPackage, setSentPackage] = useState<{
    rfqId: string;
    rows: Array<{ dealerName: string; stage: QuoteInviteStage | "blocked"; message?: string }>;
  } | null>(null);

  // A primitive key, so the effect re-runs when the dealerships actually change
  // rather than on every render that rebuilds the array above.
  const dealerLookupKey = importedDealerships.map((d) => `${d.dealerName}|${d.state}`).join("~~");

  // With two or more dealerships in the package the direct path *is* the
  // competition — each rooftop bids against the others on the buyer's own
  // cars. Preselect it once, on reaching step 2, so the buyer sees the
  // competition framed and doesn't have to pick "offer this dealer directly"
  // for a request that goes to several.
  const competeAmongImported = importedDealerships.length >= 2;
  // On the direct path the request only goes to confirmed, unblocked desks —
  // every count the buyer sees from step 3 on should be that, not the number
  // of cars pasted.
  // "Only send this to dealerships in my state" gates who receives the
  // package. It only ever holds back desks it can prove are elsewhere, and
  // when that would leave the package short it offers the expand — the
  // buyer is never left with an empty send path.
  const buyerStateFromZip = /^\d{5}$/.test(huntZip.trim()) ? getZipCoordinates(huntZip.trim()).state : "";
  const gatePlan = stateGatePlan(
    buyerStateFromZip,
    importedDealerships.map((d) => ({
      dealerName: d.dealerName,
      state: d.state,
      contactReady: Boolean(quoteDesks[d.dealerName]?.knownNamed && !quoteDesks[d.dealerName]?.blockedReason),
    })),
    sameStateOnly
  );
  const excludedByState = new Set(gatePlan.active ? gatePlan.excludedReady.map((d) => d.dealerName) : []);
  const expandNudge = directOfferMode ? formatExpandNudge(gatePlan) : "";
  const confirmedDeskCount = importedDealerships.filter(
    (d) => confirmedDesks[d.dealerName] && !quoteDesks[d.dealerName]?.blockedReason && !excludedByState.has(d.dealerName)
  ).length;
  const sendToCount = directOfferMode ? confirmedDeskCount : importedDealerships.length;
  useEffect(() => {
    if (step === 2 && offerPath === null && competeAmongImported) {
      chooseDirectOffer();
    }
    // chooseDirectOffer is a stable closure over setters; listing it would
    // re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, offerPath, competeAmongImported]);

  useEffect(() => {
    const dealers = dealerLookupKey
      ? dealerLookupKey.split("~~").map((entry) => {
          const [dealerName, state] = entry.split("|");
          return { dealerName, state };
        })
      : [];
    if (dealers.length === 0) {
      setDealerContacts({});
      return;
    }
    let cancelled = false;
    fetch("/api/dealer-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealers }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.results) return;
        const next: Record<string, DealerContactStatus> = {};
        for (const result of json.results as DealerContactStatus[]) {
          next[result.dealerName] = result;
        }
        setDealerContacts(next);
      })
      .catch(() => {});
    fetch("/api/quote-desks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealers }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.desks) return;
        const next: Record<string, PublicDesk> = {};
        const confirmed: Record<string, boolean> = {};
        for (const desk of json.desks as PublicDesk[]) {
          next[desk.dealerName] = desk;
          // Ticked by default when there's a named person to send to.
          confirmed[desk.dealerName] = !desk.blockedReason;
        }
        setQuoteDesks(next);
        setConfirmedDesks((current) => ({ ...confirmed, ...current }));
      })
      .catch(() => {
        // Silent — the panel stays on "Checking" and the offer is never blocked
        // on a directory that didn't answer.
      });
    return () => {
      cancelled = true;
    };
  }, [dealerLookupKey]);

  // Real dealer responsiveness — computed from actual bid timing on the
  // box, never a fabricated "usually responds within..." default. Fetched
  // as soon as the dealer name is known (not gated to step 3) so it's
  // ready by the time the buyer reaches the review screen.
  const [dealerResponsiveness, setDealerResponsiveness] = useState<DealerResponsivenessStats | null>(null);
  useEffect(() => {
    const dealerName = reviewTarget?.dealerName;
    if (!dealerName) {
      setDealerResponsiveness(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/dealer-responsiveness?dealerName=${encodeURIComponent(dealerName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setDealerResponsiveness(json);
      })
      .catch(() => {
        // Purely a nice-to-have — a failed lookup just shows nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [reviewTarget?.dealerName]);

  // Market context for the buyer's own target price — real, computed from
  // actual bid history, never a fabricated industry number. Shown as
  // information only, not a floor the buyer must beat.
  const [typicalOtd, setTypicalOtd] = useState<TypicalOtdStats | null>(null);
  useEffect(() => {
    const make = selectedVehicle?.make;
    const model = selectedVehicle?.model;
    if (!make || !model) {
      setTypicalOtd(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/typical-otd?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setTypicalOtd(json);
      })
      .catch(() => {
        // Purely a nice-to-have — a failed lookup just shows nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedVehicle?.make, selectedVehicle?.model]);

  const goNext = () => {
    if (step === 1 && (requestedStructures.length === 0 || !vehicleImported || financingSourceMissing || !purchaseTimeline)) return;
    if (step === 2 && (!offerPath || step2LocationMissing || sameStateWarning)) return;
    setStep(step + 1);
  };
  const goBack = () => {
    setStep(step - 1);
  };

  const huntReady = /^\d{5}$/.test(huntZip.trim()) && Number(huntRadius) > 0;
  const huntLocationMissing = !huntReady;
  // Only paint location as a problem once the buyer has started filling it in —
  // an untouched form shouldn't open in an error state. The "(required)" labels
  // and the disabled Continue button already say what's needed.
  const huntLocationInvalid =
    huntLocationMissing && (huntZip.trim() !== "" || huntRadius.trim() !== "");
  // Location only decides anything on the multi-dealer path — /api/dealer-requests
  // skips the distance and same-state filters entirely for a direct (firm_offer)
  // request, so don't hold that path up for a ZIP it will never use.
  const step2LocationMissing = offerPath === "auction" && huntLocationMissing;

  // Same-state applies to every dealer on an auction request, including the one
  // holding the imported car — so a checked box plus an out-of-state listing
  // would hide the request from the dealer who actually has the vehicle.
  const sameStateConflicts = sameStateOnly
    ? outOfStateVehicles(buyerStateFromZip, [selectedVehicle, altVehicle1, altVehicle2])
    : [];
  const sameStateWarning =
    offerPath === "auction" && sameStateConflicts.length > 0
      ? formatOutOfStateWarning(buyerStateFromZip, sameStateConflicts)
      : "";

  /**
   * A pasted link is never fetched. Resolve the desk from its hostname,
   * then park it on the confirm panel for the VIN and the store. Returns
   * true when the paste was a link (and so is now waiting on the buyer).
   */
  const slotVehicles = (slot: VehicleSlot) =>
    slot === "primary" ? [altVehicle1, altVehicle2] : slot === "alt1" ? [selectedVehicle, altVehicle2] : [selectedVehicle, altVehicle1];

  const parkLink = async (slot: VehicleSlot, raw: string): Promise<boolean> => {
    if (classifyPaste(raw).kind !== "url") return false;
    setLinkError(null);
    const resolution = await resolveVdpLink(raw);
    if (!resolution.ok) {
      if (slot === "primary") setParseError(resolution.error);
      else if (slot === "alt1") setAltError1(resolution.error);
      else setAltError2(resolution.error);
      setPendingLink(null);
      return true;
    }
    // Settle the store from the VIN before the buyer sees the panel — the
    // link only gets a say when the VIN has none.
    let prebuilt: PasteImportSuccess | null = null;
    if (resolution.vinFromUrl) {
      const built = await importPastedFactoryVehicle(resolution.vinFromUrl, fetch, { existingVehicles: slotVehicles(slot) });
      if (built.ok) prebuilt = built;
    }
    setPendingLink({ kind: "link", slot, resolution, prebuilt });
    return true;
  };

  /** The buyer confirmed VIN + store: build from the VIN alone and commit to the slot that asked. */
  const confirmLink = async (choice: { vin: string; desk: DeskMatch | null; deskSource: "listing_domain" | "buyer_picked" }) => {
    if (!pendingLink || pendingLink.kind !== "link") return;
    const { slot, resolution, prebuilt } = pendingLink;
    setLinkBusy(true);
    setLinkError(null);
    const result =
      prebuilt && prebuilt.vehicle.vin === choice.vin
        ? prebuilt
        : await importPastedFactoryVehicle(choice.vin, fetch, { existingVehicles: slotVehicles(slot) });
    if (!result.ok) {
      setLinkError(result.error);
      setLinkBusy(false);
      return;
    }
    const vehicle = attachLinkToVehicle(result.vehicle, {
      url: resolution.url,
      desk: choice.desk,
      deskSource: choice.deskSource,
    });
    const stamped: PasteImportSuccess = { ...result, vehicle };
    if (slot === "primary") commitPrimaryImport(stamped);
    else if (slot === "alt1") setAltVehicle1(vehicle);
    else setAltVehicle2(vehicle);
    setPendingLink(null);
    setLinkBusy(false);
  };

  const cancelPendingLink = () => {
    if (!pendingLink) return;
    if (pendingLink.kind === "link") {
      if (pendingLink.slot === "primary") setDealerUrlInput("");
      else if (pendingLink.slot === "alt1") setAltVin1("");
      else setAltVin2("");
    }
    setPendingLink(null);
    setLinkError(null);
  };

  /** "Change" on a committed row: re-pick the store without re-importing the car. */
  const changeDealerFor = (slot: VehicleSlot) => setPendingLink({ kind: "pick_dealer", slot });

  const applyPickedDealer = (desk: DeskMatch) => {
    if (!pendingLink || pendingLink.kind !== "pick_dealer") return;
    const stamp = (v: Vehicle | null): Vehicle | null =>
      v
        ? {
            ...v,
            location: {
              ...v.location,
              dealerName: desk.dealerName,
              city: desk.city || "",
              state: desk.state || "",
              zip: desk.zip || undefined,
              dealerConfirmed: true,
              dealerSource: "buyer_picked",
              deskId: desk.deskId,
            },
          }
        : v;
    if (pendingLink.slot === "primary") setSelectedVehicle(stamp);
    else if (pendingLink.slot === "alt1") setAltVehicle1(stamp);
    else setAltVehicle2(stamp);
    setPendingLink(null);
  };

  const handleParseDealerUrl = async (urlToParse?: string) => {
    const raw = (urlToParse || dealerUrlInput).trim();
    if (!raw) return;
    if (await parkLink("primary", raw)) return;

    setIsParsingLink(true);
    setParseSuccessMsg(null);
    setParseError(null);
    setSelectedVehicle(null);
    setFactoryBuildOem(null);
    setFordStickerStatus(null);
    setFordPdfUrl(null);
    setFordFilterableOptions([]);
    setNiceToHavePackages([]);
    setMustHavePackages([]);

    const result = await importPastedFactoryVehicle(raw, fetch, {
      existingVehicles: [altVehicle1, altVehicle2],
    });
    if (!result.ok) {
      if (result.unreleased) {
        setFactoryBuildOem(result.oem ?? null);
        setFordStickerStatus("unreleased");
        setFordPdfUrl(result.pdfUrl ?? null);
      }
      setParseError(result.error);
      setIsParsingLink(false);
      return;
    }

    commitPrimaryImport(result);
    setIsParsingLink(false);
  };

  const commitPrimaryImport = (result: PasteImportSuccess) => {
    setPendingLink(null);
    setSelectedVehicle(result.vehicle);
    setMake(result.vehicle.make);
    setModel(result.vehicle.model);
    setSelectedTrims([result.vehicle.trim]);
    setMustHavePackages(result.mustHaveLines);
    setNiceToHavePackages(result.niceToHaveLines);
    setFordFilterableOptions(result.filterableOptions);
    setFactoryBuildOem(result.oem);
    // Only a real factory build unlocks the must-have picker; a free-decode
    // import has no option list to choose from.
    setFordStickerStatus(result.factoryBuildUnavailable ? "unreleased" : "released");
    setFordPdfUrl(result.pdfUrl);
    if (result.msrp && result.msrp > 0) {
      setTargetOtdPrice(Math.round(result.msrp * 0.92));
    }
    setParseSuccessMsg(`VIN ${result.vehicle.vin}`);
  };

  // Resolves an alternate VIN/link through the same real import used for
  // the primary vehicle — never a lighter/fake lookup — but never touches
  // the primary's own state (must-haves, selected trim, etc.).
  const handleParseAlt1 = async () => {
    const raw = altVin1.trim();
    if (!raw) return;
    if (await parkLink("alt1", raw)) return;
    setAltParsing1(true);
    setAltError1(null);
    const result = await importPastedFactoryVehicle(raw, fetch, {
      existingVehicles: [selectedVehicle, altVehicle2],
    });
    if (!result.ok) {
      setAltError1(result.error);
      setAltParsing1(false);
      return;
    }
    setPendingLink(null);
    setAltVehicle1(result.vehicle);
    setAltParsing1(false);
  };
  // Lets the buyer swap the primary car out for a different VDP without
  // reopening the wizard. Clears everything the parse populated, so a stale
  // sticker, option list or price can't survive into the next import.
  const clearImportedVehicle = () => {
    setPendingLink(null);
    setSelectedVehicle(null);
    setParseSuccessMsg(null);
    setParseError(null);
    setDealerUrlInput("");
    setFordPdfUrl(null);
    setFordStickerStatus(null);
    setFordFilterableOptions([]);
    setFactoryBuildOem(null);
    setMustHavePackages([]);
    setNiceToHavePackages([]);
  };

  const removeAlt1 = () => {
    setAltVehicle1(null);
    setAltVin1("");
    setAltError1(null);
  };

  const handleParseAlt2 = async () => {
    const raw = altVin2.trim();
    if (!raw) return;
    if (await parkLink("alt2", raw)) return;
    setAltParsing2(true);
    setAltError2(null);
    const result = await importPastedFactoryVehicle(raw, fetch, {
      existingVehicles: [selectedVehicle, altVehicle1],
    });
    if (!result.ok) {
      setAltError2(result.error);
      setAltParsing2(false);
      return;
    }
    setPendingLink(null);
    setAltVehicle2(result.vehicle);
    setAltParsing2(false);
  };
  const removeAlt2 = () => {
    setAltVehicle2(null);
    setAltVin2("");
    setAltError2(null);
  };

  // Every import call passes the package so a duplicate VIN is refused
  // before a network round-trip — whether pasted as a VIN or resolved from a
  // URL. MAX_PACKAGE_VEHICLES is the primary plus the two alternate slots.
  const packageVehicles = () => [selectedVehicle, altVehicle1, altVehicle2];

  const chooseDirectOffer = () => {
    setOfferPath("direct");
    setDirectOfferMode(true);
    setStrategy("firm_offer");
  };

  const chooseMultiDealer = () => {
    setOfferPath("auction");
    setDirectOfferMode(false);
    setStrategy("exact_auction");
    setPricingChoice("dealer_names");
  };

  if (!isOpen) return null;

  if (sentPackage) {
    const sentCount = sentPackage.rows.filter((r) => r.stage !== "blocked").length;
    const stageTone = (stage: QuoteInviteStage | "blocked") =>
      stage === "blocked"
        ? "bg-amber-500/15 text-amber-300"
        : stage === "queued"
          ? "bg-border text-ink-muted"
          : "bg-emerald-500/15 text-emerald-300";
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
        <div className="relative w-full max-w-md rounded-2xl border border-emerald-500/40 bg-surface shadow-2xl p-6 space-y-4 animate-fadeIn">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h2 className="mt-3 text-lg font-black text-white">
              {sentCount === 0 ? "Nothing was sent" : `Quote request sent to ${sentCount} desk${sentCount === 1 ? "" : "s"}`}
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Each desk replies on its own time. We&apos;ll show every quote as it comes in — pick one, or walk away.
            </p>
          </div>
          <ul className="space-y-1.5">
            {sentPackage.rows.map((row) => (
              <li key={row.dealerName} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-ink-light">{row.dealerName}</div>
                  {row.message ? <div className="text-[10px] leading-snug text-ink-muted">{row.message}</div> : null}
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${stageTone(row.stage)}`}>
                  {row.stage === "blocked" ? "Not sent" : INVITE_STAGE_LABELS[row.stage]}
                </span>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border border-border bg-surface-elevated py-3 text-center">
            <div className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">Quote request</div>
            <div className="text-xl font-mono font-black text-emerald-400">{dealReference}</div>
            <div className="mt-0.5 text-[10px] font-mono text-ink-faint">ref #{sentPackage.rfqId}</div>
          </div>
          <p className="text-[10px] leading-snug text-ink-faint">{NON_BINDING_COPY}</p>
          <div className="flex gap-2">
            <a
              href={`/rfq/${sentPackage.rfqId}`}
              className="flex-1 rounded-xl border border-border py-2.5 text-center text-xs font-bold text-ink-light hover:text-white hover:border-border-strong transition-colors"
            >
              Track this request
            </a>
            <button
              onClick={onClose}
              className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (createdDealId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
        <div className="relative w-full max-w-md rounded-2xl border border-emerald-500/40 bg-surface shadow-2xl p-6 space-y-4 text-center animate-fadeIn">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">
              {directOfferMode
                ? competeAmongImported
                  ? "Your quote request is out"
                  : "Your quote request has been sent"
                : "Your quote request is out"}
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              {directOfferMode && competeAmongImported
                ? `${importedDealerships.length} dealerships have your request. Each replies with a quote on its own time.`
                : directOfferMode
                  ? `${selectedVehicle?.location.dealerName ?? "The dealer"} has your request and will reply with a quote.`
                  : "Dealers near you have your request and reply with quotes on their own time."}
            </p>
          </div>
          {/* The same number the buyer saw on the review screen. The backend's
              own id is kept alongside for support, smaller, since a buyer
              quoting "TS-K7M3Q2" and one quoting "#118" must both be findable. */}
          <div className="rounded-xl border border-border bg-surface-elevated py-3">
            <div className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">Deal Number</div>
            <div className="text-2xl font-mono font-black text-emerald-400">{dealReference}</div>
            <div className="mt-0.5 text-[10px] font-mono text-ink-faint">ref #{createdDealId}</div>
          </div>
          <button
            onClick={handleCloseConfirmation}
            className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const toggleTrim = (trim: string) => {
    if (selectedTrims.includes(trim)) {
      if (selectedTrims.length > 1) {
        setSelectedTrims(selectedTrims.filter((t) => t !== trim));
      }
    } else {
      setSelectedTrims([...selectedTrims, trim]);
    }
  };

  // The buyer's picks, with the favorite's factory codes attached so an
  // alternate that spells an option differently still scores by code.
  const selectedMustHaveRefs: MustHaveRef[] = mustHavePackages.map((name) => ({
    name,
    code: fordFilterableOptions.find((o) => o.name === name)?.code || null,
  }));

  const toggleFordMustHave = (name: string) => {
    setMustHavePackages((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
    setNiceToHavePackages((prev) => prev.filter((p) => p !== name));
  };

  const launchStrategy: BiddingStrategy =
    directOfferMode || offerPath === "direct" ? "firm_offer" : "exact_auction";

  const dealVehicles = collectDealVehicles(selectedVehicle, []);
  const otherLotsForDeal: Vehicle[] = [altVehicle1, altVehicle2].filter((v): v is Vehicle => v != null);

  const vehicleTermsForDeal = defaultTermsForVehicles(dealVehicles, {
      requestedStructures,
      financeTermMonths: financeTerm,
      downPayment,
      leaseMileagePerYear: leaseMileage,
      leaseTermMonths: leaseTerm,
    }
  );

  const buildBiddingRequest = (overrides: Partial<BiddingRequest> = {}): BiddingRequest => ({
    id: `req-${Date.now()}`,
    strategy: launchStrategy,
    targetVin: selectedVehicle?.vin,
    targetVehicle: selectedVehicle || undefined,
    otherLots: otherLotsForDeal,
    flexibleCriteria: {
      make: selectedVehicle?.make || "",
      model: selectedVehicle?.model || "",
      trims: selectedVehicle?.trim ? [selectedVehicle.trim] : [],
      minMsrp: selectedVehicle ? Math.round(selectedVehicle.msrp * 0.9) : undefined,
      maxMsrp: selectedVehicle ? Math.round(selectedVehicle.msrp * 1.1) : undefined,
      mustHavePackages,
      preferredColors: [],
      dealbreakers: [],
      allowedStatuses: ["on_lot", "in_transit"],
    },
    tradeIn: tradeInForRequest,
    buyerComment: dealComment.trim() || undefined,
    targetOtdPrice: pricingChoice === "buyer_names" ? targetOtdPrice : undefined,
    paymentMethod,
    dealStructurePreferences: {
      requestedStructures,
      financeTermMonths: financeTerm,
      downPayment,
      ...(requestedStructures.includes("finance") && financingSource ? { financingSource } : {}),
      leaseMileagePerYear: leaseMileage,
      leaseTermMonths: leaseTerm,
      vehicleTerms: vehicleTermsForDeal,
      purchaseTimeline: purchaseTimeline || undefined,
    },
    buyerZip,
    searchRadiusMiles: searchRadius,
    sameStateOnly,
    createdAt: "Just now",
    expiresAt: "48 Hours",
    status: "active",
    directOffer: directOfferMode,
    ...overrides,
  });

  const openComparePage = (request: BiddingRequest) => {
    const snapshot = buildOfferCompareSnapshot({
      request,
      favorite: selectedVehicle,
      otherLots: otherLotsForDeal,
      buyerZip,
      requestedStructures,
      mustHaveLines: mustHavePackages,
      niceToHaveLines: niceToHavePackages,
      searchRadiusMiles: searchRadius,
    });
    if (snapshot) {
      saveOfferCompareSnapshot(snapshot);
      upsertShopperRequest(snapshot.request);
    } else {
      upsertShopperRequest(request);
    }
    // v1 has no market-comparables page to land on; the tracker (which the
    // page switches to on submit) is where the request lives now.
    onClose();
  };

  const sendQuoteRequestPackage = async () => {
    if (!selectedVehicle) return;
    const vehicles = [selectedVehicle, altVehicle1, altVehicle2].filter((v): v is Vehicle => Boolean(v)).slice(0, MAX_PACKAGE_LINKS);
    const pastes: DealerLinkPaste[] = vehicles.map((v) => ({
      raw: v.dealerUrl || v.vin,
      kind: v.dealerUrl ? "url" : "vin",
      vin: v.vin,
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim,
      dealerName: v.location?.dealerName?.trim() || null,
      dealerState: v.location?.state?.trim().toUpperCase() || null,
      vdpUrl: v.dealerUrl || null,
      buildConfidence: v.buildConfidence || "dealer_listing_only",
      resolvedAt: new Date().toISOString(),
    }));
    const toSend = pastes.filter(
      (p) => p.dealerName && confirmedDesks[p.dealerName] && !quoteDesks[p.dealerName]?.blockedReason && !excludedByState.has(p.dealerName)
    );
    if (toSend.length === 0) {
      setSubmitError("Tick at least one dealership with a named sales contact to send the request.");
      return;
    }

    setIsSubmittingReal(true);
    setSubmitError(null);
    try {
      const primary = pastes[0];
      const res = await fetch("/api/rfqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageKind: "links",
          vin: primary.vin,
          vehicleYear: primary.year,
          vehicleMake: primary.make,
          vehicleModel: primary.model,
          vehicleTrim: primary.trim,
          stockNumber: null,
          linkPastes: pastes,
          dealReference,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.rfq?.id) {
        setSubmitError(json.error || "Could not create your quote request.");
        return;
      }
      const rfqId = String(json.rfq.id);

      // Invites go one at a time so a per-desk or sister-store block on one
      // never blocks the others, and each row reports its own outcome.
      const rows: Array<{ dealerName: string; stage: QuoteInviteStage | "blocked"; message?: string }> = [];
      for (const paste of pastes) {
        const name = paste.dealerName || "";
        if (!name || !toSend.includes(paste)) {
          rows.push({ dealerName: name || paste.vin, stage: "blocked", message: quoteDesks[name]?.blockedMessage || "Not sent." });
          continue;
        }
        const r = await fetch(`/api/rfqs/${rfqId}/invites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealerName: name,
            dealerState: paste.dealerState,
            buyerProvidedEmail: buyerDealerEmails[name] || undefined,
            requestedStructures,
            purchaseTimelineLabel:
              purchaseTimeline === "asap" ? "ASAP" : purchaseTimeline === "this_week" ? "Within the week" : purchaseTimeline === "this_month" ? "Within the month" : null,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.invite) {
          rows.push({ dealerName: name, stage: inviteStage(j.invite as RfqInvite) });
        } else {
          rows.push({ dealerName: name, stage: "blocked", message: j.error || "Could not send." });
        }
      }
      setSentPackage({ rfqId, rows });
    } catch {
      setSubmitError("Couldn't reach the server. Your request wasn't sent — try again.");
    } finally {
      setIsSubmittingReal(false);
    }
  };

  const handleLaunchDeal = async () => {
    if (dealCommentContactWarning) {
      setSubmitError(`Your comment appears to contain ${dealCommentContactWarning} — remove it before submitting.`);
      return;
    }
    if (pricingChoice === "buyer_names" && !(targetOtdPrice > 0)) {
      setSubmitError("Enter your target out-the-door price, or switch to letting the dealer name their price.");
      return;
    }
    if (!purchaseTimeline) {
      setSubmitError("Select your purchase timeline.");
      return;
    }
    if (!currentUser) {
      onClose();
      onRequireLogin?.();
      return;
    }
    if (!selectedVehicle) return;

    // The v1 core loop. A direct request becomes a Quote Request Package:
    // one RFQ of kind "links", one invite per confirmed desk, each sent as it
    // is created. Nothing here is a bid, and there is no target price.
    if (directOfferMode) {
      await sendQuoteRequestPackage();
      return;
    }

    setIsSubmittingReal(true);
    setSubmitError(null);
    let launched: BiddingRequest | null = null;
    try {
      const res = await fetch("/api/deal-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: launchStrategy,
          referenceBrandCode: referenceBrandCode || brandCodeFromMake(selectedVehicle.make),
          referenceVin: selectedVehicle.vin,
          referenceYear: selectedVehicle.year,
          referenceMake: selectedVehicle.make,
          referenceModel: selectedVehicle.model,
          referenceTrim: selectedVehicle.trim,
          referencePrice: selectedVehicle.dealerPrice,
          referenceMsrp: selectedVehicle.msrp,
          referenceImageUrl: selectedVehicle.imageUrl,
          targetOtdPrice: pricingChoice === "buyer_names" ? targetOtdPrice : undefined,
          paymentMethod,
          dealStructure: shopperDealStructurePayload({
            requestedStructures,
            financeTermMonths: financeTerm,
            downPayment,
            financingSource: financingSource || undefined,
            leaseMileagePerYear: leaseMileage,
            leaseTermMonths: leaseTerm,
            directOffer: directOfferMode,
            vehicle: selectedVehicle,
            mustHavePackages,
            otherLots: otherLotsForDeal,
            vehicleTerms: vehicleTermsForDeal,
            purchaseTimeline: purchaseTimeline || undefined,
            buyerProvidedDealerEmails: buyerDealerEmails,
            dealReference,
          }),
          // See tradeInForRequest above — the flag only, honestly empty
          // detail fields, no appraisal fabricated.
          tradeIn: tradeInForRequest,
          buyerZip,
          searchRadiusMiles: searchRadius,
          sameStateOnly,
          buyerComment: dealComment.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.dealRequest) {
        const dr = json.dealRequest as Record<string, unknown>;
        const local = buildBiddingRequest({
          id: String(dr.id),
          strategy: (dr.strategy as BiddingRequest["strategy"]) || launchStrategy,
          targetVin: typeof dr.referenceVin === "string" ? dr.referenceVin : selectedVehicle.vin,
          paymentMethod: (dr.paymentMethod as BiddingRequest["paymentMethod"]) || paymentMethod,
          buyerZip: typeof dr.buyerZip === "string" ? dr.buyerZip : buyerZip,
          buyerState: typeof dr.buyerState === "string" ? dr.buyerState : undefined,
          searchRadiusMiles:
            typeof dr.searchRadiusMiles === "number" ? dr.searchRadiusMiles : searchRadius,
          sameStateOnly: dr.sameStateOnly !== false,
          buyerComment: typeof dr.buyerComment === "string" ? dr.buyerComment : undefined,
          createdAt: typeof dr.createdAt === "string" ? dr.createdAt : "Just now",
          expiresAt: typeof dr.expiresAt === "string" ? dr.expiresAt : "48 Hours",
          status: dr.status === "locked" || dr.status === "expired" ? dr.status : "active",
          directOffer: directOfferMode,
        });
        launched = mapDealRequestJson(dr, local);
        onRealBidRequestCreated?.(launched);
      } else if (res.status !== 401 && res.status !== 502 && res.status !== 503) {
        setSubmitError(json.error || "Could not submit your request.");
        return;
      }
    } catch {
      // Deals backend unreachable — still open the compare page with the local snapshot.
    } finally {
      setIsSubmittingReal(false);
    }
    if (!launched) {
      launched = buildBiddingRequest();
      onSubmitBidRequest(launched);
    }
    openComparePage(launched);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <Zap className="h-4 w-4 fill-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Configure Quote Request</h2>
              <p className="text-xs text-ink-muted">Step {step} of {TOTAL_STEPS} • {STEP_LABELS[step - 1]}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-border hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Wizard Body */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* ========================================================================= */}
          {/* STEP 1: PAYMENT, VEHICLE & TRADE-IN FLAG                                   */}
          {/* ========================================================================= */}
          {step === 1 && (
            <div className="divide-y divide-border/50">
              {/* ---------------------------------------------------------- */}
              {/* Payment                                                     */}
              {/* ---------------------------------------------------------- */}
              <WizardSection
                title="Payment"
                hint="Payment shapes every quote dealers send you — pick all that apply."
                className="pb-6"
              >
                <div className="flex flex-wrap gap-2">
                  {/* Display order only (Finance, Lease, Cash) — the
                      underlying DEAL_STRUCTURE_METHODS order stays
                      Cash/Finance/Lease since formatDealStructures and
                      paymentMethodFromStructures rely on it elsewhere. */}
                  {(["finance", "lease", "cash"] as const).map((id) => {
                    const isChecked = requestedStructures.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={isChecked}
                        onClick={() => setRequestedStructures((current) => toggleDealStructure(current, id))}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all ${
                          isChecked
                            ? "border-emerald-500 bg-emerald-500/10 text-white"
                            : "border-border text-ink-light hover:border-border-strong"
                        }`}
                      >
                        {isChecked && <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />}
                        {DEAL_STRUCTURE_LABELS[id]}
                      </button>
                    );
                  })}
                </div>

                {requestedStructures.length === 0 && (
                  <p className="text-[11px] text-rose-400">Select at least one payment method to continue.</p>
                )}

                {requestedStructures.includes("finance") && (
                  <div className="rounded-xl border border-border bg-surface-elevated p-3.5 space-y-2">
                    <span className="text-[11px] font-semibold text-ink-light">Who&apos;s financing this?</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] cursor-pointer transition-colors ${
                          financingSource === "buyer_own"
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-border hover:border-border-strong"
                        }`}
                      >
                        <input
                          type="radio"
                          name="financingSource"
                          checked={financingSource === "buyer_own"}
                          onChange={() => setFinancingSource("buyer_own")}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500 focus:ring-0"
                        />
                        <span>
                          <span className="block font-semibold text-ink-light">I&apos;ll bring my own financing</span>
                          <span className="block text-ink-muted text-[11px] mt-0.5">
                            A bank or credit union pre-approval — dealers quote you an out-the-door price only.
                          </span>
                        </span>
                      </label>
                      <label
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] cursor-pointer transition-colors ${
                          financingSource === "dealer"
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-border hover:border-border-strong"
                        }`}
                      >
                        <input
                          type="radio"
                          name="financingSource"
                          checked={financingSource === "dealer"}
                          onChange={() => setFinancingSource("dealer")}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500 focus:ring-0"
                        />
                        <span>
                          <span className="block font-semibold text-ink-light">Use the dealer&apos;s financing</span>
                          <span className="block text-amber-400 text-[11px] mt-0.5">
                            Not recommended — dealer financing often costs more than a bank or credit union rate you arrange yourself.
                          </span>
                        </span>
                      </label>
                    </div>
                    {financingSource == null && (
                      <p className="text-[11px] text-rose-400">Pick a financing source to continue.</p>
                    )}
                  </div>
                )}

                <label className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <span className="text-[11px] text-ink-muted">
                    When will you be ready to complete the transaction?
                  </span>
                  <select
                    value={purchaseTimeline}
                    onChange={(e) => setPurchaseTimeline(e.target.value as PurchaseTimeline)}
                    className="rounded-lg border border-border bg-background py-1.5 px-2.5 text-[11px] text-ink-light focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="" disabled>
                      Select a timeline
                    </option>
                    <option value="asap">ASAP</option>
                    <option value="this_week">Within the week</option>
                    <option value="this_month">Within the month</option>
                  </select>
                </label>
              </WizardSection>

              {/* ---------------------------------------------------------- */}
              {/* Vehicle                                                     */}
              {/* ---------------------------------------------------------- */}
              <WizardSection
                title="Vehicle"
                hint="Paste the dealership link to the exact vehicle, or its 17-character VIN. One car is required to continue."
                className="py-6"
              >
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-emerald-400" />
                    <input
                      type="text"
                      value={dealerUrlInput}
                      onChange={(e) => setDealerUrlInput(e.target.value)}
                      placeholder={VEHICLE_INPUT_PLACEHOLDER}
                      className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-[11px] text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleParseDealerUrl()}
                    disabled={isParsingLink || !dealerUrlInput.trim()}
                    className="rounded-lg border border-border px-3.5 py-2 text-[11px] font-bold text-ink-light hover:border-emerald-500 hover:text-white transition-all disabled:opacity-50 shrink-0"
                  >
                    {isParsingLink ? "Adding…" : "Add"}
                  </button>
                </div>

                {parseError && !pendingLink && (
                  <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
                    <span className="leading-snug">{parseError}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setParseError(null);
                        setDealerUrlInput("");
                      }}
                      className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-300 hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                )}

                {pendingLink?.slot === "primary" && pendingLink.kind === "link" && (
                  <LinkConfirmPanel pending={pendingLink} busy={linkBusy} error={linkError} zipHint={buyerZipHint} onConfirm={confirmLink} onCancel={cancelPendingLink} />
                )}
                {pendingLink?.slot === "primary" && pendingLink.kind === "pick_dealer" && (
                  <div className="space-y-1.5 rounded-xl border border-sky-500/40 bg-sky-950/20 px-3.5 py-3 text-[11px] animate-fadeIn">
                    <p className="font-bold text-sky-200">Which dealership has this car?</p>
                    <DealerPicker candidates={[]} zipHint={buyerZipHint} onPick={applyPickedDealer} onCancel={cancelPendingLink} />
                  </div>
                )}

                {/* One confirmation line, not a spec sheet. Enough for the
                    buyer to catch a wrong VIN before continuing; the full
                    build stays one click away on the factory sheet. */}
                {parseSuccessMsg && selectedVehicle && (
                  <div
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 animate-fadeIn ${
                      selectedVehicle.buildConfidence === "dealer_listing_only"
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-emerald-500/40 bg-emerald-500/5"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <CheckCircle2
                        className={`h-4 w-4 shrink-0 ${
                          selectedVehicle.buildConfidence === "dealer_listing_only" ? "text-amber-400" : "text-emerald-400"
                        }`}
                      />
                      <span className="min-w-0 text-[11px] text-ink-light">
                        <span className="block truncate">
                        {[selectedVehicle.year, selectedVehicle.make, selectedVehicle.model, selectedVehicle.trim]
                          .filter(Boolean)
                          .join(" ")}
                        </span>
                        {/* VIN and the dealer rooftop — or, failing a name, the
                            site the link came from — so the buyer can confirm
                            this is the car and the store they meant. */}
                        <span className="block truncate text-[10px] text-ink-muted">
                          <span className="font-mono">{selectedVehicle.vin}</span>
                          {selectedVehicle.location?.dealerName?.trim() ? (
                            <>
                              {" · "}
                              {selectedVehicle.location.dealerName.trim()}
                              {dealerSourceLabel(selectedVehicle.location.dealerSource) ? (
                                <span className={selectedVehicle.location.dealerSource === "window_sticker" ? "text-amber-300/90" : "text-ink-faint"}>
                                  {" "}
                                  ({dealerSourceLabel(selectedVehicle.location.dealerSource)}
                                  {selectedVehicle.location.dealerSource === "window_sticker" ? ", may have moved" : ""})
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="font-bold text-amber-300"> · Dealer not found</span>
                          )}
                          {selectedVehicle.buyerConfirmed ? (
                            <span className="text-sky-300"> · confirmed by you</span>
                          ) : null}
                          {" · "}
                          <button
                            type="button"
                            onClick={() => changeDealerFor("primary")}
                            className="font-bold text-sky-300 hover:text-white"
                          >
                            {selectedVehicle.location?.dealerName ? "Change dealer" : "Pick dealer"}
                          </button>
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                          selectedVehicle.buildConfidence === "dealer_listing_only"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-emerald-500/15 text-emerald-300"
                        }`}
                        title={
                          selectedVehicle.buildConfidence === "dealer_listing_only"
                            ? "No factory build sheet was available — details come from the VIN and the dealer's listing."
                            : "Read from the manufacturer's official factory build sheet."
                        }
                      >
                        {selectedVehicle.buildConfidence === "dealer_listing_only" ? "Unconfirmed build" : "Factory verified"}
                      </span>
                      {fordPdfUrl && (
                        <a
                          href={fordPdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300"
                        >
                          <FileText className="h-3 w-3" />
                          {FORD_BUILD_SHEET_LINK}
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={clearImportedVehicle}
                        aria-label="Remove this vehicle"
                        className="text-ink-muted transition-colors hover:text-rose-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                )}

                {parseSuccessMsg && selectedVehicle?.buildConfidence === "dealer_listing_only" && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] leading-snug text-amber-200">
                    <strong className="font-bold">Unconfirmed build — dealer listing only.</strong>{" "}
                    {selectedVehicle.buyerConfirmed
                      ? "We don't read dealer pages, and there's no factory build sheet for this VIN yet, so the details above come from the VIN alone. Must-have options can't be matched."
                      : "No factory build sheet is available for this VIN yet, so the details above come from the VIN alone, and must-have options can't be matched."}{" "}
                    You can continue with it, or remove it and try another link.
                  </p>
                )}

                {/* Must-haves collapse behind a one-line summary — the full
                    option list is long enough to bury everything else. */}
                {selectedVehicle && fordStickerStatus === "released" && fordFilterableOptions.length > 0 && (
                  <details className="group rounded-xl border border-border bg-surface-elevated">
                    <summary className="cursor-pointer list-none px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">
                        {FORD_MUST_HAVE_HEADING}
                        <span className="ml-2 text-[11px] font-normal text-ink-muted">
                          {mustHavePackages.length} of {fordFilterableOptions.length} selected
                        </span>
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-border/60 px-3.5 py-3 space-y-2">
                      <p className="text-[11px] text-ink-muted">{FORD_MUST_HAVE_HELP}</p>
                      <FactoryMustHavePicker
                        options={fordFilterableOptions}
                        checked={mustHavePackages}
                        onToggle={toggleFordMustHave}
                      />
                      <p className="text-[10px] text-ink-faint">
                        Must-haves are saved with this deal. Dealer ads are not proof.
                      </p>
                    </div>
                  </details>
                )}

                {/* Alternates stay behind a link until asked for, or until
                    one is actually imported. */}
                {showAlternates || altVehicle1 || altVehicle2 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-ink-faint">
                      Up to 2 similar vehicles — dealers can quote on any of the three.
                    </p>
                    <AlternateVinField
                      label="Alternate vehicle 1"
                      value={altVin1}
                      onChange={setAltVin1}
                      onImport={handleParseAlt1}
                      vehicle={altVehicle1}
                      error={altError1}
                      parsing={altParsing1}
                      onRemove={removeAlt1}
                      onChangeDealer={() => changeDealerFor("alt1")}
                      primary={selectedVehicle}
                      mustHaves={selectedMustHaveRefs}
                    />
                    {pendingLink?.slot === "alt1" && pendingLink.kind === "link" && (
                      <LinkConfirmPanel pending={pendingLink} busy={linkBusy} error={linkError} zipHint={buyerZipHint} onConfirm={confirmLink} onCancel={cancelPendingLink} />
                    )}
                    {pendingLink?.slot === "alt1" && pendingLink.kind === "pick_dealer" && (
                      <div className="space-y-1.5 rounded-xl border border-sky-500/40 bg-sky-950/20 px-3.5 py-3 text-[11px] animate-fadeIn">
                        <p className="font-bold text-sky-200">Which dealership has this car?</p>
                        <DealerPicker candidates={[]} zipHint={buyerZipHint} onPick={applyPickedDealer} onCancel={cancelPendingLink} />
                      </div>
                    )}
                    <AlternateVinField
                      label="Alternate vehicle 2"
                      value={altVin2}
                      onChange={setAltVin2}
                      onImport={handleParseAlt2}
                      vehicle={altVehicle2}
                      error={altError2}
                      parsing={altParsing2}
                      onRemove={removeAlt2}
                      onChangeDealer={() => changeDealerFor("alt2")}
                      primary={selectedVehicle}
                      mustHaves={selectedMustHaveRefs}
                    />
                    {pendingLink?.slot === "alt2" && pendingLink.kind === "link" && (
                      <LinkConfirmPanel pending={pendingLink} busy={linkBusy} error={linkError} zipHint={buyerZipHint} onConfirm={confirmLink} onCancel={cancelPendingLink} />
                    )}
                    {pendingLink?.slot === "alt2" && pendingLink.kind === "pick_dealer" && (
                      <div className="space-y-1.5 rounded-xl border border-sky-500/40 bg-sky-950/20 px-3.5 py-3 text-[11px] animate-fadeIn">
                        <p className="font-bold text-sky-200">Which dealership has this car?</p>
                        <DealerPicker candidates={[]} zipHint={buyerZipHint} onPick={applyPickedDealer} onCancel={cancelPendingLink} />
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAlternates(true)}
                    className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    + Add additional vehicles to the quote request
                  </button>
                )}

                <div className="flex flex-wrap items-start justify-between gap-2 pt-1">
                  <label className="flex items-start gap-2 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sameStateOnly}
                      onChange={(e) => setSameStateOnly(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-emerald-500 focus:ring-0"
                    />
                    <span className="leading-snug text-ink-muted">
                      Only send this to dealerships in my state
                      <span className="block text-[10px] text-ink-faint">
                        Uncheck to include dealerships in other states within the radius
                      </span>
                    </span>
                  </label>
                  {sameStateOnly ? (
                    <label className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                      Your ZIP
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        value={huntZip}
                        onChange={(e) => {
                          const next = e.target.value.replace(/\D/g, "").slice(0, 5);
                          setHuntZip(next);
                          if (next.length === 5) setBuyerZip(next);
                        }}
                        placeholder="07405"
                        aria-label="Your ZIP, for the same-state filter"
                        className="w-16 rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px] text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                  ) : null}
                </div>

                {sameStateWarning && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] leading-snug text-amber-200">{sameStateWarning}</p>
                    <ul className="space-y-0.5">
                      {sameStateConflicts.map((v) => (
                        <li key={v.vin} className="text-[10px] text-amber-200/80">
                          {v.label}
                          {v.dealerName ? ` — ${v.dealerName}` : ""} ({v.state})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </WizardSection>

              {/* ---------------------------------------------------------- */}
              {/* Trade-in                                                    */}
              {/* ---------------------------------------------------------- */}
              <WizardSection title="Trade-in" className="pt-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-ink-muted">I have a vehicle to trade in</span>
                  <button
                    type="button"
                    onClick={() => setHasTradeIn(!hasTradeIn)}
                    aria-pressed={hasTradeIn}
                    aria-label="I have a vehicle to trade in"
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      hasTradeIn ? "bg-emerald-500" : "bg-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        hasTradeIn ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
                {hasTradeIn && (
                  <p className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[11px] leading-snug text-ink-light">
                    Your trade-in will be handled after we finalize the price of the new car.
                  </p>
                )}
              </WizardSection>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 2: DIRECT OFFER OR MULTI-DEALER                                      */}
          {/* ========================================================================= */}
          {step === 2 && (
            <div className="divide-y divide-border/50">
              <WizardSection
                title="Who gets this quote request"
                hint={
                  competeAmongImported
                    ? "Each dealership quotes its own car separately, or open the request to other dealers nearby too."
                    : "Send it to the dealership holding your car, or open it to other dealers nearby."
                }
                className="pb-6"
              >
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={chooseDirectOffer}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    offerPath === "direct"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Handshake className="h-5 w-5 text-emerald-400 shrink-0" />
                    <span className="font-bold text-white text-sm">
                      {competeAmongImported
                        ? `Request quotes from these ${importedDealerships.length} dealerships`
                        : "Request a quote from this dealership"}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={chooseMultiDealer}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    offerPath === "auction"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-emerald-400 shrink-0" />
                    <span className="font-bold text-white text-sm">Also request quotes from other dealers nearby</span>
                  </div>
                </button>
              </div>

              {/* How the competition actually works, stated where the buyer
                  picks a path — that's the moment the rules start to matter. */}
              <div className="rounded-lg border border-border bg-surface-elevated px-3 py-2.5 space-y-1">
                <p className="text-[11px] font-semibold text-ink-light">How dealer quotes work</p>
                <p className="text-[11px] leading-snug text-ink-muted">
                  Each dealer sends an out-the-door quote covering the vehicle and their
                  own fees — registration and sales tax are excluded, and calculated for
                  your address once you pick one. A quote is a request, not a bid: dealers
                  reply on their own time, and you can pick one or walk away. So you get
                  a real number rather than a first guess, each dealer can see the best
                  quote so far as a percentage off MSRP — never who sent it.
                </p>
              </div>
              </WizardSection>

              {/* ---------------------------------------------------------- */}
              {/* The dealerships behind the imported cars, and whether we    */}
              {/* can actually reach them                                     */}
              {/* ---------------------------------------------------------- */}
              <WizardSection
                title={directOfferMode ? "Confirm who gets it" : "Dealerships in this request"}
                hint={
                  directOfferMode
                    ? "Each request goes to a named person at the dealership — never a shared inbox. Untick anyone you'd rather leave out."
                    : "Where each car sits, and whether we have a way to send them your request."
                }
                className="py-6"
              >
                {expandNudge ? (
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2">
                    <p className="text-[11px] leading-snug text-amber-200">{expandNudge}</p>
                    <button
                      type="button"
                      onClick={() => setSameStateOnly(false)}
                      className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 text-[11px] font-black text-black hover:bg-amber-300 transition-all"
                    >
                      Include dealerships in other states
                    </button>
                  </div>
                ) : null}
                {directOfferMode && gatePlan.active && !expandNudge && excludedByState.size > 0 ? (
                  <p className="mb-2 text-[10px] text-ink-faint">
                    Keeping this in {gatePlan.buyerState}: {excludedByState.size} dealership{excludedByState.size === 1 ? "" : "s"} in{" "}
                    {gatePlan.excludedStates.join(", ")} left out by your same-state setting.
                  </p>
                ) : null}
                {importedDealerships.length === 0 ? (
                  <p className="text-[11px] text-ink-muted">
                    We couldn&apos;t identify a dealership for the cars you added.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {importedDealerships.map((dealer) => {
                      const contact = dealerContacts[dealer.dealerName];
                      const typed = buyerDealerEmails[dealer.dealerName] || "";
                      const supplied = isPlausibleDealerEmail(typed);
                      const reachable = Boolean(contact?.hasEmail && !contact?.emailOptOut);
                      const heldByState = excludedByState.has(dealer.dealerName);
                      return (
                        <li
                          key={dealer.dealerName}
                          className="rounded-lg border border-border bg-surface-elevated px-3 py-2.5 space-y-1"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-2">
                              {directOfferMode && (
                                <input
                                  type="checkbox"
                                  aria-label={`Send a quote request to ${dealer.dealerName}`}
                                  checked={Boolean(confirmedDesks[dealer.dealerName]) && !quoteDesks[dealer.dealerName]?.blockedReason && !heldByState}
                                  disabled={!quoteDesks[dealer.dealerName] || Boolean(quoteDesks[dealer.dealerName]?.blockedReason) || heldByState}
                                  onChange={(e) =>
                                    setConfirmedDesks((current) => ({ ...current, [dealer.dealerName]: e.target.checked }))
                                  }
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-emerald-500 focus:ring-0 disabled:opacity-40"
                                />
                              )}
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold text-ink-light">
                                {dealer.dealerName}
                              </div>
                              <div className="text-[10px] text-ink-muted">
                                {contact?.addressLine || dealer.locationLine || "Address not on file"}
                              </div>
                              {directOfferMode && (() => {
                                const desk = quoteDesks[dealer.dealerName];
                                if (!desk) return <div className="text-[10px] text-ink-faint">Looking up the sales desk…</div>;
                                if (desk.knownNamed && !desk.blockedReason) {
                                  return (
                                    <div className="text-[10px] text-ink-light">
                                      To: <span className="font-semibold">{desk.contactName}</span>
                                      {desk.role ? <span className="text-ink-muted"> · {DESK_ROLE_LABELS[desk.role]}</span> : null}
                                      {desk.emailMasked ? <span className="font-mono text-ink-muted"> · {desk.emailMasked}</span> : null}
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              {dealer.title ? (
                                <div className="text-[10px] text-ink-faint">{dealer.title}</div>
                              ) : null}
                              {factoryBuildOem && !dealer.dealerConfirmed ? (
                                <div className="text-[10px] italic text-ink-faint">
                                  Dealer the factory shipped it to — may not be where it&apos;s listed now
                                </div>
                              ) : null}
                            </div>
                            </div>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                                !contact
                                  ? "bg-border text-ink-muted"
                                  : reachable || supplied
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : "bg-amber-500/15 text-amber-300"
                              }`}
                            >
                              {(() => {
                                const desk = directOfferMode ? quoteDesks[dealer.dealerName] : undefined;
                                if (directOfferMode) {
                                  if (!desk) return "Checking";
                                  if (heldByState) return `Outside ${gatePlan.buyerState}`;
                                  if (!desk.blockedReason) return "Named contact";
                                  if (supplied) return "Adviser added";
                                  return desk.blockedReason === "dealer_opted_out" ? "Opted out" : "No sales contact";
                                }
                                return !contact ? "Checking" : reachable ? "Email on file" : supplied ? "Email added" : "No email";
                              })()}
                            </span>
                          </div>

                          {(directOfferMode
                            ? Boolean(quoteDesks[dealer.dealerName]?.blockedReason)
                            : Boolean(contact && !reachable)) && (
                            <div className="space-y-1.5 border-t border-border/60 pt-2">
                              <p className="text-[10px] leading-snug text-amber-200">
                                {directOfferMode
                                  ? `${quoteDesks[dealer.dealerName]?.blockedMessage || ""} If you have a sales adviser's own address there, add it below — otherwise paste a different vehicle's link in step 1.`
                                  : contact?.emailOptOut
                                    ? "This dealership asked us to stop emailing them. If you have a sales adviser there, add their address — otherwise add a different vehicle."
                                    : "We don't have an email on file for this dealership. If you have one for your sales adviser, add it below — otherwise paste a different vehicle's link in step 1."}
                              </p>
                              <input
                                type="email"
                                inputMode="email"
                                autoComplete="off"
                                value={typed}
                                onChange={(e) =>
                                  setBuyerDealerEmails((current) => ({
                                    ...current,
                                    [dealer.dealerName]: e.target.value,
                                  }))
                                }
                                placeholder="Sales adviser email (optional)"
                                aria-label={`Sales adviser email for ${dealer.dealerName}`}
                                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
                              />
                              {typed.trim() !== "" && !supplied && (
                                <p className="text-[10px] text-rose-400">
                                  That doesn&apos;t look like an email address.
                                </p>
                              )}
                              <button
                                type="button"
                                onClick={() => setStep(1)}
                                className="text-[10px] font-bold text-emerald-400 transition-colors hover:text-emerald-300"
                              >
                                Add a different vehicle instead →
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </WizardSection>

              {/* ---------------------------------------------------------- */}
              {/* Location — only the multi-dealer path uses it               */}
              {/* ---------------------------------------------------------- */}
              {offerPath === "auction" && (
              <WizardSection
                title="Where to look"
                hint="Sets which dealers can see this request. Radius is capped at 100 miles."
                className="pt-6"
              >
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        huntLocationInvalid ? "text-amber-300" : "text-ink-faint"
                      }`}
                    >
                      Your ZIP (required)
                    </span>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-emerald-400" />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        value={huntZip}
                        onChange={(e) => {
                          const next = e.target.value.replace(/\D/g, "").slice(0, 5);
                          setHuntZip(next);
                          if (next.length === 5) setBuyerZip(next);
                        }}
                        placeholder="e.g. 07405"
                        aria-required="true"
                        aria-invalid={huntLocationInvalid}
                        autoComplete="off"
                        className={`w-full rounded-xl border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono ${
                          huntLocationInvalid
                            ? "border-amber-500 ring-1 ring-amber-500/40"
                            : "border-border"
                        }`}
                      />
                    </div>
                  </label>
                  <label className="space-y-1">
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        huntLocationInvalid ? "text-amber-300" : "text-ink-faint"
                      }`}
                    >
                      Radius miles (required, 100 mi max)
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={huntRadius}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
                        const clamped = digits === "" ? "" : String(Math.min(100, Number(digits)));
                        setHuntRadius(clamped);
                        const n = Number(clamped);
                        if (Number.isFinite(n) && n > 0) setSearchRadius(n);
                      }}
                      placeholder="up to 100"
                      aria-required="true"
                      aria-invalid={huntLocationInvalid}
                      aria-label="Search radius in miles, maximum 100"
                      autoComplete="off"
                      className={`w-full rounded-xl border bg-background py-2 px-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono ${
                        huntLocationInvalid
                          ? "border-amber-500 ring-1 ring-amber-500/40"
                          : "border-border"
                      }`}
                    />
                  </label>
                </div>

                {sameStateWarning && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] leading-snug text-amber-200">{sameStateWarning}</p>
                    <ul className="space-y-0.5">
                      {sameStateConflicts.map((v) => (
                        <li key={v.vin} className="text-[10px] text-amber-200/80">
                          {v.label}
                          {v.dealerName ? ` — ${v.dealerName}` : ""} ({v.state})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </WizardSection>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 3: REVIEW & BROADCAST                                                */}
          {/* ========================================================================= */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Review & Privacy Shield
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {directOfferMode && competeAmongImported
                    ? `Sending your quote request to ${sendToCount} dealership${sendToCount === 1 ? "" : "s"} through TrimScout — they reply here, on their own time.`
                    : directOfferMode
                      ? `Sending your quote request to ${selectedVehicle?.location.dealerName ?? "the dealer"} through TrimScout — they reply here, on their own time.`
                      : "Dealers reply through TrimScout, so your inbox and phone stay out of it."}
                </p>
              </div>

              {/* On a quote request there is no buyer target price — the desk
                  quotes its own number, full stop. The pricing choice only
                  exists on the open-to-other-dealers path. */}
              {directOfferMode && (
                <div className="rounded-lg border border-border bg-surface-elevated px-3 py-2.5 space-y-1">
                  <p className="text-[11px] font-semibold text-ink-light">A request, not a bid</p>
                  <p className="text-[11px] leading-snug text-ink-muted">{NON_BINDING_COPY} Each desk replies with its own out-the-door number; you compare them and pick one, or walk away.</p>
                </div>
              )}
              <div className={`space-y-2 ${directOfferMode ? "hidden" : ""}`}>
                <label className="text-xs font-semibold text-ink-light">Pricing</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPricingChoice("dealer_names")}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      pricingChoice === "dealer_names"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-border bg-surface-elevated hover:border-border-strong"
                    }`}
                  >
                    <div className={`text-xs font-bold ${pricingChoice === "dealer_names" ? "text-emerald-400" : "text-white"}`}>
                      Dealer Names Price
                    </div>
                    <div className="text-[10.5px] text-ink-faint mt-0.5">They quote their best out-the-door price</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPricingChoice("buyer_names")}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      pricingChoice === "buyer_names"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-border bg-surface-elevated hover:border-border-strong"
                    }`}
                  >
                    <div className={`text-xs font-bold ${pricingChoice === "buyer_names" ? "text-emerald-400" : "text-white"}`}>
                      I&apos;ll Set My Price
                    </div>
                    <div className="text-[10.5px] text-ink-faint mt-0.5">Set a firm target OTD price</div>
                  </button>
                </div>

                {pricingChoice === "buyer_names" && (
                  <div className="rounded-xl border border-border bg-background p-3 space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-ink-faint">Your Target Out-The-Door Price</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint text-xs font-bold">$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={targetOtdPrice > 0 ? targetOtdPrice.toLocaleString("en-US") : ""}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "").slice(0, 7);
                          setTargetOtdPrice(digits ? Number(digits) : 0);
                        }}
                        placeholder="52,000"
                        className="w-full rounded-xl border border-border bg-surface-elevated py-2 pl-6 pr-3 text-sm font-bold text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>
                    <p className="text-[11px] text-ink-faint">
                      We&apos;ll send this to the dealer as your firm target — they can accept it or counter if they can&apos;t meet it.
                    </p>
                    {formatTypicalOtdLabel(typicalOtd) ? (
                      <p className="text-[11px] text-ink-muted">
                        {formatTypicalOtdLabel(typicalOtd)} — for context only, not a floor you have to beat.
                      </p>
                    ) : null}
                    {selectedVehicle?.msrp
                      ? (() => {
                          const warning = discountRealismWarning(selectedVehicle.msrp, targetOtdPrice);
                          return warning ? (
                            <p className="text-[11px] text-amber-400">{warning}</p>
                          ) : null;
                        })()
                      : null}
                  </div>
                )}
              </div>

              {/* Every vehicle in the package, side by side — the buyer is
                  about to send all of them, so all of them get reviewed. */}
              {(() => {
                const packageVehicles = [selectedVehicle, altVehicle1, altVehicle2]
                  .filter((v): v is Vehicle => Boolean(v))
                  .map((vehicle, index) => ({
                    vehicle,
                    target: reviewTargetFromVehicle(vehicle),
                    contact: vehicle.location?.dealerName ? dealerContacts[vehicle.location.dealerName.trim()] : undefined,
                    typedEmail: vehicle.location?.dealerName ? buyerDealerEmails[vehicle.location.dealerName.trim()] || "" : "",
                    isPrimary: index === 0,
                  }));
                if (packageVehicles.length === 0) {
                  return (
                    <div className="rounded-xl border border-border bg-surface-elevated p-4 text-xs text-ink-muted">
                      No imported vehicle
                    </div>
                  );
                }
                const cols = packageVehicles.length;
                return (
                  <div className="rounded-xl border border-border bg-surface-elevated overflow-hidden">
                    <div className="border-b border-border/60 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                      {cols === 1 ? "Vehicle in this request" : `${cols} vehicles in this request`}
                    </div>
                    <div className="overflow-x-auto">
                      <div
                        className="grid divide-x divide-border/60"
                        style={{ gridTemplateColumns: `repeat(${cols}, minmax(200px, 1fr))` }}
                      >
                        {packageVehicles.map(({ vehicle, target, contact, typedEmail, isPrimary }) => {
                          const reachable = Boolean(contact?.hasEmail && !contact?.emailOptOut);
                          const supplied = isPlausibleDealerEmail(typedEmail);
                          return (
                            <div key={vehicle.vin} className="space-y-2 px-4 py-3 text-xs">
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                                  {isPrimary ? "Primary" : "Alternate"}
                                </div>
                                <div className="font-bold text-white">
                                  {target?.title || "Vehicle details unavailable"}
                                </div>
                              </div>

                              <div className="space-y-0.5 text-[11px]">
                                <div className="text-ink-muted">
                                  VIN{" "}
                                  {target?.vdpHref ? (
                                    <a
                                      href={target.vdpHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-emerald-400 hover:underline"
                                    >
                                      {vehicle.vin}
                                    </a>
                                  ) : (
                                    <span className="font-mono text-ink-light">{vehicle.vin}</span>
                                  )}
                                </div>
                              </div>

                              <div className="space-y-0.5 border-t border-border/50 pt-2 text-[11px]">
                                {target?.dealerName ? (
                                  <>
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="font-semibold text-ink-light">{target.dealerName}</span>
                                      <span
                                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${(() => {
                                          const ok = directOfferMode
                                            ? Boolean(target?.dealerName && quoteDesks[target.dealerName] && !quoteDesks[target.dealerName]?.blockedReason && confirmedDesks[target.dealerName])
                                            : reachable || supplied;
                                          const pending = directOfferMode ? !(target?.dealerName && quoteDesks[target.dealerName]) : !contact;
                                          return pending ? "bg-border text-ink-muted" : ok ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300";
                                        })()}`}
                                      >
                                        {(() => {
                                          if (directOfferMode) {
                                            const desk = target?.dealerName ? quoteDesks[target.dealerName] : undefined;
                                            if (!desk) return "Checking";
                                            if (!desk.blockedReason) return confirmedDesks[target!.dealerName!] ? "Named contact" : "Not sending";
                                            return supplied ? "Adviser added" : "No sales contact";
                                          }
                                          return !contact ? "Checking" : reachable ? "Email on file" : supplied ? "Email added" : "No email";
                                        })()}
                                      </span>
                                    </div>
                                    <div className="text-ink-muted">
                                      {contact?.addressLine || target.locationLine || "Address not on file"}
                                    </div>
                                    {isPrimary && formatDealerResponsivenessLabel(dealerResponsiveness) ? (
                                      <div
                                        className={`text-[10.5px] font-medium ${
                                          dealerResponsiveness?.bidCount ? "text-emerald-400" : "text-ink-faint"
                                        }`}
                                      >
                                        {formatDealerResponsivenessLabel(dealerResponsiveness)}
                                      </div>
                                    ) : null}
                                    {factoryBuildOem && isPrimary && !target.dealerConfirmed ? (
                                      <div className="text-[10px] italic text-ink-faint">
                                        Dealer the factory shipped it to — may not be where it&apos;s listed now
                                      </div>
                                    ) : null}
                                  </>
                                ) : (
                                  <div className="text-ink-faint">Dealership not identified</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Summary Box */}
              <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2 text-xs">
                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Quotes from:</span>
                  <span className="text-emerald-400 font-bold text-right">
                    {directOfferMode
                      ? competeAmongImported
                        ? `${sendToCount} of ${importedDealerships.length} dealerships confirmed`
                        : "This dealership only"
                      : "This dealership and others nearby"}
                  </span>
                </div>

                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Pricing:</span>
                  <span className="text-emerald-400 font-bold text-right">
                    {pricingChoice === "buyer_names"
                      ? `You set the price — $${targetOtdPrice.toLocaleString("en-US")}`
                      : "Dealer names their price"}
                  </span>
                </div>

                {hasTradeIn && (
                  <div className="flex justify-between border-b border-border/50 pb-2">
                    <span className="text-ink-muted">Trade-In:</span>
                    <span className="text-emerald-400 font-medium">
                      Yes — handled after the selling price is set
                    </span>
                  </div>
                )}

                {mustHavePackages.length > 0 && (
                  <div className="flex justify-between border-b border-border/50 pb-2">
                    <span className="text-ink-muted">Must-Have Packages:</span>
                    <span className="text-emerald-400 font-medium text-right">
                      {mustHavePackages.slice(0, 3).join(", ")}{mustHavePackages.length > 3 ? ` +${mustHavePackages.length - 3} more` : ""}
                    </span>
                  </div>
                )}

                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Deal Structure:</span>
                  <span className="text-white font-semibold text-right">
                    {formatDealStructures(requestedStructures)}
                  </span>
                </div>

                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Deal #:</span>
                  <span className="text-white font-mono font-bold">{dealReference}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-ink-muted">Your alias to dealers:</span>
                  <span className="text-emerald-400 font-mono font-bold">
                    {formatBuyerAlias(currentUser?.id)}
                    {!currentUser ? <span className="ml-1 font-sans font-normal text-[10px] text-ink-faint">(assigned at sign-in)</span> : null}
                  </span>
                </div>
              </div>

              {/* Buyer Comment — scrubbed of contact info before it ever leaves the browser */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink-light flex items-center justify-between">
                  <span>Add a Comment for the Dealer <span className="text-ink-faint font-normal">(optional)</span></span>
                  <span className={`text-[10px] font-mono ${dealComment.length > 900 ? "text-amber-400" : "text-ink-faint"}`}>
                    {dealComment.length}/1000
                  </span>
                </label>
                <textarea
                  value={dealComment}
                  onChange={(e) => setDealComment(e.target.value.slice(0, 1000))}
                  placeholder="e.g. Flexible on color, need delivery within 2 weeks, prior lease customer…"
                  rows={3}
                  className={`w-full rounded-xl border bg-background py-2.5 px-3.5 text-xs text-white placeholder-ink-faint focus:outline-none resize-none ${
                    dealCommentContactWarning
                      ? "border-rose-500 focus:border-rose-500"
                      : "border-border focus:border-emerald-500"
                  }`}
                />
                {dealCommentContactWarning ? (
                  <p className="text-[11px] text-rose-400 flex items-center gap-1.5">
                    <ShieldCheck className="h-3 w-3 shrink-0" />
                    Looks like your comment contains {dealCommentContactWarning} — remove it. Dealers only ever see your masked buyer ID here.
                  </p>
                ) : (
                  <p className="text-[11px] text-ink-faint">
                    Please don't include your name, email, phone number, or any links — dealers only see your masked buyer ID until you accept a deal. We automatically block emails, phone numbers, links, and handles.
                  </p>
                )}
              </div>

              {/* How This Works Box */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 flex items-start gap-2.5 text-xs text-ink-light">
                <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-emerald-400">How This Works</div>
                  <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                    {pricingChoice === "buyer_names"
                      ? "We send the dealer your target Out-The-Door price — vehicle, taxes, fees, everything. They can accept it or counter if they can't meet it."
                      : "We ask the dealer to quote their own Out-The-Door price — vehicle, taxes, fees, everything — so you can see their best number."}{" "}
                    Once you and the dealer finalize that price together, we&apos;ll work through any trade-in value from there.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex flex-col gap-2 border-t border-border bg-surface-elevated px-6 py-4">
          {submitError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
              {submitError}
            </div>
          )}
          <div className="flex items-center justify-between">
            {step > 1 ? (
              <button
                onClick={goBack}
                disabled={isSubmittingReal}
                className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border transition-colors disabled:opacity-50"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <div />
            )}

            {step < TOTAL_STEPS ? (
              <button
                onClick={goNext}
                disabled={
                  (step === 1 &&
                    (requestedStructures.length === 0 ||
                      !vehicleImported ||
                      financingSourceMissing ||
                      !purchaseTimeline)) ||
                  (step === 2 && (!offerPath || step2LocationMissing || Boolean(sameStateWarning)))
                }
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-bold text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleLaunchDeal}
                disabled={isSubmittingReal || !!dealCommentContactWarning}
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-6 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-60"
              >
                {isSubmittingReal ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 fill-black" />
                )}
                {isSubmittingReal
                  ? directOfferMode
                    ? "Sending…"
                    : "Sending…"
                  : directOfferMode
                  ? competeAmongImported
                    ? `Request quotes from ${sendToCount} dealership${sendToCount === 1 ? "" : "s"}`
                    : "Request a quote"
                  : "Request quotes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
