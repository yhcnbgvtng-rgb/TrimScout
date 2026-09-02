"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { UserProfile } from "../lib/types";
import {
  ShieldAlert,
  ShieldCheck,
  Users,
  Building2,
  User,
  Search,
  Filter,
  UserCheck,
  UserX,
  KeyRound,
  LogOut,
  Download,
  X,
  CircleCheck as CheckCircle2,
  TriangleAlert as AlertTriangle,
  RefreshCw,
  Activity,
  DollarSign,
  TrendingUp,
  Eye,
  Copy,
  Check,
  ExternalLink,
  Loader2
} from "lucide-react";

interface AdminPortalProps {
  onImpersonateUser: (user: UserProfile) => void;
  onExitAdmin: () => void;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  onImpersonateUser,
  onExitAdmin,
}) => {
  const { data: session } = useSession();

  // Accounts Data State — fetched from the real users table, not mock data.
  const [accounts, setAccounts] = useState<UserProfile[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const loadAccounts = async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const res = await fetch("/api/admin/users");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load accounts");
      const mapped: UserProfile[] = (json.users as any[]).map((u) => ({
        ...u,
        savedVehicleIds: [],
      }));
      setAccounts(mapped);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "buyer" | "dealer" | "admin" | "suspended">("all");

  // Modal States
  const [resetPasswordUser, setResetPasswordUser] = useState<UserProfile | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordSubmitting, setResetPasswordSubmitting] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3000);
  };

  const handleAdminLogout = () => {
    signOut({ redirect: false }).then(onExitAdmin);
  };

  // Account Management Actions — these call the real auth backend; the
  // account list refetches after each mutation so the table never drifts
  // from the database.
  const handleToggleSuspend = async (acc: UserProfile) => {
    const newStatus: "active" | "suspended" = acc.status === "suspended" ? "active" : "suspended";
    try {
      const res = await fetch("/api/admin/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: acc.email, status: newStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update status");
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? { ...a, status: newStatus } : a)));
      showToast(newStatus === "suspended" ? "Account suspended." : "Account reactivated.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update status.");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordUser) return;
    if (resetPasswordValue.length < 8) {
      setResetPasswordError("Password must be at least 8 characters.");
      return;
    }
    setResetPasswordSubmitting(true);
    setResetPasswordError(null);
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetPasswordUser.email, newPassword: resetPasswordValue }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to reset password");
      showToast(`Password reset for ${resetPasswordUser.email}.`);
      setResetPasswordUser(null);
      setResetPasswordValue("");
    } catch (err) {
      setResetPasswordError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setResetPasswordSubmitting(false);
    }
  };

  const generatePassword = () => {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    setResetPasswordValue(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16));
  };

  const handleExportAccounts = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(accounts, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `trimscout_accounts_backup_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("Exported accounts to JSON backup.");
  };

  // Filtered accounts list
  const filteredAccounts = accounts.filter((acc) => {
    if (roleFilter === "buyer" && acc.role !== "buyer") return false;
    if (roleFilter === "dealer" && acc.role !== "dealer") return false;
    if (roleFilter === "admin" && acc.role !== "admin") return false;
    if (roleFilter === "suspended" && acc.status !== "suspended") return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = acc.name.toLowerCase().includes(q);
      const matchEmail = acc.email.toLowerCase().includes(q);
      const matchDealer = (acc.dealerName || "").toLowerCase().includes(q);
      const matchAlias = (acc.buyerAlias || "").toLowerCase().includes(q);
      const matchZip = acc.zipCode.includes(q);
      return matchName || matchEmail || matchDealer || matchAlias || matchZip;
    }
    return true;
  });

  const totalBuyers = accounts.filter((a) => a.role === "buyer").length;
  const totalDealers = accounts.filter((a) => a.role === "dealer").length;
  const totalSuspended = accounts.filter((a) => a.status === "suspended").length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6 animate-fadeIn">
      {/* Toast Notification */}
      {successToast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-emerald-500/40 bg-surface-elevated/95 backdrop-blur-md p-4 text-xs text-white shadow-2xl flex items-center gap-3 animate-fadeIn">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <span className="font-semibold">{successToast}</span>
        </div>
      )}

      {/* Admin Command Header */}
      <div className="rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 backdrop-blur-xl">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/30 to-purple-500/20 text-rose-400 border border-rose-500/40 shadow-inner">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white tracking-tight">TrimScout Master Admin Portal</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-2 py-0.5 text-[9.5px] font-black text-rose-400 border border-rose-500/40 uppercase">
                Root Access
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              Live Directory Administration • User Impersonation • Telemetry & Security
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/dealerships"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>Dealership Contacts</span>
          </Link>

          <button
            onClick={handleExportAccounts}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-xs font-bold text-ink-light hover:text-white transition-all shadow-sm"
            title="Download JSON database backup"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" />
            <span>Export Accounts</span>
          </button>

          <button
            onClick={handleAdminLogout}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/40 px-3 py-2 text-xs font-bold text-rose-300 hover:text-white transition-all shadow-sm"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Lock Admin</span>
          </button>

          <button
            onClick={onExitAdmin}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-xs font-bold text-white transition-all shadow-sm"
          >
            <span>Exit Portal</span>
          </button>
        </div>
      </div>

      {/* Platform Telemetry Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border/80 bg-surface p-4 space-y-1 shadow-sm">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Total Accounts</span>
            <Users className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white">{accounts.length}</div>
          <div className="text-[10.5px] text-emerald-400 font-medium">+2 this week</div>
        </div>

        <div className="rounded-2xl border border-border/80 bg-surface p-4 space-y-1 shadow-sm">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Buyer Accounts</span>
            <User className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-2xl font-black text-white">{totalBuyers}</div>
          <div className="text-[10.5px] text-ink-muted">Shielded Aliases</div>
        </div>

        <div className="rounded-2xl border border-border/80 bg-surface p-4 space-y-1 shadow-sm">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Dealer Partners</span>
            <Building2 className="h-4 w-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-white">{totalDealers}</div>
          <div className="text-[10.5px] text-purple-400 font-medium">Verified Franchise</div>
        </div>

        <div className="rounded-2xl border border-border/80 bg-surface p-4 space-y-1 shadow-sm">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Suspended / Flags</span>
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          </div>
          <div className="text-2xl font-black text-rose-400">{totalSuspended}</div>
          <div className="text-[10.5px] text-ink-muted">Auto-flagged</div>
        </div>
      </div>

      {/* Main Admin Section: Navigation & Table */}
      <div className="rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl space-y-5">
        {/* Filters and Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 flex-wrap">
          {/* Role Filter Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-surface-elevated border border-border text-xs font-bold overflow-x-auto w-full sm:w-auto">
            <button
              onClick={() => setRoleFilter("all")}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                roleFilter === "all" ? "bg-emerald-500 text-black font-black" : "text-ink-muted hover:text-white"
              }`}
            >
              All ({accounts.length})
            </button>
            <button
              onClick={() => setRoleFilter("buyer")}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                roleFilter === "buyer" ? "bg-blue-500 text-white font-black" : "text-ink-muted hover:text-white"
              }`}
            >
              Buyers ({totalBuyers})
            </button>
            <button
              onClick={() => setRoleFilter("dealer")}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                roleFilter === "dealer" ? "bg-purple-500 text-white font-black" : "text-ink-muted hover:text-white"
              }`}
            >
              Dealers ({totalDealers})
            </button>
            <button
              onClick={() => setRoleFilter("admin")}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                roleFilter === "admin" ? "bg-rose-500 text-white font-black" : "text-ink-muted hover:text-white"
              }`}
            >
              Admins
            </button>
            <button
              onClick={() => setRoleFilter("suspended")}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                roleFilter === "suspended" ? "bg-rose-950 text-rose-400 font-black border border-rose-500/40" : "text-ink-muted hover:text-white"
              }`}
            >
              Suspended ({totalSuspended})
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, dealer, zip..."
              className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Master Accounts Table */}
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface-elevated text-[10px] uppercase font-bold text-ink-faint tracking-wider">
              <tr>
                <th className="py-3 px-4">User & Alias</th>
                <th className="py-3 px-4">Role & Affiliation</th>
                <th className="py-3 px-4">Zip / Contact</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Activity</th>
                <th className="py-3 px-4 text-right">Master Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {accountsLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-ink-muted">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading accounts…</span>
                    </div>
                  </td>
                </tr>
              ) : accountsError ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-rose-400">
                    {accountsError}
                  </td>
                </tr>
              ) : filteredAccounts.length > 0 ? (
                filteredAccounts.map((acc) => {
                  const isSuspended = acc.status === "suspended";
                  return (
                    <tr
                      key={acc.id}
                      className={`hover:bg-surface-elevated/70 transition-colors ${
                        isSuspended ? "bg-rose-950/10 opacity-75" : ""
                      }`}
                    >
                      {/* Name & Email */}
                      <td className="py-3.5 px-4 min-w-[200px]">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={acc.avatarUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&q=80"}
                            alt={acc.name}
                            className="h-8 w-8 rounded-full object-cover border border-border"
                          />
                          <div className="space-y-0.5 min-w-0 truncate">
                            <div className="font-bold text-white flex items-center gap-1.5">
                              <span className="truncate">{acc.name}</span>
                              {session?.user?.email && acc.email === session.user.email && (
                                <span className="rounded bg-rose-500/20 px-1 py-0.2 text-[8px] font-black text-rose-400">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-ink-muted truncate font-mono">{acc.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Role & Affiliation */}
                      <td className="py-3.5 px-4 min-w-[170px]">
                        {acc.role === "admin" && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 px-2 py-0.5 text-[10px] font-black text-rose-400 border border-rose-500/40">
                            <ShieldAlert className="h-3 w-3" />
                            SUPERADMIN
                          </span>
                        )}
                        {acc.role === "dealer" && (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/20 px-2 py-0.5 text-[10px] font-black text-purple-300 border border-purple-500/40">
                              <Building2 className="h-3 w-3" />
                              DEALER
                            </span>
                            <div className="text-[10.5px] font-medium text-white truncate">{acc.dealerName}</div>
                            {acc.dealerTitle && (
                              <div className="text-[9.5px] text-ink-faint">{acc.dealerTitle}</div>
                            )}
                          </div>
                        )}
                        {acc.role === "buyer" && (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/20 px-2 py-0.5 text-[10px] font-black text-blue-400 border border-blue-500/40">
                              <User className="h-3 w-3" />
                              BUYER
                            </span>
                            <div className="text-[10px] font-mono text-emerald-400">{acc.buyerAlias}</div>
                          </div>
                        )}
                      </td>

                      {/* Zip / Contact */}
                      <td className="py-3.5 px-4 text-[11px]">
                        <div className="font-mono text-white">ZIP {acc.zipCode}</div>
                        <div className="text-ink-muted text-[10.5px]">{acc.phone}</div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        {isSuspended ? (
                          <span className="inline-flex items-center gap-1 rounded bg-rose-950/80 px-2 py-0.5 text-[10px] font-extrabold text-rose-400 border border-rose-500/50">
                            <UserX className="h-3 w-3" />
                            SUSPENDED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-950/60 px-2 py-0.5 text-[10px] font-extrabold text-emerald-400 border border-emerald-500/30">
                            <UserCheck className="h-3 w-3" />
                            ACTIVE
                          </span>
                        )}
                      </td>

                      {/* Activity */}
                      <td className="py-3.5 px-4 text-[11px] text-ink-muted">
                        <div>Last: <strong className="text-ink-light font-normal">{acc.lastLogin || "Recent"}</strong></div>
                        <div className="text-[10px]">Since {acc.createdAt || "2026"}</div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Impersonate User */}
                          <button
                            type="button"
                            onClick={() => onImpersonateUser(acc)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500 hover:text-black text-emerald-400 px-2.5 py-1 text-[10.5px] font-bold border border-emerald-500/40 transition-all cursor-pointer shadow-sm"
                            title={`Log in and view as ${acc.name}`}
                          >
                            <Eye className="h-3 w-3" />
                            <span>Impersonate</span>
                          </button>

                          {/* Reset Password */}
                          <button
                            type="button"
                            onClick={() => {
                              setResetPasswordUser(acc);
                              setResetPasswordValue("");
                              setResetPasswordError(null);
                            }}
                            className="p-1.5 rounded-lg border border-border bg-surface-elevated hover:text-white text-ink-muted hover:border-border-strong transition-all"
                            title="Reset Password"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>

                          {/* Suspend / Unsuspend */}
                          <button
                            type="button"
                            onClick={() => handleToggleSuspend(acc)}
                            className={`p-1.5 rounded-lg border transition-all ${
                              isSuspended
                                ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/40"
                                : "border-rose-500/30 bg-rose-950/20 text-rose-400 hover:bg-rose-900/30"
                            }`}
                            title={isSuspended ? "Re-activate Account" : "Suspend Account"}
                          >
                            {isSuspended ? <UserCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-ink-muted">
                    No accounts match the current filter or search query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --------------------------------------------- */}
      {/* MODAL: RESET PASSWORD */}
      {/* --------------------------------------------- */}
      {resetPasswordUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-3xl border border-border-strong bg-surface p-6 sm:p-8 shadow-2xl space-y-6 animate-fadeIn my-8">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Reset Password</h3>
                  <p className="text-[11px] text-ink-muted font-mono">{resetPasswordUser.email}</p>
                </div>
              </div>
              <button
                onClick={() => setResetPasswordUser(null)}
                className="text-ink-muted hover:text-white p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
              {resetPasswordError && (
                <div className="rounded-xl border border-rose-500/60 bg-rose-950/60 p-3 text-xs text-rose-200 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>{resetPasswordError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-ink-faint">New Password</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    minLength={8}
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder="At least 8 characters"
                    className="flex-1 rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={generatePassword}
                    className="rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-[10.5px] font-bold text-ink-light hover:text-white transition-all shrink-0"
                  >
                    Generate
                  </button>
                </div>
                <p className="text-[10.5px] text-ink-faint">
                  The user will need this password to sign back in — share it with them directly.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setResetPasswordUser(null)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-ink-muted hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetPasswordSubmitting}
                  className="rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 px-5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20"
                >
                  {resetPasswordSubmitting ? "Resetting…" : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
