/**
 * The Next side of the conversation guard (the rules, strikes, pauses and review queue live on the deals server: rfqChatGuard.js).
 * This file has the sender-facing copy and the AI check for borderline messages.
 *
 * AI check: a short yes/no question to the existing Anthropic setup (ANTHROPIC_API_KEY, like lib/negotiationCopy.ts). Anything but a clear
 * "yes" or "no" inside 3 seconds - no key, an error, a bad status, a timeout, a rambling answer - is "unavailable", and the box then HOLDS
 * the message for an admin instead of delivering it. A "yes" blocks. Env: ANTHROPIC_API_KEY (existing); CHAT_AI_REVIEW=off forces every
 * borderline message to the admin queue; CHAT_AI_REVIEW_MODEL overrides the model.
 */
import { env } from "node:process";
import { serverSecret } from "./serverSecret";
export { BLOCKED_NOTE, COMPOSE_NOTICE, FIRST_WARNING, HELD_NOTE, PAUSED_NOTE, STRIKE_LIMIT, STRIKE_WINDOW_DAYS } from "./chatCopy";

export const AI_TIMEOUT_MS = 3000;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export type AiVerdict = "yes" | "no" | "unavailable";

const QUESTION = "Does this message attempt to share personal contact info or identity (a name, a phone number in any form including spelled out or split up, an email, a social media handle, an address)? Answer with exactly one word: yes or no.";

/** Pure: what the model's reply means. Only a bare yes/no counts. */
export function parseAiVerdict(reply: unknown): AiVerdict {
  const t = String(reply ?? "").trim().toLowerCase().replace(/[.!"'\s]+$/g, "");
  if (t === "yes") return "yes";
  if (t === "no") return "no";
  return "unavailable";
}

/** Asks the AI. Never throws; never takes longer than AI_TIMEOUT_MS. `fetchImpl` and `apiKey` are injectable for tests. */
export async function aiBorderlineCheck(text: string, opts: { fetchImpl?: typeof fetch; apiKey?: string; timeoutMs?: number } = {}): Promise<AiVerdict> {
  if (/^(off|0|false|no)$/i.test(String(env.CHAT_AI_REVIEW || process.env.CHAT_AI_REVIEW || "").trim())) return "unavailable";
  const apiKey = opts.apiKey ?? serverSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return "unavailable";
  const timeoutMs = opts.timeoutMs ?? AI_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AiVerdict>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve("unavailable"); }, timeoutMs);
  });
  const ask = (async (): Promise<AiVerdict> => {
    try {
      const res = await doFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: String(env.CHAT_AI_REVIEW_MODEL || process.env.CHAT_AI_REVIEW_MODEL || DEFAULT_MODEL),
          max_tokens: 5,
          messages: [{ role: "user", content: `${QUESTION}\n\nMessage:\n"""${text.slice(0, 1000)}"""` }],
        }),
      });
      if (!res.ok) return "unavailable";
      const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
      return parseAiVerdict(json.content?.find((c) => c.type === "text")?.text);
    } catch {
      return "unavailable";
    }
  })();
  try {
    return await Promise.race([ask, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
