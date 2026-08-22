"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Radio,
  KeyRound,
  CircleCheck as CheckCircle2,
  CircleAlert as AlertCircle,
  LoaderCircle as Loader2,
  Zap,
  Globe,
  Database,
  ExternalLink,
  ShieldCheck
} from "lucide-react";
import {
  getConnectorConfig,
  saveConnectorConfig,
  fetchLiveInventory,
} from "../lib/inventoryConnector";

interface InventoryConnectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigUpdated: () => void;
}

export const InventoryConnectorModal: React.FC<InventoryConnectorModalProps> = ({
  isOpen,
  onClose,
  onConfigUpdated,
}) => {
  const [provider, setProvider] = useState<"autodev" | "marketcheck" | "smart_feed">("smart_feed");
  const [apiKey, setApiKey] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    carsFound?: number;
    latencyMs?: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const config = getConnectorConfig();
      setProvider(config.provider || "smart_feed");
      setApiKey(config.apiKey || "");
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await fetchLiveInventory({
        provider,
        apiKey,
        zip: "94107",
        radius: 100,
        make: "BMW",
      });
      const end = performance.now();
      const latencyMs = Math.round(end - start);

      if (res.success) {
        setTestResult({
          success: true,
          message: `Connected successfully to ${provider === "smart_feed" ? "TrimScout Smart Network" : provider.toUpperCase()}!`,
          carsFound: res.data.length,
          latencyMs,
        });
      } else {
        setTestResult({
          success: false,
          message: "Failed to connect to feed. Please verify API key.",
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || "Connection failed. Please check credentials.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    saveConnectorConfig({ provider, apiKey });
    onConfigUpdated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8 animate-fadeIn">
        {/* Header */}
        <div className="border-b border-border bg-surface-elevated px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <Radio className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Live Dealership Inventory Feeds</h2>
              <p className="text-xs text-ink-muted">Configure real-time automotive feed providers</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-muted hover:bg-border hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs">
          {/* Feed Providers Options */}
          <div className="space-y-2.5">
            <label className="text-[10px] uppercase font-bold text-ink-faint">
              Select Inventory Provider
            </label>

            {/* Provider 1: Smart Feed (Free / Active by Default) */}
            <div
              onClick={() => setProvider("smart_feed")}
              className={`cursor-pointer rounded-xl border p-3.5 transition-all flex items-start justify-between gap-3 ${
                provider === "smart_feed"
                  ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
                  : "border-border bg-surface-elevated hover:border-border-strong"
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-xs">TrimScout Smart Network (Zero Config)</span>
                  <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-extrabold text-emerald-400 uppercase">
                    Built-In Free
                  </span>
                </div>
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  Real-time geographic radius calculations across certified partner dealerships (BMW, Porsche, Ford, Audi, Toyota, Tesla).
                </p>
              </div>
              <div className={`h-4 w-4 rounded-full border flex items-center justify-center mt-0.5 shrink-0 ${
                provider === "smart_feed" ? "border-emerald-400 bg-emerald-400" : "border-ink-faint"
              }`}>
                {provider === "smart_feed" && <div className="h-1.5 w-1.5 rounded-full bg-black" />}
              </div>
            </div>

            {/* Provider 2: Auto.dev API */}
            <div
              onClick={() => setProvider("autodev")}
              className={`cursor-pointer rounded-xl border p-3.5 transition-all flex items-start justify-between gap-3 ${
                provider === "autodev"
                  ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
                  : "border-border bg-surface-elevated hover:border-border-strong"
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-xs">Auto.dev Live Inventory API</span>
                  <span className="rounded bg-blue-500/20 px-1.5 py-0.2 text-[9px] font-extrabold text-blue-400 uppercase">
                    Nationwide US Feed
                  </span>
                </div>
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  Direct REST API connection pulling live dealership cars, window sticker packages, and photos from auto.dev.
                </p>
              </div>
              <div className={`h-4 w-4 rounded-full border flex items-center justify-center mt-0.5 shrink-0 ${
                provider === "autodev" ? "border-emerald-400 bg-emerald-400" : "border-ink-faint"
              }`}>
                {provider === "autodev" && <div className="h-1.5 w-1.5 rounded-full bg-black" />}
              </div>
            </div>

            {/* Provider 3: MarketCheck API */}
            <div
              onClick={() => setProvider("marketcheck")}
              className={`cursor-pointer rounded-xl border p-3.5 transition-all flex items-start justify-between gap-3 ${
                provider === "marketcheck"
                  ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
                  : "border-border bg-surface-elevated hover:border-border-strong"
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-xs">MarketCheck Dealer API</span>
                  <span className="rounded bg-purple-500/20 px-1.5 py-0.2 text-[9px] font-extrabold text-purple-400 uppercase">
                    Enterprise
                  </span>
                </div>
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  Real-time automotive market intelligence and live dealership inventory listings across the US & Canada.
                </p>
              </div>
              <div className={`h-4 w-4 rounded-full border flex items-center justify-center mt-0.5 shrink-0 ${
                provider === "marketcheck" ? "border-emerald-400 bg-emerald-400" : "border-ink-faint"
              }`}>
                {provider === "marketcheck" && <div className="h-1.5 w-1.5 rounded-full bg-black" />}
              </div>
            </div>
          </div>

          {/* API Key Input (if non-smart feed) */}
          {provider !== "smart_feed" && (
            <div className="space-y-1.5 pt-1 animate-fadeIn">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase font-bold text-ink-faint">
                  {provider === "autodev" ? "Auto.dev API Key" : "MarketCheck API Key"}
                </label>
                <a
                  href={provider === "autodev" ? "https://auto.dev" : "https://marketcheck.com"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
                >
                  <span>Get API Key</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                <input
                  type="password"
                  placeholder={provider === "autodev" ? "Paste Auto.dev API key..." : "Paste MarketCheck API key..."}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder-ink-faint font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Test Connection Button & Result */}
          <div className="pt-2">
            <button
              type="button"
              disabled={isTesting}
              onClick={handleTestConnection}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-elevated py-2 text-xs font-bold text-ink-light hover:text-white hover:border-emerald-500/50 hover:bg-border transition-all"
            >
              {isTesting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                  <span>Pinging Inventory Endpoint...</span>
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5 text-emerald-400 fill-emerald-400" />
                  <span>Test Connection & Response Time</span>
                </>
              )}
            </button>

            {testResult && (
              <div
                className={`mt-2.5 rounded-xl border p-3 flex items-start gap-2.5 text-xs animate-fadeIn ${
                  testResult.success
                    ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                    : "border-rose-500/30 bg-rose-950/20 text-rose-300"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">{testResult.message}</div>
                  {testResult.success && (
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      Retrieved {testResult.carsFound} live dealer listings in {testResult.latencyMs}ms.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 active:scale-95"
          >
            <CheckCircle2 className="h-4 w-4 stroke-[2.5]" />
            <span>Save & Sync Inventory</span>
          </button>
        </div>
      </div>
    </div>
  );
};
