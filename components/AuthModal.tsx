"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import {
  X,
  LogIn,
  UserPlus,
  ShieldCheck,
  Mail,
  Lock,
  Loader2,
  AlertCircle,
} from "lucide-react";

// Inline brand mark — Google's own guidelines call for their real logo,
// not a generic icon, on a "Continue with" button.
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.19 3.32v2.77h3.55c2.08-1.92 3.28-4.74 3.28-8.1z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.55-2.77c-.98.66-2.23 1.06-3.73 1.06-2.87 0-5.3-1.94-6.17-4.53H2.18v2.85A11 11 0 0012 23z" />
    <path fill="#FBBC05" d="M5.83 14.1A6.6 6.6 0 015.48 12c0-.73.13-1.44.35-2.1V7.05H2.18A11 11 0 001 12c0 1.77.43 3.45 1.18 4.95l3.65-2.85z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 00-9.82 6.05l3.65 2.85C6.7 7.32 9.13 5.38 12 5.38z" />
  </svg>
);

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Pre-fills the error banner on open — used to surface a failed OAuth
  // round-trip (Google consent completed, but the sign-in itself failed
  // server-side) instead of silently bouncing the user back to a blank
  // homepage with no explanation.
  initialError?: string | null;
  // Fired right before onClose, only after a real, successful
  // credentials sign-in — lets a caller (e.g. the /signup page) navigate
  // somewhere useful post-login without having to guess why the modal
  // closed (a plain cancel calls onClose alone).
  onSignedIn?: () => void;
}

// Sign-in only. This used to also have an inline "Sign Up" tab with its
// own account-creation form, but that duplicated (and had quietly drifted
// out of sync with) components/SignupView.tsx — no dealer-invite
// awareness, no Turnstile bot-check, a hardcoded dealer-name placeholder,
// none of the pending-approval handling. SignupView is the one real
// signup surface now; this modal just links to it.
export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialError,
  onSignedIn,
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<"google" | null>(null);

  useEffect(() => {
    if (isOpen && initialError) setFormError(initialError);
  }, [isOpen, initialError]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setFormError(
          result.error === "auth_service_unavailable"
            ? "Sign-in is temporarily unavailable. Please try again shortly."
            : "Incorrect email or password."
        );
        return;
      }
      // page.tsx's session-sync effect picks up currentUser from here —
      // nothing further to do but close the modal.
      onSignedIn?.();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = async (provider: "google") => {
    setOauthLoading(provider);
    // Real redirect flow (not redirect: false) — the provider's own login
    // page needs the full page, not an in-modal fetch.
    await signIn(provider, { callbackUrl: "/" });
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
              <h2 className="text-base font-bold text-white">Sign In to TrimScout</h2>
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

        <div className="p-6">
          <div className="space-y-4">
            {/* OAuth */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleOAuth("google")}
                disabled={oauthLoading !== null}
                className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-border bg-white py-2.5 text-xs font-bold text-gray-800 hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-wait"
              >
                {oauthLoading === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
                <span>Continue with Google</span>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] uppercase font-bold text-ink-faint">Or with email</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {formError && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/20 p-3 text-[11px] text-rose-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
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

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 active:scale-95 mt-2 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    <span>Sign In to TrimScout</span>
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <Link
                  href="/signup"
                  onClick={onClose}
                  className="text-[11px] text-ink-muted hover:text-emerald-400 transition-colors inline-flex items-center gap-1"
                >
                  <UserPlus className="h-3 w-3" />
                  <span>
                    New here? <strong className="text-white underline">Create a free account →</strong>
                  </span>
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
