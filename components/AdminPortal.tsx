"use client";

import React, { useState, useEffect } from "react";
import { UserProfile } from "../lib/types";
import { INITIAL_ALL_ACCOUNTS, DEMO_ADMIN_USER } from "../lib/mockData";
import { CrawlHistoryDashboard } from "./CrawlHistoryDashboard";
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  KeyRound,
  Users,
  Building2,
  User,
  Search,
  Filter,
  UserCheck,
  UserX,
  Pencil as Edit3,
  Trash2,
  ArrowRight,
  LogOut,
  Sparkles,
  Download,
  Plus,
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
  ExternalLink
} from "lucide-react";

interface AdminPortalProps {
  onImpersonateUser: (user: UserProfile) => void;
  onExitAdmin: () => void;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  onImpersonateUser,
  onExitAdmin,
}) => {
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("trimscout_admin_auth") === "true";
    }
    return false;
  });

  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminEmailInput, setAdminEmailInput] = useState("admin@trimscout.com");
  const [authError, setAuthError] = useState("");

  // Accounts Data State
  const [accounts, setAccounts] = useState<UserProfile[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("trimscout_admin_accounts");
        return saved ? JSON.parse(saved) : INITIAL_ALL_ACCOUNTS;
      } catch {
        return INITIAL_ALL_ACCOUNTS;
      }
    }
    return INITIAL_ALL_ACCOUNTS;
  });

  // Sync accounts to localStorage
  const saveAccounts = (newAccounts: UserProfile[]) => {
    setAccounts(newAccounts);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("trimscout_admin_accounts", JSON.stringify(newAccounts));
      } catch {}
    }
  };

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "buyer" | "dealer" | "admin" | "suspended">("all");
  const [activeTab, setActiveTab] = useState<"accounts" | "telemetry" | "logs">("accounts");

  // Modal States
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // New User Form State
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"buyer" | "dealer" | "admin">("buyer");
  const [newPhone, setNewPhone] = useState("(415) 555-0100");
  const [newZip, setNewZip] = useState("94107");
  const [newDealerName, setNewDealerName] = useState("BMW of San Rafael");

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3000);
  };

  // Handle Admin Passcode Login
  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = adminKeyInput.trim();
    if (
      cleanKey === "admin2026" ||
      cleanKey === "TRIMSCOUT_SUPERADMIN" ||
      cleanKey === "admin" ||
      cleanKey.toLowerCase() === "trimscout" ||
      (adminEmailInput === "admin@trimscout.com" && cleanKey.length >= 4)
    ) {
      setIsAuthenticated(true);
      setAuthError("");
      if (typeof window !== "undefined") {
        localStorage.setItem("trimscout_admin_auth", "true");
      }
      showToast("🔐 Superuser clearance verified. Welcome to Admin Command Center.");
    } else {
      setAuthError("Invalid Master Security Passcode. Access denied.");
    }
  };

  const handleAdminLogout = () => {
    setIsAuthenticated(false);
    if (typeof window !== "undefined") {
      localStorage.removeItem("trimscout_admin_auth");
    }
  };

  // Account Management Actions
  const handleToggleSuspend = (id: string) => {
    const updated = accounts.map((acc) => {
      if (acc.id === id) {
        const newStatus: "active" | "suspended" = acc.status === "suspended" ? "active" : "suspended";
        return { ...acc, status: newStatus };
      }
      return acc;
    });
    saveAccounts(updated);
    showToast("User account status updated.");
  };

  const handleDeleteUser = (id: string) => {
    if (id === DEMO_ADMIN_USER.id) {
      alert("Master Administrator account cannot be deleted.");
      return;
    }
    if (confirm("Are you sure you want to permanently delete this user account?")) {
      const updated = accounts.filter((acc) => acc.id !== id);
      saveAccounts(updated);
      showToast("User account deleted successfully.");
    }
  };

  const handleSaveEditUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    const updated = accounts.map((acc) => (acc.id === editingUser.id ? editingUser : acc));
    saveAccounts(updated);
    setEditingUser(null);
    showToast("Account changes saved successfully.");
  };

  const handleCreateNewUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newName) return;

    const created: UserProfile = {
      id: `user-${Date.now()}`,
      name: newName,
      email: newEmail,
      role: newRole,
      phone: newPhone,
      zipCode: newZip,
      status: "active",
      createdAt: new Date().toISOString().split("T")[0],
      lastLogin: "Never",
      buyerAlias: newRole === "buyer" ? `Buyer #CA-${Math.floor(1000 + Math.random() * 9000)}` : undefined,
      dealerName: newRole === "dealer" ? newDealerName : undefined,
      savedVehicleIds: [],
    };

    saveAccounts([created, ...accounts]);
    setIsCreateModalOpen(false);
    // Reset Form
    setNewName("");
    setNewEmail("");
    showToast(`Created new ${newRole} account for ${newName}.`);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast("User ID copied to clipboard.");
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

  // ----------------------------------------------------
  // UN-AUTHENTICATED: SECRET ADMIN LOGIN GATE
  // ----------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-3xl border border-rose-500/40 bg-surface p-8 shadow-2xl space-y-6 relative overflow-hidden backdrop-blur-xl animate-fadeIn">
          {/* Top secret badge */}
          <div className="flex items-center justify-between border-b border-border/80 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider">Secret Admin Portal</h2>
                <p className="text-[10.5px] text-ink-muted">Master Platform Controller</p>
              </div>
            </div>
            <button
              onClick={onExitAdmin}
              className="text-ink-muted hover:text-white p-1 rounded-lg hover:bg-surface-elevated text-xs transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-3.5 space-y-1 text-xs text-rose-300">
            <div className="flex items-center gap-1.5 font-bold">
              <Lock className="h-3.5 w-3.5" />
              <span>Restricted Clearance Required</span>
            </div>
            <p className="text-[11px] text-rose-300/80 leading-relaxed">
              This portal allows superuser administration across all Buyer, Dealership, and System accounts. Unauthorized attempts are logged.
            </p>
          </div>

          {authError && (
            <div className="rounded-xl border border-rose-500/60 bg-rose-950/60 p-3 text-xs text-rose-200 flex items-center gap-2 animate-fadeIn">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-ink-faint">Admin Identity Email</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <input
                  type="email"
                  required
                  value={adminEmailInput}
                  onChange={(e) => setAdminEmailInput(e.target.value)}
                  placeholder="admin@trimscout.com"
                  className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2.5 text-white placeholder-ink-faint text-xs focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500 transition-all font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase text-ink-faint">Master Security Passcode</label>
                <span className="text-[10px] text-rose-400 font-mono">Level-5 Clearance</span>
              </div>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-rose-400" />
                <input
                  type="password"
                  required
                  autoFocus
                  value={adminKeyInput}
                  onChange={(e) => setAdminKeyInput(e.target.value)}
                  placeholder="Enter passcode (e.g. admin2026)"
                  className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2.5 text-white placeholder-ink-faint text-xs focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500 transition-all font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full rounded-2xl bg-rose-500 hover:bg-rose-400 py-3 px-4 text-xs font-black text-black shadow-lg shadow-rose-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <ShieldCheck className="h-4 w-4 fill-black" />
              <span>Authenticate & Enter Admin Command</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* Master 1-Click Bypass Demo */}
          <div className="pt-2 border-t border-border/80 text-center">
            <button
              type="button"
              onClick={() => {
                setAdminKeyInput("admin2026");
                setIsAuthenticated(true);
                if (typeof window !== "undefined") {
                  localStorage.setItem("trimscout_admin_auth", "true");
                }
              }}
              className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              <span>One-Click Superuser Demo Access</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // AUTHENTICATED: ADMIN COMMAND CENTER
  // ----------------------------------------------------
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
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Create New User</span>
          </button>

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

      <CrawlHistoryDashboard />

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
              {filteredAccounts.length > 0 ? (
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
                              {acc.id === DEMO_ADMIN_USER.id && (
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

                          {/* Edit User */}
                          <button
                            type="button"
                            onClick={() => setEditingUser(acc)}
                            className="p-1.5 rounded-lg border border-border bg-surface-elevated hover:text-white text-ink-muted hover:border-border-strong transition-all"
                            title="Edit Account Details"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          {/* Suspend / Unsuspend */}
                          <button
                            type="button"
                            onClick={() => handleToggleSuspend(acc.id)}
                            className={`p-1.5 rounded-lg border transition-all ${
                              isSuspended
                                ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/40"
                                : "border-rose-500/30 bg-rose-950/20 text-rose-400 hover:bg-rose-900/30"
                            }`}
                            title={isSuspended ? "Re-activate Account" : "Suspend Account"}
                          >
                            {isSuspended ? <UserCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                          </button>

                          {/* Delete User */}
                          {acc.id !== DEMO_ADMIN_USER.id && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(acc.id)}
                              className="p-1.5 rounded-lg border border-border hover:border-rose-500/60 bg-surface-elevated hover:bg-rose-950/40 text-ink-faint hover:text-rose-400 transition-all"
                              title="Delete Account"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
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
      {/* MODAL: EDIT USER ACCOUNT */}
      {/* --------------------------------------------- */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-3xl border border-border-strong bg-surface p-6 sm:p-8 shadow-2xl space-y-6 animate-fadeIn my-8">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                  <Edit3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Account: {editingUser.name}</h3>
                  <p className="text-[11px] text-ink-muted font-mono">{editingUser.id}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingUser(null)}
                className="text-ink-muted hover:text-white p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditUser} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editingUser.name}
                    onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Email Address</label>
                  <input
                    type="email"
                    required
                    value={editingUser.email}
                    onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Account Role</label>
                  <select
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as any })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="buyer">Car Buyer</option>
                    <option value="dealer">Franchise Dealer</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Account Status</label>
                  <select
                    value={editingUser.status || "active"}
                    onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value as any })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended / Banned</option>
                    <option value="pending_verification">Pending Verification</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Zip Code</label>
                  <input
                    type="text"
                    maxLength={5}
                    value={editingUser.zipCode}
                    onChange={(e) => setEditingUser({ ...editingUser, zipCode: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Phone</label>
                  <input
                    type="text"
                    value={editingUser.phone}
                    onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {editingUser.role === "dealer" && (
                <div className="space-y-1 animate-fadeIn">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Dealership Rooftop</label>
                  <input
                    type="text"
                    value={editingUser.dealerName || ""}
                    onChange={(e) => setEditingUser({ ...editingUser, dealerName: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}

              {editingUser.role === "buyer" && (
                <div className="space-y-1 animate-fadeIn">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Buyer Shield Alias</label>
                  <input
                    type="text"
                    value={editingUser.buyerAlias || ""}
                    onChange={(e) => setEditingUser({ ...editingUser, buyerAlias: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-emerald-400 font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-ink-muted hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-500 hover:bg-emerald-400 px-5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------- */}
      {/* MODAL: CREATE NEW USER */}
      {/* --------------------------------------------- */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-3xl border border-border-strong bg-surface p-6 sm:p-8 shadow-2xl space-y-6 animate-fadeIn my-8">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Create New Platform User</h3>
                  <p className="text-[11px] text-ink-muted">Add buyer, franchise dealer, or admin account</p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-ink-muted hover:text-white p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewUser} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-ink-faint">Account Role</label>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface-elevated border border-border">
                  <button
                    type="button"
                    onClick={() => setNewRole("buyer")}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                      newRole === "buyer" ? "bg-emerald-500 text-black font-black" : "text-ink-muted"
                    }`}
                  >
                    Buyer
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRole("dealer")}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                      newRole === "dealer" ? "bg-emerald-500 text-black font-black" : "text-ink-muted"
                    }`}
                  >
                    Dealer Partner
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRole("admin")}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                      newRole === "admin" ? "bg-rose-500 text-white font-black" : "text-ink-muted"
                    }`}
                  >
                    Admin
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Full Name</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Jordan Mitchell"
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Email Address</label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="jordan@example.com"
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {newRole === "dealer" && (
                <div className="space-y-1 animate-fadeIn">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Dealership Name</label>
                  <input
                    type="text"
                    required
                    value={newDealerName}
                    onChange={(e) => setNewDealerName(e.target.value)}
                    placeholder="e.g. Stevens Creek Chevrolet"
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Zip Code</label>
                  <input
                    type="text"
                    maxLength={5}
                    value={newZip}
                    onChange={(e) => setNewZip(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">Phone Number</label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-ink-muted hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-500 hover:bg-emerald-400 px-5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 cursor-pointer"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
