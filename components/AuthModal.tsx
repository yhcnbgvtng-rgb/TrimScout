"use client";

import React, { useState } from "react";
import Link from "next/link";
import { UserProfile } from "../lib/types";
import { DEMO_BUYER_USER, DEMO_DEALER_USER, DEMO_ADMIN_USER } from "../lib/mockData";
import {
  X,
  LogIn,
  UserPlus,
  ShieldCheck,
  Building2,
  User,
  Mail,
  Lock,
  Phone,
  MapPin,
  ArrowRight,
  Sparkles,
  ShieldAlert
} from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (user: UserProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLogin,
}) => {
  const [tab, setTab] = useState<"signin" | "signup" | "demo">("demo");
  const [role, setRole] = useState<"buyer" | "dealer">("buyer");
  
  // Form fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [zipCode, setZipCode] = useState("94107");
  const [dealerName, setDealerName] = useState("BMW of San Rafael");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newUser: UserProfile = {
      id: `user-${Date.now()}`,
      name: name || (email ? email.split("@")[0] : "New Member"),
      email: email || "user@example.com",
      role,
      phone: phone || "(415) 555-0100",
      zipCode: zipCode || "94107",
      buyerAlias: role === "buyer" ? `Buyer #CA-${Math.floor(1000 + Math.random() * 9000)}` : undefined,
      dealerName: role === "dealer" ? dealerName : undefined,
      avatarUrl: role === "dealer" ? DEMO_DEALER_USER.avatarUrl : DEMO_BUYER_USER.avatarUrl,
      savedVehicleIds: ["veh-1"],
    };
    onLogin(newUser);
    onClose();
  };

  const handleSelectDemoUser = (demoUser: UserProfile) => {
    onLogin(demoUser);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-md rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8 animate-fadeIn">
        {/* Header */}
        <div className="border-b border-border bg-surface-elevated px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">TrimScout Account</h2>
              <p className="text-xs text-ink-muted">Access your live deal room & track bids</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-muted hover:bg-border hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="grid grid-cols-3 border-b border-border bg-surface-elevated/50 p-1.5 gap-1 text-xs font-semibold">
          <button
            onClick={() => setTab("demo")}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all ${
              tab === "demo"
                ? "bg-emerald-500 text-black font-extrabold shadow-sm"
                : "text-ink-muted hover:text-white"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>1-Click Demo</span>
          </button>

          <button
            onClick={() => setTab("signin")}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all ${
              tab === "signin"
                ? "bg-surface-elevated text-white font-bold border border-border"
                : "text-ink-muted hover:text-white"
            }`}
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>Sign In</span>
          </button>

          <button
            onClick={() => setTab("signup")}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all ${
              tab === "signup"
                ? "bg-surface-elevated text-white font-bold border border-border"
                : "text-ink-muted hover:text-white"
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Sign Up</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* TAB 1: 1-CLICK DEMO PROFILES */}
          {tab === "demo" && (
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <span className="text-[11px] uppercase font-bold text-emerald-400 tracking-wider">
                  Instant Test Accounts
                </span>
                <p className="text-xs text-ink-muted">
                  Select a test profile to immediately view deal tracking as a buyer or dealer.
                </p>
              </div>

              <div className="space-y-3 pt-1">
                {/* Buyer Demo Card */}
                <div
                  onClick={() => handleSelectDemoUser(DEMO_BUYER_USER)}
                  className="group cursor-pointer rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4 hover:border-emerald-400 hover:bg-emerald-950/30 transition-all flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={DEMO_BUYER_USER.avatarUrl}
                        alt={DEMO_BUYER_USER.name}
                        className="h-10 w-10 rounded-full object-cover border border-emerald-500/40"
                      />
                      <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-black text-black">
                        ✓
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{DEMO_BUYER_USER.name}</span>
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400 uppercase">
                          Car Buyer
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-muted">
                        Active Bids: BMW 3 Series • 2 Dealership Bids Live
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-emerald-400 group-hover:translate-x-1 transition-transform" />
                </div>

                {/* Dealer Demo Card */}
                <div
                  onClick={() => handleSelectDemoUser(DEMO_DEALER_USER)}
                  className="group cursor-pointer rounded-xl border border-blue-500/40 bg-blue-950/20 p-4 hover:border-blue-400 hover:bg-blue-950/30 transition-all flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={DEMO_DEALER_USER.avatarUrl}
                        alt={DEMO_DEALER_USER.name}
                        className="h-10 w-10 rounded-full object-cover border border-blue-500/40"
                      />
                      <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-black text-white">
                        🏢
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{DEMO_DEALER_USER.name}</span>
                        <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[9px] font-bold text-blue-400 uppercase">
                          Sales Director
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-muted">
                        BMW of San Rafael • 8 Won Deals
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-blue-400 group-hover:translate-x-1 transition-transform" />
                </div>

                {/* Super Admin Demo Card */}
                <div
                  onClick={() => handleSelectDemoUser(DEMO_ADMIN_USER)}
                  className="group cursor-pointer rounded-xl border border-rose-500/40 bg-rose-950/20 p-4 hover:border-rose-400 hover:bg-rose-950/30 transition-all flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={DEMO_ADMIN_USER.avatarUrl}
                        alt={DEMO_ADMIN_USER.name}
                        className="h-10 w-10 rounded-full object-cover border border-rose-500/40"
                      />
                      <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-black">
                        🔒
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{DEMO_ADMIN_USER.name}</span>
                        <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-bold text-rose-400 uppercase">
                          Root Admin
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-muted">
                        Master Access • Administer All Buyer & Dealer Accounts
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-rose-400 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface-elevated p-3 text-[11px] text-ink-muted flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Buyer identities and contact info are 100% masked from dealerships until a deal is locked.</span>
              </div>
            </div>
          )}

          {/* TAB 2 & 3: SIGN IN / SIGN UP FORM */}
          {(tab === "signin" || tab === "signup") && (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {/* Role Toggle */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-ink-faint">Account Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole("buyer")}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                      role === "buyer"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-surface-elevated text-ink-muted hover:text-white"
                    }`}
                  >
                    <User className="h-3.5 w-3.5" />
                    <span>Car Buyer</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole("dealer")}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                      role === "dealer"
                        ? "border-blue-500 bg-blue-500/10 text-blue-400"
                        : "border-border bg-surface-elevated text-ink-muted hover:text-white"
                    }`}
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    <span>Dealer Partner</span>
                  </button>
                </div>
              </div>

              {/* Name (for sign up) */}
              {tab === "signup" && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-ink-faint">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                    <input
                      type="text"
                      required
                      placeholder={role === "buyer" ? "e.g. Alex Rivera" : "e.g. Marcus Vance"}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder:text-ink-faint focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Dealership Name if dealer */}
              {role === "dealer" && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-ink-faint">Dealership Name</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. BMW of San Rafael"
                      value={dealerName}
                      onChange={(e) => setDealerName(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder:text-ink-faint focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Email */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-ink-faint">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                  <input
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder:text-ink-faint focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-ink-faint">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder:text-ink-faint focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Zip Code & Phone for Sign Up */}
              {tab === "signup" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-ink-faint">Buyer Zip</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                      <input
                        type="text"
                        maxLength={5}
                        placeholder="94107"
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder:text-ink-faint focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-ink-faint">Mobile Phone</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                      <input
                        type="tel"
                        placeholder="(555) 000-0000"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder:text-ink-faint focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 active:scale-95 mt-2 cursor-pointer"
              >
                {tab === "signin" ? (
                  <>
                    <LogIn className="h-4 w-4" />
                    <span>Sign In to TrimScout</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    <span>Create Free Account</span>
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <Link
                  href="/signup"
                  onClick={onClose}
                  className="text-[11px] text-ink-muted hover:text-emerald-400 transition-colors"
                >
                  Need a full registration? <strong className="text-white underline">Open Dedicated Signup Page →</strong>
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
