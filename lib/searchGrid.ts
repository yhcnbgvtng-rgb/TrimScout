// The /search results grid: which columns exist, how each one filters and sorts, what a cell shows, and the removable "pills" for the active filters.
// Pure and client-safe (no React), so the rules can be unit tested without a page.
import type { SortableColumn } from "./buyerSort";
import { paidOptionView } from "./optionsPaidOnly";
import { cleanBodyStyle, DRIVETRAIN_CHOICES, FUEL_CHOICES, labelOf, TRANSMISSION_CHOICES } from "./searchFilters";
import { parseExclude } from "./searchLive";
import type { UrlFilters } from "./searchUrlState";
// The box's own classifier (plain JS, no imports): the Fuel / Drivetrain / Transmission cells use the very patterns the filters count with, so a cell and its filter never disagree.
import { classifyDrivetrain, classifyFuel, classifyTransmission } from "../scrapers/lightsail-crawler/src/inventoryDerived.js";

export type GridColumnKey =
  | "year" | "make" | "model" | "trim" | "condition" | "ext" | "int" | "mileage" | "price" | "paid"
  | "body" | "fuel" | "drive" | "trans" | "dealer" | "state" | "days" | "vin";

/** How a column filters. `list` = checkbox list (`single`: one value at a time), `range` = min/max + slider, `pattern` = a VIN pattern box. */
export type ColumnFilter =
  | { kind: "list"; single?: boolean }
  | { kind: "range"; min: keyof UrlFilters; max: keyof UrlFilters; label: string; step: number; unit?: "money" | "miles" | "days" | "year" }
  | { kind: "pattern" };

export interface GridColumn {
  key: GridColumnKey;
  label: string;
  width: number;
  right?: boolean;
  /** Header sort toggle: the sort key the box understands (lib/buyerSort.ts). Absent = the box cannot order by this column. */
  sort?: SortableColumn;
  filter: ColumnFilter;
  /** Off until the shopper adds it from the Columns menu. */
  defaultHidden?: boolean;
}

export const GRID_COLUMNS: GridColumn[] = [
  { key: "year", label: "Year", width: 88, right: true, sort: "year", filter: { kind: "range", min: "yearMin", max: "yearMax", label: "Year", step: 1, unit: "year" } },
  { key: "make", label: "Make", width: 110, sort: "make", filter: { kind: "list", single: true } },
  { key: "model", label: "Model", width: 130, sort: "model", filter: { kind: "list", single: true } },
  { key: "trim", label: "Trim", width: 190, sort: "trim", filter: { kind: "list", single: true } },
  { key: "condition", label: "Condition", width: 120, filter: { kind: "list", single: true } },
  { key: "ext", label: "Exterior color", width: 160, sort: "ext", filter: { kind: "list", single: true } },
  { key: "int", label: "Interior color", width: 150, sort: "int", filter: { kind: "list", single: true } },
  { key: "mileage", label: "Mileage", width: 116, right: true, sort: "mileage", filter: { kind: "range", min: "odometerMin", max: "odometerMax", label: "Mileage", step: 5000, unit: "miles" } },
  { key: "price", label: "Price", width: 108, right: true, sort: "price", filter: { kind: "range", min: "priceMin", max: "priceMax", label: "Price", step: 1000, unit: "money" } },
  { key: "paid", label: "Paid options", width: 140, right: true, filter: { kind: "list" } },
  { key: "body", label: "Body style", width: 130, filter: { kind: "list" } },
  { key: "fuel", label: "Fuel", width: 100, filter: { kind: "list" } },
  { key: "drive", label: "Drivetrain", width: 124, filter: { kind: "list" } },
  { key: "trans", label: "Transmission", width: 136, filter: { kind: "list" } },
  { key: "dealer", label: "Dealer", width: 260, sort: "dealer", filter: { kind: "list" } },
  { key: "state", label: "State", width: 84, sort: "state", filter: { kind: "list", single: true } },
  { key: "days", label: "Days on market", width: 150, right: true, sort: "days", filter: { kind: "range", min: "daysMin", max: "daysMax", label: "Days on market", step: 5, unit: "days" } },
  { key: "vin", label: "VIN", width: 170, sort: "vin", defaultHidden: true, filter: { kind: "pattern" } },
];

export const COLUMN_KEYS = GRID_COLUMNS.map((c) => c.key);
export const columnOf = (key: GridColumnKey) => GRID_COLUMNS.find((c) => c.key === key)!;
const KNOWN = new Set<string>(COLUMN_KEYS);

/** The page URL carries the columns the shopper turned off or on, relative to the defaults: `cols=-year,+vin`. Unknown names are dropped. */
export function visibleColumnsFromParam(raw: string | null | undefined): GridColumnKey[] {
  const on = new Set<GridColumnKey>(GRID_COLUMNS.filter((c) => !c.defaultHidden).map((c) => c.key));
  for (const part of String(raw ?? "").split(",").slice(0, 40)) {
    const sign = part[0], name = part.slice(1);
    if (!KNOWN.has(name)) continue;
    if (sign === "-") on.delete(name as GridColumnKey);
    else if (sign === "+") on.add(name as GridColumnKey);
  }
  return COLUMN_KEYS.filter((k) => on.has(k));
}
/** The inverse: "" when the visible set is the default, so the URL stays clean. */
export function visibleColumnsToParam(visible: readonly GridColumnKey[]): string {
  const have = new Set(visible);
  const out: string[] = [];
  for (const c of GRID_COLUMNS) {
    if (c.defaultHidden && have.has(c.key)) out.push(`+${c.key}`);
    if (!c.defaultHidden && !have.has(c.key)) out.push(`-${c.key}`);
  }
  return out.join(",");
}

/** The fields of a result row the grid reads (a subset of the buyer search row; every one may be missing on an older box). */
export interface GridRow {
  year?: number | null; make?: string | null; model?: string | null; trim?: string | null; condition?: "new" | "used" | "cpo" | null;
  exteriorColor?: string | null; interiorColor?: string | null; mileage?: number | null; price?: number | null;
  options?: Array<{ code?: string | null; name?: string | null; price?: number | null; kind?: string | null }> | null;
  bodyStyle?: string | null; engine?: string | null; transmission?: string | null; dealerName?: string; dealerState?: string | null;
  dealerCity?: string | null; daysOnLot?: number | null; vin?: string;
}

export const money = (n: number | null | undefined) => (n == null ? "" : `$${n.toLocaleString("en-US")}`);
export const CONDITION_LABEL = { new: "New", used: "Used", cpo: "Certified" } as const;

/** The paid factory options of a car: price above $0, factory kind only, one line per option (lib/optionsPaidOnly.ts). */
export const paidOptionsOf = (r: GridRow) => paidOptionView((r.options ?? []).map((o) => ({ ...o, name: o.name ?? "" }))).paid;

export function fuelOf(r: GridRow): string | null { return classifyFuel({ trim: r.trim, engine: r.engine, model: r.model }); }
export function drivetrainOf(r: GridRow): string | null { return classifyDrivetrain({ trim: r.trim, engine: r.engine, bodyStyle: r.bodyStyle }); }
export function transmissionOf(r: GridRow): string | null { return classifyTransmission({ transmission: r.transmission }); }

/** What a cell shows, as plain text ("" = blank). The Paid options cell is drawn by the grid (count + hover list); its text is the count. */
export function cellText(key: GridColumnKey, r: GridRow): string {
  switch (key) {
    case "year": return r.year == null ? "" : String(r.year);
    case "make": return r.make ?? "";
    case "model": return r.model ?? "";
    case "trim": return r.trim ?? "";
    case "condition": return r.condition ? CONDITION_LABEL[r.condition] : "";
    case "ext": return r.exteriorColor ?? "";
    case "int": return r.interiorColor ?? "";
    case "mileage": return r.mileage == null ? "" : r.mileage.toLocaleString("en-US");
    case "price": return money(r.price);
    case "paid": { const n = paidOptionsOf(r).length; return n ? String(n) : ""; }
    case "body": return r.bodyStyle ?? "";
    case "fuel": { const k = fuelOf(r); return k ? labelOf(FUEL_CHOICES, k) : ""; }
    case "drive": { const k = drivetrainOf(r); return k ? labelOf(DRIVETRAIN_CHOICES, k) : ""; }
    case "trans": { const k = transmissionOf(r); return k ? labelOf(TRANSMISSION_CHOICES, k) : ""; }
    case "dealer": return r.dealerName ?? "";
    case "state": return r.dealerState ?? "";
    case "days": return r.daysOnLot == null ? "" : String(r.daysOnLot);
    case "vin": return r.vin ?? "";
  }
}

/** The row property a column reads. `undefined` there on every loaded row means the box does not send it, and the column is hidden. */
const FIELD: Record<GridColumnKey, (r: GridRow) => unknown> = {
  year: (r) => r.year, make: (r) => r.make, model: (r) => r.model, trim: (r) => r.trim, condition: (r) => r.condition,
  ext: (r) => r.exteriorColor, int: (r) => r.interiorColor, mileage: (r) => r.mileage, price: (r) => r.price,
  paid: (r) => r.options, body: (r) => r.bodyStyle, fuel: (r) => r.engine, drive: (r) => r.engine, trans: (r) => r.transmission,
  dealer: (r) => r.dealerName, state: (r) => r.dealerState, days: (r) => r.daysOnLot, vin: (r) => r.vin,
};
/** A column is shown only if the box sent its field on at least one loaded row (a field that is present but empty counts: the box does send it). With no rows yet every column is offered. */
export function columnSent(key: GridColumnKey, rows: readonly GridRow[]): boolean {
  if (!rows.length) return true;
  return rows.some((r) => FIELD[key](r) !== undefined);
}

/** True when the column's filter is set. */
export function columnActive(key: GridColumnKey, f: UrlFilters): boolean {
  switch (key) {
    case "year": return Boolean(f.yearMin || f.yearMax);
    case "make": return Boolean(f.make);
    case "model": return Boolean(f.model);
    case "trim": return Boolean(f.trim);
    case "condition": return Boolean(f.cond);
    case "ext": return Boolean(f.exteriorColor);
    case "int": return Boolean(f.interiorColor);
    case "mileage": return Boolean(f.odometerMin || f.odometerMax);
    case "price": return Boolean(f.priceMin || f.priceMax);
    case "paid": return f.optionKeys.length > 0;
    case "body": return f.bodyStyle.length > 0;
    case "fuel": return f.fuel.length > 0;
    case "drive": return f.drivetrain.length > 0;
    case "trans": return f.transmission.length > 0;
    case "dealer": return f.dealerIds.length > 0;
    case "state": return Boolean(f.state);
    case "days": return Boolean(f.daysMin || f.daysMax);
    case "vin": return Boolean(f.vinPattern);
  }
}

/** Clearing a column's filter. Make and Model take what depends on them along (the box has nothing to scope trim or options by otherwise). */
export function clearColumn(key: GridColumnKey, f: UrlFilters): UrlFilters {
  switch (key) {
    case "year": return { ...f, yearMin: "", yearMax: "" };
    case "make": return { ...f, make: "", model: "", trim: "", optionKeys: [] };
    case "model": return { ...f, model: "", trim: "", optionKeys: [] };
    case "trim": return { ...f, trim: "" };
    case "condition": return { ...f, cond: "" };
    case "ext": return { ...f, exteriorColor: "" };
    case "int": return { ...f, interiorColor: "" };
    case "mileage": return { ...f, odometerMin: "", odometerMax: "" };
    case "price": return { ...f, priceMin: "", priceMax: "" };
    case "paid": return { ...f, optionKeys: [] };
    case "body": return { ...f, bodyStyle: [] };
    case "fuel": return { ...f, fuel: [] };
    case "drive": return { ...f, drivetrain: [] };
    case "trans": return { ...f, transmission: [] };
    case "dealer": return { ...f, dealerIds: [] };
    case "state": return { ...f, state: "" };
    case "days": return { ...f, daysMin: "", daysMax: "" };
    case "vin": return { ...f, vinPattern: "" };
  }
}

export interface Pill { id: string; label: string; clear: (f: UrlFilters) => UrlFilters }

const rangeText = (lo: string, hi: string, fmt: (n: number) => string) =>
  lo && hi ? `${fmt(Number(lo))}–${fmt(Number(hi))}` : lo ? `${fmt(Number(lo))}+` : `up to ${fmt(Number(hi))}`;
const plain = (n: number) => n.toLocaleString("en-US");

/** Display names the page knows for list values (dealers by id, options by key); anything missing falls back to the raw value. */
export interface PillNames { dealers?: Record<string, string>; options?: Record<string, string> }

/** One removable pill per picked value (lists) or per range / text filter, in column order, then the extras that are not columns. */
export function buildPills(f: UrlFilters, names: PillNames = {}): Pill[] {
  const pills: Pill[] = [];
  const one = (id: string, label: string, clear: (f: UrlFilters) => UrlFilters) => pills.push({ id, label, clear });
  if (f.make) one("make", `Make: ${f.make}`, (x) => clearColumn("make", x));
  if (f.model) one("model", `Model: ${f.model}`, (x) => clearColumn("model", x));
  if (f.trim) one("trim", `Trim: ${f.trim}`, (x) => clearColumn("trim", x));
  if (f.state) one("state", `State: ${f.state}`, (x) => clearColumn("state", x));
  if (f.cond) one("cond", `Condition: ${CONDITION_LABEL[f.cond as keyof typeof CONDITION_LABEL] ?? f.cond}`, (x) => clearColumn("condition", x));
  if (f.yearMin || f.yearMax) one("year", `Year: ${rangeText(f.yearMin, f.yearMax, String)}`, (x) => clearColumn("year", x));
  if (f.exteriorColor) one("ext", `Exterior: ${f.exteriorColor}`, (x) => clearColumn("ext", x));
  if (f.interiorColor) one("int", `Interior: ${f.interiorColor}`, (x) => clearColumn("int", x));
  if (f.odometerMin || f.odometerMax) one("mileage", `Mileage: ${rangeText(f.odometerMin, f.odometerMax, plain)}`, (x) => clearColumn("mileage", x));
  if (f.priceMin || f.priceMax) one("price", `Price: ${rangeText(f.priceMin, f.priceMax, (n) => money(n))}`, (x) => clearColumn("price", x));
  for (const k of f.optionKeys) one(`opt:${k}`, `Option: ${names.options?.[k] ?? k}`, (x) => ({ ...x, optionKeys: x.optionKeys.filter((o) => o !== k) }));
  for (const v of f.bodyStyle) one(`body:${v}`, `Body: ${v}`, (x) => ({ ...x, bodyStyle: x.bodyStyle.filter((o) => o !== v) }));
  for (const v of f.fuel) one(`fuel:${v}`, `Fuel: ${labelOf(FUEL_CHOICES, v)}`, (x) => ({ ...x, fuel: x.fuel.filter((o) => o !== v) }));
  for (const v of f.drivetrain) one(`drive:${v}`, `Drivetrain: ${labelOf(DRIVETRAIN_CHOICES, v)}`, (x) => ({ ...x, drivetrain: x.drivetrain.filter((o) => o !== v) }));
  for (const v of f.transmission) one(`trans:${v}`, `Transmission: ${labelOf(TRANSMISSION_CHOICES, v)}`, (x) => ({ ...x, transmission: x.transmission.filter((o) => o !== v) }));
  for (const v of f.dealerIds) one(`dealer:${v}`, `Dealer: ${names.dealers?.[v] ?? `#${v}`}`, (x) => ({ ...x, dealerIds: x.dealerIds.filter((o) => o !== v) }));
  if (f.daysMin || f.daysMax) one("days", `Days on market: ${rangeText(f.daysMin, f.daysMax, String)}`, (x) => clearColumn("days", x));
  if (f.vinPattern) one("vin", `VIN: ${f.vinPattern}`, (x) => clearColumn("vin", x));
  for (const w of parseExclude(f.exclude)) {
    one(`exclude:${w}`, `Leave out: ${w}`, (x) => ({ ...x, exclude: parseExclude(x.exclude).filter((o) => o !== w).join(", ") }));
  }
  if (f.zip) one("zip", f.radiusMiles ? `Within ${f.radiusMiles} mi of ${f.zip}` : `ZIP ${f.zip}`, (x) => ({ ...x, zip: "", radiusMiles: "" }));
  if (f.possibleDemo) one("demo", "Possible demo or loaner", (x) => ({ ...x, possibleDemo: false }));
  if (f.contactOnFile) one("contact", "Dealer contact on file", (x) => ({ ...x, contactOnFile: false }));
  return pills;
}

/** Body-style values from the box are the dealer's own words; clean them the way the request does before they are sent back. */
export const bodyValue = cleanBodyStyle;

/** Rows of a checkbox list after the search box: case-insensitive "contains", picked values always stay visible so they can be unticked. */
export function filterListRows<T extends { value: string; label: string; count?: number }>(rows: readonly T[], query: string, picked: readonly string[]): T[] {
  const q = query.trim().toLowerCase();
  const pick = new Set(picked);
  return rows.filter((r) => pick.has(r.value) || ((r.count == null || r.count > 0) && (!q || r.label.toLowerCase().includes(q))));
}

/** Slider position <-> value. A blank min is the track's low end, a blank max its high end. */
export function sliderValue(raw: string, fallback: number): number { const n = Number(raw); return raw !== "" && Number.isFinite(n) ? n : fallback; }
/** A range the shopper dragged: a handle left at the track's end means "no bound" (empty string). */
export function rangeFromSlider(lo: number, hi: number, track: { min: number; max: number }): { min: string; max: string } {
  return { min: lo <= track.min ? "" : String(lo), max: hi >= track.max ? "" : String(hi) };
}
