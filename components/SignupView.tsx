"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Compass,
  ShieldCheck,
  Building2,
  User,
  Mail,
  Lock,
  Phone,
  MapPin,
  ArrowRight,
  Sparkles,
  Zap,
  Eye,
  EyeOff,
  ChevronRight,
  TrendingDown,
  Shield,
  FileCheck
} from "lucide-react";
import { UserProfile } from "@/lib/types";
import { DEMO_BUYER_USER, DEMO_DEALER_USER } from "@/lib/mockData";

interface SignupViewProps {
  onSuccess?: (user: UserProfile) => void;
  onNavigateHome?: () => void;
}

export const SignupView: React.FC<SignupViewProps> = ({
  onSuccess,
  onNavigateHome,
}) => {
  const [role, setRole] = useState<"buyer" | "dealer">("buyer");
  
  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [zipCode, setZipCode] = useState("94107");
  const [dealerName, setDealerName] = useState("");
  const [dealerTitle, setDealerTitle] = useState("Sales Manager");
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg("Please provide an email and password to create your account.");
      return;
    }
    if (!agreeTerms) {
      setErrorMsg("Please accept the terms of service to proceed.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    const newUser: UserProfile = {
      id: `user-${Date.now()}`,
      name: name || (email ? email.split("@")[0] : "New Member"),
      email: email,
      role,
      phone: phone || "(415) 555-0100",
      zipCode: zipCode || "94107",
      buyerAlias: role === "buyer" ? `Buyer #CA-${Math.floor(1000 + Math.random() * 9000)}` : undefined,
      dealerName: role === "dealer" ? (dealerName || "Franchise Dealer Partner") : undefined,
      avatarUrl: role === "dealer" ? DEMO_DEALER_USER.avatarUrl : DEMO_BUYER_USER.avatarUrl,
      savedVehicleIds: ["veh-1", "veh-4"],
    };

    // Store in localStorage for persistent session
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("trimscout_current_user", JSON.stringify(newUser));
      } catch (err) {
        console.error("Failed to persist user session:", err);
      }
    }

    setTimeout(() => {
      setIsLoading(false);
      if (onSuccess) {
        onSuccess(newUser);
      } else if (typeof window !== "undefined") {
        window.location.href = "/";
      }
    }, 600);
  };

  const handleQuickDemoSignup = (demoRole: "buyer" | "dealer") => {
    const demoUser = demoRole === "dealer" ? DEMO_DEALER_USER : DEMO_BUYER_USER;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("trimscout_current_user", JSON.stringify(demoUser));
      } catch (err) {
        console.error("Failed to persist demo user:", err);
      }
    }
    if (onSuccess) {
      onSuccess(demoUser);
    } else if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 sm:py-12 lg:px-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Left Column: Value Proposition & Social Proof */}
        <div className="lg:col-span-5 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3 py-1 text-xs font-extrabold text-emerald-400">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            <span>Join 45,000+ Car Buyers & Franchise Dealers</span>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-tight">
              Get Dealers to Compete For Your Business.
            </h1>
            <p className="text-sm text-ink-muted leading-relaxed">
              Create your free TrimScout account to unlock anonymous reverse bidding, certified out-the-door price guarantees, and factory build sheet access.
            </p>
          </div>

          {/* Key Platform Pillars */}
          <div className="space-y-3.5 pt-2">
            <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-surface/60 p-3.5 transition-all hover:border-emerald-500/40">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Shield className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-white">100% Anonymous Buyer Shield</h3>
                <p className="text-[11px] text-ink-muted">
                  Dealers never see your phone or email. They compete with transparent price counters, not spam calls.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-surface/60 p-3.5 transition-all hover:border-emerald-500/40">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <TrendingDown className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-white">Certified Out-The-Door Guarantee</h3>
                <p className="text-[11px] text-ink-muted">
                  Exact itemized taxes, DMV fees, and zero hidden add-ons locked in writing before you visit the showroom.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-surface/60 p-3.5 transition-all hover:border-emerald-500/40">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <FileCheck className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-white">3.6M+ Live Dealership Allocations</h3>
                <p className="text-[11px] text-ink-muted">
                  Search on-lot and in-transit factory allocations across every major franchise brand nationwide.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Signup Card Form */}
        <div className="lg:col-span-7">
          <div className="rounded-3xl border border-border-strong bg-surface p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden backdrop-blur-xl">
            {/* Background accent glow */}
            <div className="absolute top-0 right-0 -mt-8 -mr-8 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

            {/* Role Switcher Tabs */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-ink-faint tracking-wider">
                Select Account Type
              </label>
              <div className="grid grid-cols-2 p-1 rounded-2xl bg-surface-elevated border border-border gap-1">
                <button
                  type="button"
                  onClick={() => setRole("buyer")}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    role === "buyer"
                      ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20 font-black"
                      : "text-ink-muted hover:text-white"
                  }`}
                >
                  <User className="h-4 w-4" />
                  <span>Car Buyer Account</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRole("dealer")}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    role === "dealer"
                      ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20 font-black"
                      : "text-ink-muted hover:text-white"
                  }`}
                >
                  <Building2 className="h-4 w-4" />
                  <span>Dealer Partner Portal</span>
                </button>
              </div>
            </div>

            {/* Quick Demo Access Bar */}
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-3 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="text-ink-light">Looking to test drive the platform immediately?</span>
              </div>
              <button
                type="button"
                onClick={() => handleQuickDemoSignup(role)}
                className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-surface-elevated hover:bg-surface border border-emerald-500/40 px-3 py-1.5 text-xs font-extrabold text-emerald-400 hover:text-emerald-300 transition-all shadow-sm cursor-pointer"
              >
                <span>Instant Demo Login</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            {/* Error Message display */}
            {errorMsg && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-300 flex items-center gap-2 animate-fadeIn">
                <ShieldCheck className="h-4 w-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Main Signup Form */}
            <form onSubmit={handleSignup} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Full Name */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">
                    {role === "buyer" ? "Full Name" : "Contact Name"}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={role === "buyer" ? "Alexander Vance" : "Marcus Vance"}
                      className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2.5 text-white placeholder-ink-faint text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                  </div>
                </div>

                {/* Email Address */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={role === "buyer" ? "alex@example.com" : "marcus@bmwsanrafael.com"}
                      className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2.5 text-white placeholder-ink-faint text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Password & Zip Code */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">
                    Create Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-9 py-2.5 text-white placeholder-ink-faint text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-white"
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Zip Code for Local Tax & DMV calculation */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">
                    {role === "buyer" ? "Buyer Zip Code (For Tax Calculation)" : "Dealership Zip Code"}
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
                    <input
                      type="text"
                      maxLength={5}
                      required
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="94107"
                      className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2.5 text-white placeholder-ink-faint text-xs font-mono focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Dealership Specific Fields */}
              {role === "dealer" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fadeIn">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-ink-faint">
                      Franchise Dealership Name
                    </label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                      <input
                        type="text"
                        required
                        value={dealerName}
                        onChange={(e) => setDealerName(e.target.value)}
                        placeholder="e.g. BMW of San Rafael"
                        className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2.5 text-white placeholder-ink-faint text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-ink-faint">
                      Position / Title
                    </label>
                    <input
                      type="text"
                      value={dealerTitle}
                      onChange={(e) => setDealerTitle(e.target.value)}
                      placeholder="General Sales Manager"
                      className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-white placeholder-ink-faint text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Phone (Optional) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">
                    Phone Number (Optional - For Real-time SMS Deal Alerts)
                  </label>
                  <span className="text-[10px] text-ink-faint">Protected & Encrypted</span>
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(415) 555-0199"
                    className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2.5 text-white placeholder-ink-faint text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                  />
                </div>
              </div>

              {/* Terms of Service Checkbox */}
              <label className="flex items-start gap-2.5 pt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border bg-surface-elevated text-emerald-500 focus:ring-emerald-500/20"
                />
                <span className="text-[11px] text-ink-muted leading-relaxed">
                  I agree to TrimScout's <span className="text-white underline">Terms of Service</span> and <span className="text-white underline">Privacy Policy</span>. I understand my contact info is shielded from dealers until I accept a certified deal voucher.
                </span>
              </label>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-2xl bg-emerald-500 hover:bg-emerald-400 py-3 px-4 text-xs font-black text-black shadow-lg shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                    <span>Creating your TrimScout Account...</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 fill-black" />
                    <span>Create {role === "buyer" ? "Buyer Account" : "Dealer Portal Account"}</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
