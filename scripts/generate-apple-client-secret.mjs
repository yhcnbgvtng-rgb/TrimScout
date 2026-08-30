#!/usr/bin/env node
// Generates the signed JWT Apple's "Sign in with Apple" uses as an OAuth
// client secret (Auth.js's Apple provider expects this pre-built — it does
// not generate it for you). Apple caps this JWT's validity at 6 months, so
// re-run this and update AUTH_APPLE_SECRET in Vercel before it expires.
//
// Usage:
//   node scripts/generate-apple-client-secret.mjs \
//     --team-id ABCDE12345 \
//     --key-id FGHIJ67890 \
//     --client-id com.trimscout.web \
//     --key-file /path/to/AuthKey_FGHIJ67890.p8
//
// team-id:   Apple Developer > Membership > Team ID
// key-id:    the Key ID shown when you created the "Sign in with Apple" key
// client-id: your Services ID identifier (e.g. com.trimscout.web) — this
//            is what goes in AUTH_APPLE_ID too
// key-file:  the .p8 private key file Apple lets you download exactly once

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, "")] = argv[i + 1];
  }
  return args;
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { "team-id": teamId, "key-id": keyId, "client-id": clientId, "key-file": keyFile } = parseArgs();

if (!teamId || !keyId || !clientId || !keyFile) {
  console.error("Missing required argument. Usage:");
  console.error(
    "  node scripts/generate-apple-client-secret.mjs --team-id <TEAM_ID> --key-id <KEY_ID> --client-id <SERVICES_ID> --key-file <path/to/AuthKey.p8>"
  );
  process.exit(1);
}

const privateKey = readFileSync(keyFile, "utf-8");

const now = Math.floor(Date.now() / 1000);
const SIX_MONTHS = 15777000; // Apple's own maximum

const header = { alg: "ES256", kid: keyId };
const payload = {
  iss: teamId,
  iat: now,
  exp: now + SIX_MONTHS,
  aud: "https://appleid.apple.com",
  sub: clientId,
};

const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

const signer = createSign("SHA256");
signer.update(signingInput);
signer.end();
// ES256 needs the raw (r||s) signature format, not DER — Node calls this
// "ieee-p1363", available since Node 14.
const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
const jwt = `${signingInput}.${signature.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

console.log("\nAUTH_APPLE_SECRET (valid ~6 months, regenerate before it expires):\n");
console.log(jwt);
console.log(`\nAlso set AUTH_APPLE_ID=${clientId}\n`);
