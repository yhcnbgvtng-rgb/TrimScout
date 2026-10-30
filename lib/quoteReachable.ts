/**
 * "Can a quote request reach this dealer" — one rule for the admin tile, the wizard badge, quote routing and
 * contact writes. The logic lives in the crawler source tree (plain JS) because the box runs the same file;
 * this is its typed entry point for the web app. See the header there for the audit that motivated it.
 */
import {
  BLOCKED_EMAIL_DOMAINS as blockedDomains,
  DEPARTMENT_MAILBOXES as departmentMailboxes,
  classifyContactEmail as classify,
  contactEmailWriteProblem as writeProblem,
  groupDomainsFrom as groupDomains,
  stampGroupDomains as stamp,
  isQuoteReachable as reachable,
  reachabilityBucket as bucket,
} from "../scrapers/lightsail-crawler/src/quoteReachable.js";

export interface ReachabilityContact {
  contactEmail?: string | null;
  dealerName?: string | null;
  website?: string | null;
  domains?: string[] | string | null;
  emailOptOut?: boolean | null;
  /** Stamped by stampGroupDomains when the directory loads: the address is on a domain 2+ rooftops share (a dealer group's own). */
  emailInGroupDomain?: boolean;
}

export type EmailStatus = "none" | "invalid" | "unverified" | "valid";
export type ReachabilityBucket = "reachable" | "unverified" | "none";

export const BLOCKED_EMAIL_DOMAINS: readonly string[] = blockedDomains;
export const DEPARTMENT_MAILBOXES: ReadonlySet<string> = departmentMailboxes;

export const classifyContactEmail = classify as (contact: ReachabilityContact) => { status: EmailStatus; reason: string | null };
export const isQuoteReachable = reachable as (contact: ReachabilityContact) => boolean;
export const reachabilityBucket = bucket as (contact: ReachabilityContact) => ReachabilityBucket;
export const contactEmailWriteProblem = writeProblem as (email: string | null | undefined) => string | null;
export const groupDomainsFrom = groupDomains as (emails: Array<string | null | undefined>, minRooftops?: number) => Set<string>;
export const stampGroupDomains = stamp as <T extends { contactEmail?: string | null }>(rows: T[], minRooftops?: number) => Array<T & { emailInGroupDomain: boolean }>;
