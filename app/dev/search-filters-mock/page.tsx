"use client";

// MOCK / UI ONLY. Standalone left-sidebar FILTERS layout study. Not linked from anywhere, not wired to any API,
// and does not touch the real /search route. All state is local React state over static sample options.

import React, { useMemo, useState } from "react";

type Cond = "new" | "used" | "cpo";
interface F {
  cond: Cond | "";
  state: string;
  zip: string;
  radius: string;
  makes: string[];
  model: string;
  trims: string[];
  yearMin: string;
  yearMax: string;
  priceMin: string;
  priceMax: string;
  options: string[];
}
const EMPTY: F = { cond: "", state: "", zip: "", radius: "", makes: [], model: "", trims: [], yearMin: "", yearMax: "", priceMin: "", priceMax: "", options: [] };

const STATES = ["NJ", "NY", "PA", "CT", "FL", "TX", "CA", "VA", "GA"];
const MAKES = ["Toyota", "Ford", "Honda", "Porsche", "BMW", "Audi", "Mercedes-Benz", "Hyundai", "Kia", "Chevrolet"];
const MODELS: Record<string, string[]> = {
  Toyota: ["RAV4", "Camry", "Tacoma", "Highlander"],
  Ford: ["Bronco", "F-150", "Mustang", "Explorer"],
  Honda: ["CR-V", "Accord", "Civic"],
  Porsche: ["911", "Macan", "Cayenne", "Taycan"],
  BMW: ["X5", "3 Series", "M4"],
  Audi: ["Q5", "A4", "Q7"],
};
const TRIMS = ["Base", "XLE", "Limited", "Sport", "Premium", "Platinum"];
const OPTIONS = ["Premium Package", "Tow Package", "Panoramic Roof", "Cold Weather Package", "Technology Package", "Navigation"];
const YEARS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020"];

const SECTION_IDS = ["condition", "location", "make", "model", "trim", "year", "price", "options"] as const;
type SectionId = (typeof SECTION_IDS)[number];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-4 w-4 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Section({ title, badge, open, onToggle, children }: { title: string; badge?: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border-b border-border">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          {title}
          {!!badge && <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-bold leading-4 text-black">{badge}</span>}
        </span>
        <Chevron open={open} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

const pill = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${on ? "border-brand-500 bg-brand-500/15 text-brand-300" : "border-border-strong bg-surface-elevated text-ink-light hover:text-white"}`;
const input = "w-full rounded-lg border border-border-strong bg-surface-elevated px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-brand-500 focus:outline-none";

function FiltersPanel({ f, setF, onClose }: { f: F; setF: React.Dispatch<React.SetStateAction<F>>; onClose?: () => void }) {
  const [open, setOpen] = useState<Record<SectionId, boolean>>({ condition: true, location: true, make: true, model: false, trim: false, year: false, price: false, options: false });
  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const chips = useMemo(() => {
    const c: { id: string; text: string; remove: () => void }[] = [];
    if (f.cond) c.push({ id: "cond", text: { new: "New", used: "Used", cpo: "Certified" }[f.cond], remove: () => setF((s) => ({ ...s, cond: "" })) });
    if (f.state) c.push({ id: "state", text: f.state, remove: () => setF((s) => ({ ...s, state: "" })) });
    if (f.zip) c.push({ id: "zip", text: `${f.zip}${f.radius ? ` · ${f.radius} mi` : ""}`, remove: () => setF((s) => ({ ...s, zip: "", radius: "" })) });
    f.makes.forEach((m) => c.push({ id: `make-${m}`, text: m, remove: () => setF((s) => ({ ...s, makes: s.makes.filter((x) => x !== m) })) }));
    if (f.model) c.push({ id: "model", text: f.model, remove: () => setF((s) => ({ ...s, model: "" })) });
    f.trims.forEach((t) => c.push({ id: `trim-${t}`, text: t, remove: () => setF((s) => ({ ...s, trims: s.trims.filter((x) => x !== t) })) }));
    if (f.yearMin || f.yearMax) c.push({ id: "year", text: `${f.yearMin || "Any"}–${f.yearMax || "Any"}`, remove: () => setF((s) => ({ ...s, yearMin: "", yearMax: "" })) });
    if (f.priceMin || f.priceMax) c.push({ id: "price", text: `$${f.priceMin || "0"}–${f.priceMax ? `$${f.priceMax}` : "any"}`, remove: () => setF((s) => ({ ...s, priceMin: "", priceMax: "" })) });
    f.options.forEach((o) => c.push({ id: `opt-${o}`, text: o, remove: () => setF((s) => ({ ...s, options: s.options.filter((x) => x !== o) })) }));
    return c;
  }, [f, setF]);

  const models = f.makes.length === 1 ? MODELS[f.makes[0]] ?? [] : [];
  // Stub count only, to make the layout feel real. Not a query.
  const count = Math.max(0, 482113 - chips.length * 61240 - (f.makes.length ? 120000 : 0));

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-white">Filters</h2>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setF(EMPTY)} className="text-xs font-semibold text-brand-300 hover:text-brand-200">Clear all</button>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close filters" className="text-ink-light hover:text-white">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-border px-4 pb-3">
        <p className="text-xs text-ink-light"><span className="font-bold text-white">{count.toLocaleString()}</span> vehicles</p>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button key={c.id} type="button" onClick={c.remove} className="inline-flex items-center gap-1 rounded-full border border-brand-500/50 bg-brand-500/10 py-1 pl-2.5 pr-2 text-[11px] font-semibold text-brand-300 hover:bg-brand-500/20" aria-label={`Remove ${c.text}`}>
                {c.text}
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3l6 6M9 3L3 9" strokeLinecap="round" /></svg>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Condition" badge={f.cond ? 1 : 0} open={open.condition} onToggle={() => toggle("condition")}>
          <div className="flex gap-2">
            {([["new", "New"], ["used", "Used"], ["cpo", "Certified"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setF((s) => ({ ...s, cond: s.cond === v ? "" : v }))} className={`${pill(f.cond === v)} flex-1`} aria-pressed={f.cond === v}>{label}</button>
            ))}
          </div>
        </Section>

        <Section title="Location" badge={(f.state ? 1 : 0) + (f.zip ? 1 : 0)} open={open.location} onToggle={() => toggle("location")}>
          <p className="mb-2 text-xs text-ink-faint">Pick a state, or enter a ZIP and radius to search near you.</p>
          <select value={f.state} onChange={(e) => setF((s) => ({ ...s, state: e.target.value }))} className={`${input} mb-2`} aria-label="State">
            <option value="">All states</option>
            {STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <div className="flex gap-2">
            <input value={f.zip} onChange={(e) => setF((s) => ({ ...s, zip: e.target.value.replace(/\D/g, "").slice(0, 5) }))} placeholder="ZIP code" inputMode="numeric" className={input} aria-label="ZIP code" />
            <select value={f.radius} onChange={(e) => setF((s) => ({ ...s, radius: e.target.value }))} className={`${input} w-28`} aria-label="Radius">
              <option value="">Radius</option>
              {["25", "50", "100"].map((r) => <option key={r} value={r}>{r} mi</option>)}
            </select>
          </div>
        </Section>

        <Section title="Make" badge={f.makes.length} open={open.make} onToggle={() => toggle("make")}>
          <div className="flex flex-wrap gap-1.5">
            {MAKES.map((m) => (
              <button key={m} type="button" onClick={() => setF((s) => ({ ...s, makes: flip(s.makes, m), model: "" }))} className={pill(f.makes.includes(m))} aria-pressed={f.makes.includes(m)}>{m}</button>
            ))}
          </div>
        </Section>

        <Section title="Model" badge={f.model ? 1 : 0} open={open.model} onToggle={() => toggle("model")}>
          {models.length === 0 ? (
            <p className="text-xs text-ink-faint">Choose a single make to see its models.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {models.map((m) => <button key={m} type="button" onClick={() => setF((s) => ({ ...s, model: s.model === m ? "" : m }))} className={pill(f.model === m)} aria-pressed={f.model === m}>{m}</button>)}
            </div>
          )}
        </Section>

        <Section title="Trim" badge={f.trims.length} open={open.trim} onToggle={() => toggle("trim")}>
          {!f.model ? (
            <p className="text-xs text-ink-faint">Choose a model to see its trims.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {TRIMS.map((t) => <button key={t} type="button" onClick={() => setF((s) => ({ ...s, trims: flip(s.trims, t) }))} className={pill(f.trims.includes(t))} aria-pressed={f.trims.includes(t)}>{t}</button>)}
            </div>
          )}
        </Section>

        <Section title="Year" badge={f.yearMin || f.yearMax ? 1 : 0} open={open.year} onToggle={() => toggle("year")}>
          <div className="flex items-center gap-2">
            <select value={f.yearMin} onChange={(e) => setF((s) => ({ ...s, yearMin: e.target.value }))} className={input} aria-label="Minimum year"><option value="">Min</option>{[...YEARS].reverse().map((y) => <option key={y}>{y}</option>)}</select>
            <span className="text-ink-faint">–</span>
            <select value={f.yearMax} onChange={(e) => setF((s) => ({ ...s, yearMax: e.target.value }))} className={input} aria-label="Maximum year"><option value="">Max</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select>
          </div>
        </Section>

        <Section title="Price" badge={f.priceMin || f.priceMax ? 1 : 0} open={open.price} onToggle={() => toggle("price")}>
          <div className="flex items-center gap-2">
            <input value={f.priceMin} onChange={(e) => setF((s) => ({ ...s, priceMin: e.target.value.replace(/\D/g, "") }))} placeholder="$ Min" inputMode="numeric" className={input} aria-label="Minimum price" />
            <span className="text-ink-faint">–</span>
            <input value={f.priceMax} onChange={(e) => setF((s) => ({ ...s, priceMax: e.target.value.replace(/\D/g, "") }))} placeholder="$ Max" inputMode="numeric" className={input} aria-label="Maximum price" />
          </div>
        </Section>

        <Section title="Factory options" badge={f.options.length} open={open.options} onToggle={() => toggle("options")}>
          {!f.model ? (
            <p className="text-xs text-ink-faint">Choose a model to filter by factory options.</p>
          ) : (
            <ul className="space-y-1.5">
              {OPTIONS.map((o) => (
                <li key={o}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-light hover:text-white">
                    <input type="checkbox" checked={f.options.includes(o)} onChange={() => setF((s) => ({ ...s, options: flip(s.options, o) }))} className="h-4 w-4 accent-brand-500" />
                    {o}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {onClose && (
        <div className="border-t border-border p-3">
          <button type="button" onClick={onClose} className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-bold text-black hover:bg-brand-400">Show {count.toLocaleString()} vehicles</button>
        </div>
      )}
    </div>
  );
}

export default function SearchFiltersMockPage() {
  const [f, setF] = useState<F>(EMPTY);
  const [drawer, setDrawer] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop: fixed left column, full height. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[300px] border-r border-border md:block">
        <FiltersPanel f={f} setF={setF} />
      </aside>

      {/* Mobile: slide-over drawer. */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <span className="text-sm font-bold text-white">Mock · filters only</span>
        <button type="button" onClick={() => setDrawer(true)} className="rounded-lg border border-border-strong bg-surface-elevated px-3 py-1.5 text-xs font-bold text-white">Filters</button>
      </div>
      <div className={`fixed inset-0 z-40 md:hidden ${drawer ? "" : "pointer-events-none"}`} aria-hidden={!drawer}>
        <div onClick={() => setDrawer(false)} className={`absolute inset-0 bg-black/60 transition-opacity ${drawer ? "opacity-100" : "opacity-0"}`} />
        <div className={`absolute inset-y-0 left-0 w-[88%] max-w-sm border-r border-border transition-transform ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
          <FiltersPanel f={f} setF={setF} onClose={() => setDrawer(false)} />
        </div>
      </div>

      <main className="p-8 md:ml-[300px]">
        <p className="max-w-md text-sm text-ink-faint">
          UI mock. Filter column only; results grid intentionally omitted. State is local, nothing here calls an API or changes /search.
        </p>
      </main>
    </div>
  );
}
