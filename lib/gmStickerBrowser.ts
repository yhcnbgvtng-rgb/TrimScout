/**
 * Small Chrome/CDP worker for GM window-sticker PDFs.
 *
 * Akamai Bot Manager on cws.gm.com returns HTTP 200 + Content-Type PDF with
 * a 0-byte body (and `_abck` / `bm_sz` cookies) to datacenter curl, TLS
 * impersonation, and even headless Chrome from this IP. Ford Direct from the
 * same machine returns a real ~1 MB PDF.
 *
 * This worker is the fallback the product asked for — not dealer-site scraping.
 * It uses:
 *   1. GM_STICKER_BROWSER_WS  — remote CDP (Browserless / Browserbase / similar)
 *   2. CHROME_PATH or a well-known local Chrome binary
 *
 * If the browser still gets 0 bytes, the caller must treat that as the Akamai
 * datacenter block and fall back to a bundled fixture (demo VIN only) or error.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";

const GM_PDF_PATH = "/vs-cws/vehshop/v2/vehicle/windowsticker";

export function detectChromePath(): string | null {
  const env = process.env.CHROME_PATH?.trim();
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/local/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function bytesFromCdpBody(result: { body?: string; base64Encoded?: boolean }): Uint8Array {
  const body = result.body || "";
  if (result.base64Encoded) return new Uint8Array(Buffer.from(body, "base64"));
  return new Uint8Array(Buffer.from(body, "utf8"));
}

async function cdpCall(
  ws: WebSocket,
  id: number,
  method: string,
  params?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000);
    const onMessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== id) return;
        cleanup();
        if (msg.error) reject(new Error(`CDP ${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result || {});
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function openWs(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("WebSocket connect timeout")), 15000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
  return ws;
}

async function fetchPdfOverCdp(pageWsUrl: string, pdfUrl: string): Promise<Uint8Array> {
  const ws = await openWs(pageWsUrl);
  let nextId = 1;
  const call = (method: string, params?: Record<string, unknown>) =>
    cdpCall(ws, nextId++, method, params);

  const requestBodies = new Map<string, Uint8Array>();
  const pending = new Map<string, string>();

  const onEvent = (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (!msg.method) return;
      if (msg.method === "Network.responseReceived" && msg.params?.response) {
        const u = String(msg.params.response.url || "");
        if (u.includes(GM_PDF_PATH) || u === pdfUrl) {
          pending.set(msg.params.requestId, u);
        }
      }
      if (msg.method === "Network.loadingFinished" && pending.has(msg.params?.requestId)) {
        const requestId = msg.params.requestId as string;
        call("Network.getResponseBody", { requestId })
          .then((body) => {
            requestBodies.set(requestId, bytesFromCdpBody(body as { body?: string; base64Encoded?: boolean }));
          })
          .catch(() => {
            requestBodies.set(requestId, new Uint8Array());
          });
      }
    } catch {
      /* ignore non-JSON */
    }
  };
  ws.addEventListener("message", onEvent);

  await call("Network.enable");
  await call("Page.enable");
  await call("Page.navigate", { url: pdfUrl });

  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    for (const bytes of requestBodies.values()) {
      if (bytes.length > 0) {
        ws.close();
        return bytes;
      }
    }
  }

  // In-page fetch as a second try (shares the browser cookie jar / TLS).
  try {
    const evaled = await call("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `fetch(${JSON.stringify(pdfUrl)}, { credentials: "include" })
        .then(async (r) => {
          const buf = await r.arrayBuffer();
          const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          return { status: r.status, len: buf.byteLength, b64 };
        })`,
    });
    const value = (evaled.result as { value?: { len?: number; b64?: string } } | undefined)?.value;
    if (value?.b64 && (value.len || 0) > 0) {
      ws.close();
      return new Uint8Array(Buffer.from(value.b64, "base64"));
    }
  } catch {
    /* fall through */
  }

  ws.close();
  const empty = [...requestBodies.values()][0];
  return empty || new Uint8Array();
}

async function httpJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

async function pageWsFromBrowserRoot(browserWs: string): Promise<string> {
  // browserless / chrome: the given URL may already be a page target.
  if (browserWs.includes("/devtools/page/")) return browserWs;
  const u = new URL(browserWs);
  const httpBase = `${u.protocol === "wss:" ? "https" : "http"}://${u.host}`;
  const version = (await httpJson(`${httpBase}/json/version`).catch(() => null)) as
    | { webSocketDebuggerUrl?: string }
    | null;
  const list = (await httpJson(`${httpBase}/json/list`).catch(() => [])) as Array<{
    type?: string;
    webSocketDebuggerUrl?: string;
  }>;
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
  const created = (await httpJson(`${httpBase}/json/new?about:blank`).catch(() => null)) as
    | { webSocketDebuggerUrl?: string }
    | null;
  if (created?.webSocketDebuggerUrl) return created.webSocketDebuggerUrl;
  if (version?.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
  return browserWs;
}

async function fetchViaRemoteWs(browserWs: string, pdfUrl: string): Promise<Uint8Array> {
  const pageWs = await pageWsFromBrowserRoot(browserWs);
  return fetchPdfOverCdp(pageWs, pdfUrl);
}

function parseDevtoolsWs(stderr: string): string | null {
  const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
  return m?.[1] || null;
}

async function fetchViaLocalChrome(chromePath: string, pdfUrl: string): Promise<Uint8Array> {
  const proc: ChildProcess = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  let stderr = "";
  const wsUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome DevTools port did not come up")), 12000);
    const onData = (buf: Buffer) => {
      stderr += buf.toString();
      const found = parseDevtoolsWs(stderr);
      if (found) {
        clearTimeout(timer);
        resolve(found);
      }
    };
    proc.stderr?.on("data", onData);
    proc.stdout?.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited ${code} before DevTools: ${stderr.slice(-400)}`));
    });
  });

  try {
    const pageWs = await pageWsFromBrowserRoot(wsUrl);
    return await fetchPdfOverCdp(pageWs, pdfUrl);
  } finally {
    proc.kill("SIGKILL");
  }
}

export async function fetchGmPdfViaBrowser(pdfUrl: string): Promise<Uint8Array> {
  const remote = process.env.GM_STICKER_BROWSER_WS?.trim();
  if (remote) return fetchViaRemoteWs(remote, pdfUrl);
  const chrome = detectChromePath();
  if (!chrome) {
    throw new Error(
      "GM sticker browser worker has no Chrome. Set GM_STICKER_BROWSER_WS (remote CDP) or CHROME_PATH."
    );
  }
  return fetchViaLocalChrome(chrome, pdfUrl);
}

export function browserWorkerConfigured(): boolean {
  return Boolean(process.env.GM_STICKER_BROWSER_WS?.trim() || detectChromePath());
}
