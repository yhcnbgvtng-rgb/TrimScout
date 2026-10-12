/**
 * What may not be said in the buyer <-> dealer conversation: nothing that reveals who someone is. One rule set shared with the deals
 * server (scrapers/lightsail-crawler/src/identityFilter.js), which is the authority: it normalizes look-alike characters, emoji digits,
 * number words and spacing, checks the sender's last five messages joined together, refuses links other than trimscout.com and files,
 * and scores borderline messages for the AI check. See that file for the rules.
 */
import {
  ALLOWED_LINK_HOSTS as hosts,
  CROSS_MESSAGE_WINDOW as window,
  RISK_THRESHOLD as threshold,
  findAcrossMessages as across,
  findContactVector as vector,
  findIdentityInfo as find,
  hasAttachment as attachment,
  riskScore as risk,
  screenMessage as screen,
} from "../scrapers/lightsail-crawler/src/identityFilter.js";

export const ALLOWED_LINK_HOSTS = hosts as string[];
export const CROSS_MESSAGE_WINDOW = window as number;
export const RISK_THRESHOLD = threshold as number;
export const findIdentityInfo = find as (text: string) => string | null;
export const findContactVector = vector as (text: string) => string | null;
export const findAcrossMessages = across as (previous: string[], text: string) => string | null;
export const riskScore = risk as (text: string) => number;
export const hasAttachment = attachment as (body: unknown) => boolean;
export const screenMessage = screen as (input: { text: string; previous?: string[] }) => { verdict: "block" | "review" | "pass"; reason: string | null; score: number | null };
