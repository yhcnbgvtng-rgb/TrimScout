/**
 * The sender-facing copy of the conversation guard. Client-safe (no server imports): the panel and the server share it. The wording of
 * the notes lives next to the rules, in scrapers/lightsail-crawler/src/rfqChatGuard.js.
 */
import {
  BLOCKED_NOTE as blocked,
  FIRST_WARNING as warning,
  HELD_NOTE as held,
  PAUSED_NOTE as paused,
  STRIKE_LIMIT as limit,
  STRIKE_WINDOW_DAYS as windowDays,
} from "../scrapers/lightsail-crawler/src/rfqChatGuard.js";

export const BLOCKED_NOTE = blocked as string;
export const HELD_NOTE = held as string;
export const PAUSED_NOTE = paused as string;
export const FIRST_WARNING = warning as string;
export const STRIKE_LIMIT = limit as number;
export const STRIKE_WINDOW_DAYS = windowDays as number;
/** Shown above the compose box, to both sides. */
export const COMPOSE_NOTICE = "Contact details are shared automatically when the buyer accepts the final deal. Sharing them earlier breaks TrimScout's terms.";
