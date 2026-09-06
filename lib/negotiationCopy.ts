/**
 * Optional LLM polish of a negotiation message — never the decision.
 *
 * The action and every dollar figure come from lib/negotiationPolicy.ts's
 * NegotiationDecision and are never touched here. If ANTHROPIC_API_KEY /
 * OPENAI_API_KEY isn't set, this returns the policy's own template
 * unchanged — the negotiate route works fully without an LLM.
 */

import { findContactInfo } from "./piiFilter";
import { serverSecret } from "./serverSecret";

const MAX_MESSAGE_LENGTH = 320;

export interface PolishInput {
  messageTemplate: string;
  dealerName: string;
  /** The one dollar figure this rewrite is allowed to keep — never invent another. */
  otdFigures: string[];
}

function stripContactInfoOrFallback(text: string, fallback: string): string {
  return findContactInfo(text) ? fallback : text;
}

/**
 * Rewrites messageTemplate for tone only. Falls back to the template
 * verbatim on any missing key, API error, or a result that looks like it
 * changed a number (a cheap but deliberate guard — this function must
 * never let wording drift the dollar amount the policy decided on).
 */
export async function polishNegotiationMessage(input: PolishInput): Promise<string> {
  const apiKey = serverSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return input.messageTemplate;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content:
              `Rewrite this buyer-to-dealer negotiation message to sound natural and polite. ` +
              `Keep every dollar amount exactly as written — do not change, round, or invent any number. ` +
              `Do not add a phone number, email, or any other contact info. Keep it under ${MAX_MESSAGE_LENGTH} characters. ` +
              `Reply with only the rewritten message, no preamble.\n\n"${input.messageTemplate}"`,
          },
        ],
      }),
    });
    if (!res.ok) return input.messageTemplate;
    const json = await res.json();
    const text = json?.content?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) return input.messageTemplate;

    const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    // Every dollar figure the policy put in the template must survive the
    // rewrite verbatim, or we don't trust it.
    const keptAllFigures = input.otdFigures.every((fig) => trimmed.includes(fig));
    if (!keptAllFigures) return input.messageTemplate;

    return stripContactInfoOrFallback(trimmed, input.messageTemplate);
  } catch {
    return input.messageTemplate;
  }
}
