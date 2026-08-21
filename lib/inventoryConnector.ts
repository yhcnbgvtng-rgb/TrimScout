import { Vehicle } from "./types";

export interface InventoryFetchOptions {
  query?: string;
  make?: string;
  zip?: string;
  radius?: number;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
  provider?: "autodev" | "marketcheck" | "smart_feed";
  apiKey?: string;
}

export interface InventoryFeedResponse {
  success: boolean;
  provider: "autodev" | "marketcheck" | "smart_feed";
  isLiveApi: boolean;
  totalFound: number;
  page?: number;
  limit?: number;
  hasMore?: boolean;
  zip: string;
  radius: number;
  query?: string;
  data: Vehicle[];
}

const STORAGE_KEY = "trimscout_inventory_connector_config";
const DEFAULT_AUTO_DEV_KEY = "sk_ad_Xc5T6i3mwxFF1X8x_WbFNl5a";

export function getConnectorConfig(): {
  provider: "autodev" | "marketcheck" | "smart_feed";
  apiKey: string;
} {
  if (typeof window === "undefined") {
    return { provider: "autodev", apiKey: DEFAULT_AUTO_DEV_KEY };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        provider: parsed.provider || "autodev",
        apiKey: parsed.apiKey || DEFAULT_AUTO_DEV_KEY,
      };
    }
  } catch (e) {
    console.error("Failed to load connector config:", e);
  }
  return { provider: "autodev", apiKey: DEFAULT_AUTO_DEV_KEY };
}

export function saveConnectorConfig(config: {
  provider: "autodev" | "marketcheck" | "smart_feed";
  apiKey: string;
}) {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.error("Failed to save connector config:", e);
    }
  }
}

export async function fetchLiveInventory(
  options: InventoryFetchOptions = {}
): Promise<InventoryFeedResponse> {
  const config = getConnectorConfig();
  const provider = options.provider || config.provider || "smart_feed";
  const apiKey = options.apiKey || config.apiKey || "";

  const baseUrl = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "http://localhost:3000";
  const url = new URL("/api/inventory", baseUrl);
  if (options.query) url.searchParams.set("query", options.query);
  if (options.make && options.make !== "All") url.searchParams.set("make", options.make);
  if (options.zip) url.searchParams.set("zip", options.zip);
  if (options.radius) url.searchParams.set("radius", options.radius.toString());
  if (options.minPrice) url.searchParams.set("minPrice", options.minPrice.toString());
  if (options.maxPrice) url.searchParams.set("maxPrice", options.maxPrice.toString());
  if (options.page) url.searchParams.set("page", options.page.toString());
  if (options.limit) url.searchParams.set("limit", options.limit.toString());
  url.searchParams.set("provider", provider);
  if (apiKey) url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Inventory connector responded with HTTP ${res.status}`);
  }

  const data = await res.json();
  return data as InventoryFeedResponse;
}
