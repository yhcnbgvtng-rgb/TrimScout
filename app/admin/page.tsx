"use client";

export const dynamic = "force-dynamic";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Compass,
  ShieldAlert,
  LogOut
} from "lucide-react";
import { AdminPortal } from "@/components/AdminPortal";
import { UserProfile } from "@/lib/types";

export default function AdminPage() {
  const router = useRouter();

  const handleImpersonateUser = (user: UserProfile) => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("trimscout_current_user", JSON.stringify(user));
        localStorage.setItem("trimscout_impersonating", JSON.stringify({
          originalAdmin: true,
          impersonatedUser: user.name,
          role: user.role,
        }));
      } catch (err) {
        console.error("Failed to store impersonation:", err);
      }
    }
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between selection:bg-rose-500 selection:text-black">
      {/* Secret Admin Top Bar */}
      <header className="border-b border-rose-500/30 bg-surface/70 backdrop-blur-xl sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 group select-none">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500 text-black shadow-md shadow-rose-500/20 group-hover:scale-105 transition-transform">
              <ShieldAlert className="h-4.5 w-4.5 stroke-[2.5]" />
            </div>
            <span className="font-black text-lg tracking-tight text-white flex items-center">
              Trim<span className="text-rose-400">Scout</span>
              <span className="ml-2 rounded bg-rose-500/20 border border-rose-500/40 px-1.5 py-0.5 text-[9px] font-black text-rose-300 uppercase">
                Admin Area
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white transition-all shadow-sm"
            >
              <span>Return to Public App</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Admin Section */}
      <main className="flex-1">
        <AdminPortal
          onImpersonateUser={handleImpersonateUser}
          onExitAdmin={() => router.push("/")}
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-4 text-center text-xs text-ink-faint">
        <p>🔒 TrimScout Internal Security Core • Restricted Access Only</p>
      </footer>
    </div>
  );
}
