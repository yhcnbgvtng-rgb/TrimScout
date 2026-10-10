// Box addresses for repo-side tooling. Source of truth: config/boxes.json (mirrors docs/BOXES.md).
// Env overrides: TRIMSCOUT_DEALS_HOST (deals box host), TRIMSCOUT_BOX<N>_HOST (per box).
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("./boxes.json", import.meta.url), "utf-8"));

export const SSH_USER = cfg.sshUser;
export const DEAD_IPS = cfg.deadIps;
export const BOXES = Object.entries(cfg.boxes).map(([label, b]) => ({
  label,
  host: process.env[`TRIMSCOUT_${label.toUpperCase()}_HOST`] || b.host,
  privateIp: b.privateIp,
  sshUser: cfg.sshUser,
  remoteDir: b.remoteDir,
}));
export const DEALS_HOST = process.env.TRIMSCOUT_DEALS_HOST || cfg.boxes[cfg.dealsBox].host;

/** True if any of the given host strings contains a retired IP. */
export function pointsAtDeadIp(...hosts) {
  return hosts.some((h) => DEAD_IPS.some((ip) => String(h || "").includes(ip)));
}
