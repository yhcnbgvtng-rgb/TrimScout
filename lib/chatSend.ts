/**
 * Sending one chat message through the guard, shared by the dealer's and the buyer's thread routes: post it to the deals server (which
 * screens it, logs attempts, enforces pauses), ask the AI when the server says a message is borderline and re-post with the verdict, and
 * email Paul (SAFE MODE) when this attempt paused a dealer. Never returns the text of a refused message.
 */
import { postChatMessage, type ChatPostResult } from "./rfqApi";
import { aiBorderlineCheck, type AiVerdict } from "./chatGuard";
import { buildChatPauseNotice } from "./chatGuardNotice";
import { sendChatPauseNotice } from "./dealerEmail";
import { DEALER_EMAIL_BASE_URL } from "./dealerUnsubscribe";

export type ChatOutcome =
  | { status: "delivered" }
  | { status: "blocked"; note: string; warning: string | null; paused: boolean }
  | { status: "held"; note: string }
  | { status: "paused"; note: string };

export async function sendWithGuard(
  i: { rfqId: string; inviteId: string; from: "buyer" | "dealer"; text: string; dealerName: string },
  deps: { check?: (text: string) => Promise<AiVerdict>; post?: typeof postChatMessage; notify?: typeof sendChatPauseNotice } = {}
): Promise<ChatOutcome> {
  const post = deps.post ?? postChatMessage;
  const check = deps.check ?? ((t: string) => aiBorderlineCheck(t));
  let r: ChatPostResult = await post(i.rfqId, i.inviteId, { from: i.from, text: i.text });
  if (r.status === "needs_review") r = await post(i.rfqId, i.inviteId, { from: i.from, text: i.text, aiVerdict: await check(i.text) });
  switch (r.status) {
    case "blocked":
      if (r.justPaused && i.from === "dealer") {
        await (deps.notify ?? sendChatPauseNotice)(buildChatPauseNotice({ dealerName: i.dealerName, attempts: r.attempts, adminUrl: `${DEALER_EMAIL_BASE_URL}/admin/chat-review` }));
      }
      return { status: "blocked", note: r.note, warning: r.warning, paused: r.paused };
    case "held":
      return { status: "held", note: r.note };
    case "paused":
      return { status: "paused", note: r.note };
    case "needs_review":
      // The re-post answers needs_review only if the box ignored the verdict: nothing was delivered, so hold it rather than guess.
      return { status: "held", note: "This message is being reviewed before it's sent." };
    default:
      return { status: "delivered" };
  }
}
