"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
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
  Zap,
  Eye,
  EyeOff,
  ChevronRight,
  BadgeCheck
} from "lucide-react";

interface SignupViewProps {
  onSuccess?: () => void;
  onNavigateHome?: () => void;
}

export const SignupView: React.FC<SignupViewProps> = ({
  onSuccess,
  onNavigateHome,
}) => {
  const searchParams = useSearchParams();
  const [role, setRole] = useState<"buyer" | "dealer">("buyer");

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [zipCode, setZipCode] = useState("94107");
  const [dealerName, setDealerName] = useState("");
  const [dealerTitle, setDealerTitle] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [pendingApproval, setPendingApproval] = useState(false);

  // Dealer signup invite (?dealerId=&dealerToken= from an admin-generated
  // link) — when it resolves, the dealership name is pulled from the
  // invite itself and the field is locked, so an invited dealer can't
  // fat-finger or spoof a different dealership's name. Any dealer who
  // isn't responding to an invite (no link, or the link fails to
  // resolve) falls straight back to today's manual, editable field.
  const [dealerInviteId, setDealerInviteId] = useState<string | null>(null);
  const [dealerInviteToken, setDealerInviteToken] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<"checking" | "valid" | "none">("none");
  const [inviteError, setInviteError] = useState("");

  useEffect(() => {
    const id = searchParams.get("dealerId");
    const token = searchParams.get("dealerToken");
    if (!id || !token) return;

    setRole("dealer");
    setInviteStatus("checking");
    let cancelled = false;
    fetch(`/api/dealer-signup-invite?dealerId=${encodeURIComponent(id)}&dealerToken=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !json.dealerName) {
          setInviteStatus("none");
          setInviteError(json.error || "This invite link is invalid or has expired. You can still sign up manually below.");
          return;
        }
        setDealerInviteId(id);
        setDealerInviteToken(token);
        setDealerName(json.dealerName);
        // Contact name/email are pre-filled from the directory as a
        // convenience, but stay editable — unlike dealerName, these aren't
        // locked, since the person signing up is the authority on their
        // own name and email, not the on-file record.
        if (json.contactName) setName(json.contactName);
        if (json.contactEmail) setEmail(json.contactEmail);
        setInviteStatus("valid");
      })
      .catch(() => {
        if (cancelled) return;
        setInviteStatus("none");
        setInviteError("Could not verify this invite link. You can still sign up manually below.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg("Please provide an email and password to create your account.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords don't match — check and re-enter them.");
      return;
    }
    if (!agreeTerms) {
      setErrorMsg("Please accept the terms of service to proceed.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name || email.split("@")[0],
          role,
          phone: role === "buyer" ? phone || undefined : undefined,
          zipCode: role === "buyer" ? zipCode || undefined : undefined,
          dealerName: role === "dealer" ? dealerName : undefined,
          dealerInviteId: role === "dealer" ? dealerInviteId || undefined : undefined,
          dealerInviteToken: role === "dealer" ? dealerInviteToken || undefined : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || "Could not create your account.");
        return;
      }
      if (json.status === "pending_verification") {
        // Uninvited dealer signup — the account exists but can't sign in
        // yet (the box rejects any non-'active' status), so there's no
        // session to establish. Show the pending state instead of trying.
        setPendingApproval(true);
        return;
      }
      // The signup route already signs the new user in server-side; make
      // sure the client's session state reflects it (same pattern as
      // AuthModal's real signup flow) so the caller's onSuccess navigation
      // lands on an already-authenticated page.
      await signIn("credentials", { email, password, redirect: false });
      if (onSuccess) {
        onSuccess();
      } else if (typeof window !== "undefined") {
        window.location.href = "/";
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-8 sm:py-12 lg:px-8">
      <div>
        <div className="rounded-3xl border border-border-strong bg-surface p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden backdrop-blur-xl">
          {/* Background accent glow */}
          <div className="absolute top-0 right-0 -mt-8 -mr-8 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

          {pendingApproval ? (
            <div className="text-center space-y-4 py-6">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                <BadgeCheck className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-lg font-black text-white">Account Created — Pending Approval</h2>
                <p className="text-xs text-ink-muted leading-relaxed max-w-sm mx-auto">
                  Your dealer account for <strong className="text-white">{dealerName}</strong> has been created, but a TrimScout admin needs to review and approve it before you can sign in. We'll let you know once it's approved.
                </p>
              </div>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-4 py-2 text-xs font-bold text-ink-light hover:text-white transition-all"
              >
                <span>Return Home</span>
              </Link>
            </div>
          ) : (
            <>
            {/* Role Switcher Tabs */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-ink-faint tracking-wider">
                Select Account Type
              </label>
              <div className="grid grid-cols-2 p-1 rounded-2xl bg-surface-elevated border border-border gap-1">
                <button
                  type="button"
                  disabled={inviteStatus === "valid"}
                  onClick={() => setRole("buyer")}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
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
                  disabled={inviteStatus === "valid"}
                  onClick={() => setRole("dealer")}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    role === "dealer"
                      ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20 font-black"
                      : "text-ink-muted hover:text-white"
                  }`}
                >
                  <Building2 className="h-4 w-4" />
                  <span>Dealer Portal</span>
                </button>
              </div>
            </div>

            {/* Dealer invite banner */}
            {inviteStatus === "checking" && (
              <div className="rounded-xl border border-border bg-surface-elevated p-3 text-xs text-ink-muted flex items-center gap-2">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-faint border-t-transparent" />
                <span>Checking your invite link…</span>
              </div>
            )}
            {inviteStatus === "valid" && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-300 flex items-center gap-2 animate-fadeIn">
                <BadgeCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>
                  You&apos;re signing up as <strong className="text-white">{dealerName}</strong> — invited by TrimScout.
                </span>
              </div>
            )}
            {inviteStatus === "none" && inviteError && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200 flex items-center gap-2 animate-fadeIn">
                <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0" />
                <span>{inviteError}</span>
              </div>
            )}

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

              {/* Password & Confirm Password */}
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
                      minLength={8}
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

                {/* Confirm Password */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter your password"
                      aria-invalid={confirmPassword.length > 0 && confirmPassword !== password}
                      className={`w-full rounded-xl border bg-surface-elevated pl-9 pr-9 py-2.5 text-white placeholder-ink-faint text-xs focus:outline-none focus:ring-1 transition-all ${
                        confirmPassword.length > 0 && confirmPassword !== password
                          ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500"
                          : "border-border focus:border-emerald-500 focus:ring-emerald-500"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-white"
                    >
                      {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && confirmPassword !== password && (
                    <p className="text-[10px] text-rose-400">Passwords don&apos;t match.</p>
                  )}
                </div>
              </div>

              {/* Zip Code for Local Tax & DMV calculation — buyer only; a
                  dealer's zip already lives on their dealership_contacts
                  record, no need to ask again at signup. */}
              {role === "buyer" && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-ink-faint">
                    Buyer Zip Code (For Tax Calculation)
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
              )}

              {/* Dealership Specific Fields */}
              {role === "dealer" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fadeIn">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-ink-faint">
                      Franchise Dealership Name
                      {inviteStatus === "valid" && <span className="text-emerald-400 normal-case font-semibold"> · from your invite</span>}
                    </label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                      <input
                        type="text"
                        required
                        disabled={inviteStatus === "valid"}
                        value={dealerName}
                        onChange={(e) => setDealerName(e.target.value)}
                        placeholder="e.g. BMW of San Rafael"
                        className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3.5 py-2.5 text-white placeholder-ink-faint text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
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

              {/* Phone (Optional) — buyer only; a dealer's phone already
                  lives on their dealership_contacts record. */}
              {role === "buyer" && (
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
              )}

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
            </>
          )}
          </div>
        </div>
      </div>
  );
};
