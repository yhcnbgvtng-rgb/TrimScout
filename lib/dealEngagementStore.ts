/**
 * File-backed engagement store for dealer click/view/respond events and the
 * offer-close clock. Same persistence style as other local JSON under data/.
 * When the Lightsail deals API is configured, the blob is also stored there
 * so Vercel instances share one copy — no Redis.
 */

import fs from "node:fs";
import path from "node:path";
import {
  applyClick,
  applyExtend,
  applyLazyClose,
  applyRespond,
  applySeedInvites,
  applyView,
  emptyEngagementStore,
  snapshotDealEngagement,
  type DealEngagementSnapshot,
  type EngagementStoreData,
  type InvitedDealerSeed,
  type StoredDealEngagement,
} from "./dealEngagement";
import { LIGHTSAIL_HOST } from "./lightsailClient";
import { expireDealRequest } from "./dealsApi";
import { serverSecret } from "./serverSecret";

const DEALS_API_PORT = 3004;
const DEFAULT_STORE_PATH = path.join(process.cwd(), "data", "deal-engagement.json");

function storePath(): string {
  return process.env.DEAL_ENGAGEMENT_STORE_PATH || DEFAULT_STORE_PATH;
}

function dealsApiConfigured(): boolean {
  return Boolean(serverSecret("LIGHTSAIL_API_KEY") || process.env.LIGHTSAIL_API_KEY);
}

let writeChain: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function readLocal(): EngagementStoreData {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as EngagementStoreData;
    if (!parsed || typeof parsed !== "object") return emptyEngagementStore();
    return {
      tokens: parsed.tokens && typeof parsed.tokens === "object" ? parsed.tokens : {},
      deals: parsed.deals && typeof parsed.deals === "object" ? parsed.deals : {},
    };
  } catch {
    return emptyEngagementStore();
  }
}

function writeLocal(data: EngagementStoreData): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

async function fetchRemote(): Promise<EngagementStoreData | null> {
  const apiKey = serverSecret("LIGHTSAIL_API_KEY") || process.env.LIGHTSAIL_API_KEY || "";
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`http://${LIGHTSAIL_HOST}:${DEALS_API_PORT}/api/deal-engagement`, {
      headers: { "X-Trimscout-Api-Key": apiKey },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as EngagementStoreData;
    if (!json || typeof json !== "object") return null;
    return {
      tokens: json.tokens && typeof json.tokens === "object" ? json.tokens : {},
      deals: json.deals && typeof json.deals === "object" ? json.deals : {},
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function pushRemote(data: EngagementStoreData): Promise<void> {
  const apiKey = serverSecret("LIGHTSAIL_API_KEY") || process.env.LIGHTSAIL_API_KEY || "";
  if (!apiKey) return;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    await fetch(`http://${LIGHTSAIL_HOST}:${DEALS_API_PORT}/api/deal-engagement`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Trimscout-Api-Key": apiKey,
      },
      body: JSON.stringify(data),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    // Local file remains the working copy if the box is unreachable.
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadStore(): Promise<EngagementStoreData> {
  const local = readLocal();
  if (dealsApiConfigured()) {
    const remote = await fetchRemote();
    if (remote && (Object.keys(remote.deals).length > 0 || Object.keys(local.deals).length === 0)) {
      return remote;
    }
  }
  return local;
}

async function saveStore(data: EngagementStoreData): Promise<void> {
  writeLocal(data);
  if (dealsApiConfigured()) await pushRemote(data);
}

async function mutate<T>(fn: (store: EngagementStoreData) => T): Promise<T> {
  return enqueue(async () => {
    const store = await loadStore();
    const result = fn(store);
    await saveStore(store);
    return result;
  });
}

export async function seedDealInvites(
  dealRequestId: string,
  seeds: InvitedDealerSeed[],
  timeZone: string
): Promise<StoredDealEngagement> {
  return mutate((store) => applySeedInvites(store, dealRequestId, seeds, timeZone));
}

export async function recordDealerClick(token: string, now = new Date()) {
  return mutate((store) => applyClick(store, token, now));
}

export async function recordDealerView(
  args: {
    token?: string | null;
    dealRequestId?: string | null;
    dealerName: string;
    dealerState?: string;
    dealerCity?: string;
  },
  now = new Date()
) {
  return mutate((store) => applyView(store, args, now));
}

export async function recordDealerRespond(
  args: { dealRequestId: string; dealerName: string; dealerState?: string; dealerCity?: string },
  now = new Date()
) {
  return mutate((store) => applyRespond(store, args, now));
}

export async function extendDealClock(dealRequestId: string, now = new Date()) {
  return mutate((store) => applyExtend(store, dealRequestId, now));
}

export async function getDealEngagementSnapshot(
  dealRequestId: string,
  now = new Date()
): Promise<DealEngagementSnapshot | null> {
  return mutate((store) => {
    const deal = store.deals[dealRequestId];
    if (!deal) return null;
    applyLazyClose(deal, now);
    return snapshotDealEngagement(deal, now);
  });
}

export async function getDealEngagementSnapshots(
  dealRequestIds: string[],
  now = new Date()
): Promise<Record<string, DealEngagementSnapshot>> {
  return mutate((store) => {
    const out: Record<string, DealEngagementSnapshot> = {};
    for (const id of dealRequestIds) {
      const deal = store.deals[id];
      if (!deal) continue;
      applyLazyClose(deal, now);
      out[id] = snapshotDealEngagement(deal, now);
    }
    return out;
  });
}

export async function isDealAcceptingResponses(dealRequestId: string, now = new Date()): Promise<boolean> {
  const snap = await getDealEngagementSnapshot(dealRequestId, now);
  if (!snap) return true;
  return snap.acceptingResponses;
}

export async function decorateDealRequestJson(
  dr: Record<string, unknown>,
  now = new Date()
): Promise<Record<string, unknown>> {
  const id = String(dr.id || "");
  if (!id) return dr;
  const snap = await getDealEngagementSnapshot(id, now);
  if (!snap) return dr;
  if (snap.clock.status === "closed" && dr.status !== "locked") {
    dr = { ...dr, status: "expired" };
    expireDealRequest(id).catch(() => {
      // Box may not have the expire route yet — Next.js still refuses new bids.
    });
  }
  return {
    ...dr,
    dealerEngagement: snap.dealers,
    offerClock: snap.clock,
  };
}
