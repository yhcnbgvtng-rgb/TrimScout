"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  ExternalLink,
  Eye,
  Gauge,
  Globe2,
  MousePointerClick,
  Smartphone,
  TriangleAlert as AlertTriangle,
} from "lucide-react";

const VERCEL_TEAM = "trim-scout";
const VERCEL_PROJECT = "trim-scout";
const ANALYTICS_URL = `https://vercel.com/${VERCEL_TEAM}/${VERCEL_PROJECT}/analytics`;
const SPEED_INSIGHTS_URL = `https://vercel.com/${VERCEL_TEAM}/${VERCEL_PROJECT}/speed-insights`;

const TRACKED_ITEMS: { icon: React.ReactNode; label: string; description: string }[] = [
  {
    icon: <Eye className="h-4 w-4" />,
    label: "Visitors & page views",
    description: "Unique visitors and total views, by day/week/month.",
  },
  {
    icon: <MousePointerClick className="h-4 w-4" />,
    label: "Top pages & referrers",
    description: "Which pages get traffic, and what site sent it.",
  },
  {
    icon: <Globe2 className="h-4 w-4" />,
    label: "Countries & regions",
    description: "Where visitors are located, down to the region.",
  },
  {
    icon: <Smartphone className="h-4 w-4" />,
    label: "Devices & browsers",
    description: "OS, browser, and device-type breakdown.",
  },
];

export default function AnalyticsClient() {
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
        <div className="rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/30 to-blue-500/20 text-emerald-400 border border-emerald-500/40 shadow-inner">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">Site Analytics</h1>
              <p className="text-xs text-ink-muted">Who&apos;s visiting, where from, and what they&apos;re looking at.</p>
            </div>
          </div>
          <a
            href={ANALYTICS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition-all"
          >
            <span>Open Analytics Dashboard</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200/90 leading-relaxed">
            Visitor data is collected by Vercel Web Analytics directly from real traffic on the live
            site — it only starts appearing once this deploys to production, and there is nothing to show
            from local development. The full charts (visitors, top pages, referrers, countries, devices)
            live in Vercel&apos;s own dashboard, not embedded here — open it with the button above. Embedding
            those charts directly on this page instead would need Vercel&apos;s Web Analytics API, which is
            gated to Pro/Enterprise plans; ask if that&apos;s worth adding once you know your plan supports it.
          </p>
        </div>

        <div className="rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl space-y-4">
          <h2 className="text-sm font-black text-white">What&apos;s being tracked</h2>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {TRACKED_ITEMS.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-border/80 bg-background p-4 flex items-start gap-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
                  {item.icon}
                </div>
                <div>
                  <p className="text-xs font-bold text-white">{item.label}</p>
                  <p className="text-[11px] text-ink-muted mt-0.5">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-faint">
            No cookies and no IP addresses are stored — Vercel Web Analytics is privacy-first by default,
            so nothing here needs a cookie-consent banner.
          </p>
        </div>

        <div className="rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/30 to-blue-500/20 text-purple-400 border border-purple-500/40 shadow-inner">
              <Gauge className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">Speed Insights</p>
              <p className="text-[11px] text-ink-muted">Real-user Core Web Vitals, also live on this deploy.</p>
            </div>
          </div>
          <a
            href={SPEED_INSIGHTS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-xs font-bold text-ink-light hover:text-white transition-all shadow-sm shrink-0"
          >
            <span>Open</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </main>
    </div>
  );
}
