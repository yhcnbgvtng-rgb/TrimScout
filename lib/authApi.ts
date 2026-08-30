// Client for the auth backend on the box (MariaDB-backed, port 3003) — see
// scrapers/lightsail-crawler/src/auth_api_server.js for the server this
// talks to. Same reasoning as lib/lightsailClient.ts: the Next.js app
// never touches MariaDB directly (Vercel's serverless functions have no
// fixed outbound IP to firewall-allow), it calls this HTTP API instead,
// using the same shared X-Trimscout-Api-Key header as every other box
// route.
//
// Every function here throws on failure rather than returning null — auth
// is not a "fall back to stale data" surface the way inventory reads are;
// a failed signup or sign-in needs to surface as a real error to the user,
// not silently degrade.

import { LIGHTSAIL_HOST } from "./lightsailClient";

const AUTH_API_PORT = 3003;
const API_KEY = process.env.LIGHTSAIL_API_KEY;
const DEFAULT_TIMEOUT_MS = 8000;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "buyer" | "dealer" | "admin";
  phone: string | null;
  zipCode: string | null;
  avatarUrl: string | null;
  dealerName: string | null;
  status: "active" | "suspended" | "pending_verification";
  createdAt: string;
  lastLogin: string | null;
}

export class AuthApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function postJson(path: string, body: unknown): Promise<AuthUser> {
  if (!API_KEY) {
    throw new AuthApiError("Auth backend is not configured (missing LIGHTSAIL_API_KEY)", 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`http://${LIGHTSAIL_HOST}:${AUTH_API_PORT}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Trimscout-Api-Key": API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new AuthApiError(
      err instanceof Error && err.name === "AbortError" ? "Auth request timed out" : "Could not reach auth service",
      503
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // no-op — handled by the !res.ok branch below
  }

  if (!res.ok) {
    throw new AuthApiError(json?.error || `Auth request failed (${res.status})`, res.status);
  }
  return json.user as AuthUser;
}

export async function signup(input: {
  email: string;
  password: string;
  name: string;
  role: "buyer" | "dealer";
  phone?: string;
  zipCode?: string;
  dealerName?: string;
}): Promise<AuthUser> {
  return postJson("/api/auth/signup", input);
}

export async function verifyCredentials(email: string, password: string): Promise<AuthUser> {
  return postJson("/api/auth/verify-credentials", { email, password });
}

export async function oauthUpsert(input: {
  provider: "google" | "apple";
  providerAccountId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}): Promise<AuthUser> {
  return postJson("/api/auth/oauth-upsert", input);
}
