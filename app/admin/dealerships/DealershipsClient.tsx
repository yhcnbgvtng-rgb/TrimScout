"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Building2,
  ArrowLeft,
  Plus,
  Pencil as Edit3,
  Trash2,
  X,
  Search,
  Loader2,
  CircleCheck as CheckCircle2,
  TriangleAlert as AlertTriangle,
  Phone,
  Mail,
  MapPin,
  Upload,
} from "lucide-react";
import type { Dealership, DealershipInput, BulkUpsertResult } from "@/lib/dealershipsApi";
import { parseDealershipCsv, type DealershipCsvParseResult } from "@/lib/dealershipCsv";

const EMPTY_FORM: DealershipInput = {
  dealerName: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  phone: "",
  contactName: "",
  contactEmail: "",
  notes: "",
};

export default function DealershipsClient() {
  const [dealerships, setDealerships] = useState<Dealership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const [editing, setEditing] = useState<Dealership | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<DealershipInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvPreview, setCsvPreview] = useState<DealershipCsvParseResult | null>(null);
  const [csvParseError, setCsvParseError] = useState<string | null>(null);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadResult, setUploadResult] = useState<BulkUpsertResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3000);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/dealerships");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load dealerships");
      setDealerships(json.dealerships);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dealerships");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openUpload = () => {
    setCsvFileName(null);
    setCsvPreview(null);
    setCsvParseError(null);
    setUploadResult(null);
    setIsUploadOpen(true);
  };

  const handleFileSelected = async (file: File) => {
    setCsvFileName(file.name);
    setCsvParseError(null);
    setCsvPreview(null);
    setUploadResult(null);
    const isXlsx =
      file.name.toLowerCase().endsWith(".xlsx") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    try {
      let parsed: DealershipCsvParseResult;
      if (isXlsx) {
        // .xlsx parsing needs the `exceljs` package, which isn't meant for
        // a browser bundle — send the raw file to a server route instead of
        // parsing it here, same result shape either way.
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/admin/dealerships/parse-xlsx", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not read that file.");
        parsed = json as DealershipCsvParseResult;
      } else {
        const text = await file.text();
        parsed = parseDealershipCsv(text);
      }
      if (parsed.rows.length === 0) {
        setCsvParseError("No rows with a recognizable dealer name were found in this file.");
        return;
      }
      setCsvPreview(parsed);
    } catch (err) {
      setCsvParseError(
        err instanceof Error ? err.message : "Could not read that file. Make sure it's a CSV or Excel export from your spreadsheet."
      );
    }
  };

  const handleConfirmUpload = async () => {
    if (!csvPreview || csvPreview.rows.length === 0) return;
    setUploadSubmitting(true);
    try {
      const res = await fetch("/api/admin/dealerships/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealerships: csvPreview.rows }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed");
      setUploadResult(json as BulkUpsertResult);
      showToast(`Imported ${json.created + json.updated} dealerships.`);
      load();
    } catch (err) {
      setCsvParseError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setUploadSubmitting(false);
    }
  };

  const openEdit = (d: Dealership) => {
    setEditing(d);
    setForm({
      dealerName: d.dealerName,
      address: d.address || "",
      city: d.city || "",
      state: d.state || "",
      zipCode: d.zipCode || "",
      phone: d.phone || "",
      contactName: d.contactName || "",
      contactEmail: d.contactEmail || "",
      notes: d.notes || "",
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.dealerName.trim()) {
      setFormError("Dealership name is required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(editing ? `/api/admin/dealerships/${editing.id}` : "/api/admin/dealerships", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save dealership");
      setIsFormOpen(false);
      showToast(editing ? "Dealership updated." : "Dealership added.");
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save dealership");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (d: Dealership) => {
    if (!confirm(`Remove ${d.dealerName} from the directory?`)) return;
    try {
      const res = await fetch(`/api/admin/dealerships/${d.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete dealership");
      setDealerships((prev) => prev.filter((x) => x.id !== d.id));
      showToast("Dealership removed.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete dealership");
    }
  };

  const filtered = dealerships.filter((d) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.dealerName.toLowerCase().includes(q) ||
      (d.city || "").toLowerCase().includes(q) ||
      (d.state || "").toLowerCase().includes(q) ||
      (d.contactName || "").toLowerCase().includes(q) ||
      (d.contactEmail || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-rose-500/30 bg-surface/70 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/admin" className="flex items-center gap-2.5 group select-none">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500 text-black shadow-md shadow-rose-500/20 group-hover:scale-105 transition-transform">
              <ArrowLeft className="h-4.5 w-4.5 stroke-[2.5]" />
            </div>
            <span className="font-black text-lg tracking-tight text-white">Back to Admin Portal</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {successToast && (
          <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-emerald-500/40 bg-surface-elevated/95 backdrop-blur-md p-4 text-xs text-white shadow-2xl flex items-center gap-3 animate-fadeIn">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <span className="font-semibold">{successToast}</span>
          </div>
        )}

        <div className="rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/30 to-blue-500/20 text-emerald-400 border border-emerald-500/40 shadow-inner">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">Dealership Contacts</h1>
              <p className="text-xs text-ink-muted">Manually maintained directory of dealership contact info</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openUpload}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3.5 py-2 text-xs font-bold text-ink-light hover:text-white transition-all shadow-sm"
            >
              <Upload className="h-3.5 w-3.5 text-emerald-400" />
              <span>Upload Spreadsheet</span>
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Dealership</span>
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl space-y-5">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, city, state, contact..."
              className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface-elevated text-[10px] uppercase font-bold text-ink-faint tracking-wider">
                <tr>
                  <th className="py-3 px-4">Dealership</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Notes</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-ink-muted">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Loading dealerships…</span>
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-rose-400">
                      {error}
                    </td>
                  </tr>
                ) : filtered.length > 0 ? (
                  filtered.map((d) => (
                    <tr key={d.id} className="hover:bg-surface-elevated/70 transition-colors">
                      <td className="py-3.5 px-4 min-w-[180px] font-bold text-white">{d.dealerName}</td>
                      <td className="py-3.5 px-4 text-[11px] text-ink-muted">
                        {d.address && <div className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{d.address}</div>}
                        <div>{[d.city, d.state, d.zipCode].filter(Boolean).join(", ")}</div>
                      </td>
                      <td className="py-3.5 px-4 text-[11px]">
                        {d.contactName && <div className="text-white font-medium">{d.contactName}</div>}
                        {d.phone && (
                          <div className="flex items-center gap-1 text-ink-muted"><Phone className="h-3 w-3" />{d.phone}</div>
                        )}
                        {d.contactEmail && (
                          <div className="flex items-center gap-1 text-ink-muted font-mono"><Mail className="h-3 w-3" />{d.contactEmail}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-[11px] text-ink-muted max-w-[220px] truncate">{d.notes}</td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(d)}
                            className="p-1.5 rounded-lg border border-border bg-surface-elevated hover:text-white text-ink-muted hover:border-border-strong transition-all"
                            title="Edit"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(d)}
                            className="p-1.5 rounded-lg border border-border hover:border-rose-500/60 bg-surface-elevated hover:bg-rose-950/40 text-ink-faint hover:text-rose-400 transition-all"
                            title="Remove"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-ink-muted">
                      No dealerships yet — click "Add Dealership" to start the directory.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-3xl border border-border-strong bg-surface p-6 sm:p-8 shadow-2xl space-y-6 animate-fadeIn my-8">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h3 className="text-sm font-bold text-white">{editing ? `Edit ${editing.dealerName}` : "Add Dealership"}</h3>
              <button onClick={() => setIsFormOpen(false)} className="text-ink-muted hover:text-white p-1 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {formError && (
                <div className="rounded-xl border border-rose-500/60 bg-rose-950/60 p-3 text-xs text-rose-200 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-ink-faint">Dealership Name</label>
                <input
                  type="text"
                  required
                  value={form.dealerName}
                  onChange={(e) => setForm({ ...form, dealerName: e.target.value })}
                  placeholder="e.g. Stevens Creek Chevrolet"
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-ink-faint">Address</label>
                <input
                  type="text"
                  value={form.address || ""}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">City</label>
                  <input
                    type="text"
                    value={form.city || ""}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">State</label>
                  <input
                    type="text"
                    maxLength={2}
                    value={form.state || ""}
                    onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white uppercase focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Zip</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={form.zipCode || ""}
                    onChange={(e) => setForm({ ...form, zipCode: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Contact Name</label>
                  <input
                    type="text"
                    value={form.contactName || ""}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Phone</label>
                  <input
                    type="text"
                    value={form.phone || ""}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-ink-faint">Contact Email</label>
                <input
                  type="email"
                  value={form.contactEmail || ""}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-ink-faint">Notes</label>
                <textarea
                  value={form.notes || ""}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-ink-muted hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 px-5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20"
                >
                  {submitting ? "Saving…" : editing ? "Save Changes" : "Add Dealership"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-3xl border border-border-strong bg-surface p-6 sm:p-8 shadow-2xl space-y-5 animate-fadeIn my-8">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-sm font-bold text-white">Upload Contact Spreadsheet</h3>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  Any manufacturer's dealer-contact export (CSV or Excel .xlsx) — matched by column name, not a fixed format.
                </p>
              </div>
              <button onClick={() => setIsUploadOpen(false)} className="text-ink-muted hover:text-white p-1 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div
                className="rounded-xl border border-dashed border-border bg-background p-5 text-center cursor-pointer hover:border-emerald-500/60 transition-all"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelected(file);
                    e.target.value = "";
                  }}
                />
                <Upload className="h-6 w-6 mx-auto text-emerald-400 mb-2" />
                <p className="text-ink-light font-semibold">
                  {csvFileName ? csvFileName : "Click to choose a CSV or Excel file"}
                </p>
                <p className="text-[10.5px] text-ink-faint mt-1">
                  Columns recognized: Dealer Name, Address, City, State, Zip, Phone, GM/Contact Name, GM/Contact Email, Notes
                </p>
              </div>

              {csvParseError && (
                <div className="rounded-xl border border-rose-500/60 bg-rose-950/60 p-3 text-rose-200 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>{csvParseError}</span>
                </div>
              )}

              {csvPreview && !uploadResult && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-emerald-200">
                    Found <strong>{csvPreview.rows.length}</strong> dealership
                    {csvPreview.rows.length === 1 ? "" : "s"} to import
                    {csvPreview.skippedRows > 0 ? `, skipped ${csvPreview.skippedRows} row(s) with no dealer name` : ""}.
                    Matching by dealer name — existing dealerships will be updated, new ones created.
                  </div>
                  {csvPreview.unrecognizedColumns.length > 0 && (
                    <div className="rounded-xl border border-border bg-background p-3 text-ink-muted">
                      Ignored columns (no match): {csvPreview.unrecognizedColumns.join(", ")}
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-xl border border-border max-h-52 overflow-y-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="border-b border-border bg-surface-elevated text-[9.5px] uppercase font-bold text-ink-faint sticky top-0">
                        <tr>
                          <th className="py-2 px-3">Dealer</th>
                          <th className="py-2 px-3">City/State</th>
                          <th className="py-2 px-3">Contact</th>
                          <th className="py-2 px-3">Email</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {csvPreview.rows.slice(0, 8).map((row, i) => (
                          <tr key={i}>
                            <td className="py-1.5 px-3 text-white font-semibold">{row.dealerName}</td>
                            <td className="py-1.5 px-3 text-ink-muted">
                              {[row.city, row.state].filter(Boolean).join(", ")}
                            </td>
                            <td className="py-1.5 px-3 text-ink-muted">{row.contactName || "—"}</td>
                            <td className="py-1.5 px-3 text-ink-muted font-mono">{row.contactEmail || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {csvPreview.rows.length > 8 && (
                    <p className="text-[10.5px] text-ink-faint">…and {csvPreview.rows.length - 8} more.</p>
                  )}
                </div>
              )}

              {uploadResult && (
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>
                    Done — {uploadResult.created} created, {uploadResult.updated} updated
                    {uploadResult.skipped > 0 ? `, ${uploadResult.skipped} skipped` : ""}.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-ink-muted hover:text-white"
                >
                  {uploadResult ? "Close" : "Cancel"}
                </button>
                {!uploadResult && (
                  <button
                    type="button"
                    disabled={!csvPreview || csvPreview.rows.length === 0 || uploadSubmitting}
                    onClick={handleConfirmUpload}
                    className="rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 px-5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20"
                  >
                    {uploadSubmitting
                      ? "Importing…"
                      : csvPreview
                      ? `Import ${csvPreview.rows.length} Dealership${csvPreview.rows.length === 1 ? "" : "s"}`
                      : "Import"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
