"use client";

// The web-crawl sheet: every dealer row the crawls produced, laid out like a spreadsheet. Column filters,
// a free-text search, click-to-sort, hideable columns, and a CSV of exactly what's on screen. Rows are
// windowed (only the visible slice is in the DOM) so 18k rows scroll like a sheet.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, RefreshCw, Search, Table2, X } from "lucide-react";
import { CRAWL_SHEET_COLUMNS, crawlRowCell, crawlRowsToCsv, crawlSheetFilename, type CrawlRow } from "@/lib/crawlSheetColumns";

type ColKey = keyof CrawlRow;
type Facet = "brands" | "state" | "emailKind" | "emailSource" | "staffPage";
type Tri = "any" | "yes" | "no";

const FACETS: Array<{ key: Facet; label: string; pretty?: (v: string) => string }> = [
  { key: "brands", label: "Brand" },
  { key: "state", label: "State" },
  { key: "emailKind", label: "Email kind", pretty: (v) => ({ named: "Named person", generic: "Generic inbox", none: "No email" })[v] || v },
  { key: "emailSource", label: "Email source", pretty: (v) => ({ staff_page: "Staff page", html_recovery: "HTML recovery", lead_inbox: "Lead inbox", enrichment: "Enrichment file", manual: "Manual / other", "": "—" })[v] ?? v },
  { key: "staffPage", label: "Staff page", pretty: (v) => ({ captured: "Captured", blocked: "Blocked", no_staff_page: "No staff page", no_website: "No website", unknown: "Not crawled" })[v] || v },
];

const DEFAULT_HIDDEN: ColKey[] = ["domains", "address", "emailOptOut", "notes", "leadInbox"];
const ROW_H = 34;
const OVERSCAN = 12;

const COL_WIDTH: Partial<Record<ColKey, number>> = {
  dealerName: 260, brands: 120, city: 130, state: 60, zip: 70, phone: 120, website: 220, contactName: 160, contactTitle: 170, contactEmail: 230,
  emailKind: 110, contactReady: 100, emailSource: 120, staffPage: 110, source: 260, leadInbox: 200, domains: 220, address: 200, emailOptOut: 80, updatedAt: 110, notes: 480,
};

function pretty(key: ColKey, v: string): string {
  const f = FACETS.find((x) => x.key === key);
  return f?.pretty ? f.pretty(v) : v;
}

export default function CrawlSheetClient() {
  const [rows, setRows] = useState<CrawlRow[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState<Record<Facet, Set<string>>>({ brands: new Set(), state: new Set(), emailKind: new Set(), emailSource: new Set(), staffPage: new Set() });
  const [contactReady, setContactReady] = useState<Tri>("any");
  const [hasPhone, setHasPhone] = useState<Tri>("any");
  const [hasWebsite, setHasWebsite] = useState<Tri>("any");
  const [sort, setSort] = useState<{ key: ColKey; dir: 1 | -1 }>({ key: "dealerName", dir: 1 });
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set(DEFAULT_HIDDEN));
  const [colsOpen, setColsOpen] = useState(false);
  const [openFacet, setOpenFacet] = useState<Facet | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crawl-sheet", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load the crawl sheet.");
      setRows(json.rows as CrawlRow[]);
      setFetchedAt(json.fetchedAt || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the crawl sheet.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Dropdowns close on an outside click or Escape, like the download menu on the contacts page.
  const menusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!menusRef.current?.contains(e.target as Node)) { setOpenFacet(null); setColsOpen(false); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpenFacet(null); setColsOpen(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  // Facet options come from the full data set (with counts), so a filter never hides its own alternatives.
  const facetOptions = useMemo(() => {
    const out: Record<Facet, Array<[string, number]>> = { brands: [], state: [], emailKind: [], emailSource: [], staffPage: [] };
    for (const f of FACETS) {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const vals = f.key === "brands" ? (r.brands.length ? r.brands : ["(none)"]) : [String(r[f.key] ?? "")];
        for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
      }
      out[f.key] = Array.from(counts).sort((a, b) => (f.key === "brands" || f.key === "state" ? a[0].localeCompare(b[0]) : b[1] - a[1]));
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tri = (t: Tri, v: boolean) => t === "any" || (t === "yes") === v;
    return rows.filter((r) => {
      if (facets.brands.size && !(r.brands.length ? r.brands : ["(none)"]).some((b) => facets.brands.has(b))) return false;
      if (facets.state.size && !facets.state.has(r.state)) return false;
      if (facets.emailKind.size && !facets.emailKind.has(r.emailKind)) return false;
      if (facets.emailSource.size && !facets.emailSource.has(r.emailSource)) return false;
      if (facets.staffPage.size && !facets.staffPage.has(r.staffPage)) return false;
      if (!tri(contactReady, r.contactReady) || !tri(hasPhone, Boolean(r.phone)) || !tri(hasWebsite, Boolean(r.website))) return false;
      if (!q) return true;
      return [r.dealerName, r.city, r.zip, r.phone, r.website, r.contactName, r.contactTitle, r.contactEmail, r.source, r.leadInbox, r.domains.join(" "), r.notes].some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, query, facets, contactReady, hasPhone, hasWebsite]);

  const sorted = useMemo(() => {
    const key = sort.key;
    const val = (r: CrawlRow) => crawlRowCell(r, key).toLowerCase();
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av === bv) return a.dealerName.localeCompare(b.dealerName);
      if (!av) return 1;
      if (!bv) return -1;
      return av < bv ? -sort.dir : sort.dir;
    });
  }, [filtered, sort]);

  const columns = CRAWL_SHEET_COLUMNS.filter((c) => !hidden.has(c.key));
  const totalW = columns.reduce((s, c) => s + (COL_WIDTH[c.key] || 140), 0);
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(sorted.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);
  const slice = sorted.slice(start, end);

  const toggleFacet = (f: Facet, v: string) => setFacets((prev) => { const next = new Set(prev[f]); if (next.has(v)) next.delete(v); else next.add(v); return { ...prev, [f]: next }; });
  const clearAll = () => { setQuery(""); setFacets({ brands: new Set(), state: new Set(), emailKind: new Set(), emailSource: new Set(), staffPage: new Set() }); setContactReady("any"); setHasPhone("any"); setHasWebsite("any"); };
  const activeFilters = Object.values(facets).reduce((n, s) => n + s.size, 0) + (contactReady !== "any" ? 1 : 0) + (hasPhone !== "any" ? 1 : 0) + (hasWebsite !== "any" ? 1 : 0) + (query.trim() ? 1 : 0);

  const download = () => {
    const csv = crawlRowsToCsv(sorted, columns.map((c) => c.key));
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = crawlSheetFilename();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onHeaderClick = (key: ColKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const stats = useMemo(() => ({
    named: filtered.filter((r) => r.contactName).length,
    emails: filtered.filter((r) => r.emailKind === "named").length,
    ready: filtered.filter((r) => r.contactReady).length,
  }), [filtered]);

  const TriSelect = ({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) => (
    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as Tri)} className="rounded-lg border border-border bg-surface-elevated px-2 py-1 text-[11px] font-bold text-ink-light">
        <option value="any">any</option><option value="yes">yes</option><option value="no">no</option>
      </select>
    </label>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-rose-500/30 bg-surface/70 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-[1800px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/admin" className="flex items-center gap-2.5 group select-none">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500 text-black shadow-md shadow-rose-500/20 group-hover:scale-105 transition-transform">
              <ArrowLeft className="h-4.5 w-4.5 stroke-[2.5]" />
            </div>
            <span className="font-black text-lg tracking-tight text-white">Back to Admin Portal</span>
          </Link>
          <Link href="/admin/dealerships" className="text-xs font-bold text-ink-muted hover:text-white">Dealership Contacts →</Link>
        </div>
      </header>

      <main ref={menusRef} className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8 space-y-4">
        <div className="rounded-3xl border border-border-strong bg-surface p-5 shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/30 to-blue-500/20 text-emerald-400 border border-emerald-500/40 shadow-inner">
              <Table2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">Web Crawl Sheet</h1>
              <p className="text-xs text-ink-muted">
                Every dealer row the crawls produced — brand, contact, where the email came from, staff-page result.{" "}
                {fetchedAt ? <span className="text-ink-faint">Loaded {new Date(fetchedAt).toLocaleTimeString()}.</span> : null}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-[11px] font-bold text-ink-light tabular-nums">
              <span className="text-white">{sorted.length.toLocaleString()}</span> of {rows.length.toLocaleString()} rows
              <span className="text-ink-faint"> · </span>{stats.named.toLocaleString()} named<span className="text-ink-faint"> · </span>{stats.emails.toLocaleString()} personal emails
              <span className="text-ink-faint"> · </span><span className="text-emerald-400">{stats.ready.toLocaleString()} contact-ready</span>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-xs font-bold text-ink-light hover:text-white transition-all disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Reload
            </button>
            <div className="relative">
              <button type="button" onClick={() => setColsOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-xs font-bold text-ink-light hover:text-white transition-all">
                <Columns3 className="h-3.5 w-3.5" /> Columns ({columns.length})
              </button>
              {colsOpen && (
                <div className="absolute right-0 mt-1.5 w-56 rounded-xl border border-border bg-surface-elevated shadow-2xl p-2 z-30 grid grid-cols-1 gap-0.5">
                  {CRAWL_SHEET_COLUMNS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] font-semibold text-ink-light hover:bg-surface cursor-pointer">
                      <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} className="accent-emerald-500" />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={download} disabled={loading || sorted.length === 0} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition-all disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> Download CSV ({sorted.length.toLocaleString()})
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
            <input
              id="crawl-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search dealer, city, contact, email, source, notes…"
              className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3 py-2 text-xs text-white placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>
          {FACETS.map((f) => (
            <div key={f.key} className="relative">
              <button type="button" onClick={() => setOpenFacet((o) => (o === f.key ? null : f.key))} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-bold transition-all ${facets[f.key].size ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-border bg-surface-elevated text-ink-light hover:text-white"}`}>
                {f.label}{facets[f.key].size ? ` · ${facets[f.key].size}` : ""}
              </button>
              {openFacet === f.key && (
                <div className="absolute left-0 mt-1.5 w-64 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface-elevated shadow-2xl p-2 z-30">
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-ink-faint">{f.label}</span>
                    {facets[f.key].size > 0 && <button type="button" onClick={() => setFacets((p) => ({ ...p, [f.key]: new Set() }))} className="text-[10px] font-bold text-ink-muted hover:text-white">clear</button>}
                  </div>
                  {facetOptions[f.key].map(([v, n]) => (
                    <label key={v} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px] font-semibold text-ink-light hover:bg-surface cursor-pointer">
                      <span className="flex items-center gap-2 min-w-0"><input type="checkbox" checked={facets[f.key].has(v)} onChange={() => toggleFacet(f.key, v)} className="accent-emerald-500" /><span className="truncate">{pretty(f.key, v) || "—"}</span></span>
                      <span className="text-ink-faint tabular-nums">{n.toLocaleString()}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <TriSelect label="Contact-ready" value={contactReady} onChange={setContactReady} />
          <TriSelect label="Phone" value={hasPhone} onChange={setHasPhone} />
          <TriSelect label="Website" value={hasWebsite} onChange={setHasWebsite} />
          {activeFilters > 0 && (
            <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] font-bold text-rose-300 hover:text-white">
              <X className="h-3 w-3" /> Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {error && <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</div>}

        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
          <div
            ref={scrollerRef}
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
            className="overflow-auto"
            style={{ height: "calc(100vh - 290px)", minHeight: 360 }}
          >
            <div style={{ width: totalW, minWidth: "100%" }}>
              <div className="sticky top-0 z-20 flex border-b border-border bg-surface-elevated" style={{ height: ROW_H }}>
                {columns.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => onHeaderClick(c.key)}
                    title={`Sort by ${c.label}`}
                    className="flex items-center gap-1 border-r border-border/60 px-2.5 text-left text-[10.5px] font-black uppercase tracking-wider text-ink-faint hover:text-white shrink-0"
                    style={{ width: COL_WIDTH[c.key] || 140 }}
                  >
                    <span className="truncate">{c.label}</span>
                    {sort.key === c.key ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3 text-emerald-400 shrink-0" /> : <ArrowDown className="h-3 w-3 text-emerald-400 shrink-0" />) : <ArrowUpDown className="h-3 w-3 opacity-30 shrink-0" />}
                  </button>
                ))}
              </div>
              {loading ? (
                <div className="p-8 text-center text-xs text-ink-muted">Loading {rows.length ? "" : "the directory"}…</div>
              ) : sorted.length === 0 ? (
                <div className="p-8 text-center text-xs text-ink-muted">No rows match these filters.</div>
              ) : (
                <div style={{ height: sorted.length * ROW_H, position: "relative" }}>
                  {slice.map((r, i) => {
                    const idx = start + i;
                    return (
                      <div
                        key={r.id}
                        className={`absolute left-0 right-0 flex border-b border-border/40 text-[11.5px] ${idx % 2 ? "bg-surface" : "bg-surface-elevated/40"} hover:bg-emerald-500/5`}
                        style={{ top: idx * ROW_H, height: ROW_H }}
                      >
                        {columns.map((c) => {
                          const v = crawlRowCell(r, c.key);
                          const isLink = (c.key === "website" || c.key === "source") && /^https?:\/\//.test(v);
                          const tone =
                            c.key === "contactReady" && r.contactReady ? "text-emerald-400 font-bold"
                            : c.key === "emailKind" ? (r.emailKind === "named" ? "text-emerald-300" : r.emailKind === "generic" ? "text-amber-300" : "text-ink-faint")
                            : c.key === "staffPage" ? (r.staffPage === "captured" ? "text-ink-light" : r.staffPage === "blocked" ? "text-amber-300" : "text-ink-faint")
                            : c.key === "contactEmail" || c.key === "phone" || c.key === "zip" ? "font-mono text-ink-light"
                            : c.key === "dealerName" ? "font-semibold text-white"
                            : "text-ink-light";
                          return (
                            <div key={c.key} className={`flex items-center border-r border-border/40 px-2.5 shrink-0 overflow-hidden whitespace-nowrap ${tone}`} style={{ width: COL_WIDTH[c.key] || 140 }} title={v}>
                              {isLink ? <a href={v} target="_blank" rel="noopener noreferrer" className="truncate text-sky-300 hover:underline">{v.replace(/^https?:\/\/(www\.)?/, "")}</a> : <span className="truncate">{pretty(c.key, v)}</span>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-ink-faint max-w-3xl">
          <span className="text-emerald-400 font-bold">Contact-ready</span> = a named person at a personal mailbox who hasn&apos;t opted out — the only rows a quote request is sent to. Generic inboxes (sales@, info@) are kept on file but never emailed. The CSV contains the rows and columns currently shown, in the order shown.
        </p>
      </main>
    </div>
  );
}
