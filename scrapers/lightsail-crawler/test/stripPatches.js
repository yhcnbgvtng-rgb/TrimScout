// The repo mirror of deals_api_server.js carries every box patch. Older patch tests want the text as it was before the later ones, so
// these take the later patches' additions back out (the exact inverse of each patch's replacements).

/** Removes the 2026-10-12 conversation-guard additions. */
export function withoutChatGuardPatch(text) {
  return text
    .replace('import { createChatAdminHandlers } from "./rfqChatAdmin.js";\n', '')
    .replace(/\/\/ Conversation guard: admin review queue[^\n]*\nconst chatAdmin = createChatAdminHandlers\([^\n]*\n\n/, '')
    .replace(/  const chatStatusMatch[\s\S]*?  if \(req\.method === "POST" && pathname === "\/api\/admin\/chat-pauses\/lift"\) return run\(chatAdmin\.lift\);\n/, '');
}

/** Removes the 2026-10-11 rfq-messages additions (and, first, the guard that sits on top of them). */
export function withoutMessagesPatch(text) {
  return withoutChatGuardPatch(text)
    .replace('import { createRfqMessagesHandler } from "./rfqMessages.js";\n', '')
    .replace('  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS messages_json TEXT NULL");\n', '')
    .replace(/    \/\/ This desk's buyer <-> dealer chat[^\n]*\n    messages: parseJsonCol\(row\.messages_json\) \|\| \[\],\n/, '')
    .replace(/\/\/ POST \/api\/rfqs\/:id\/invites\/:inviteId\/messages[\s\S]*?\n\}\);\n\n/, '')
    .replace(/  const rfqInviteMessagesMatch[\s\S]*?\n  \}\n/, '');
}
