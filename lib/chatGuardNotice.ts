/**
 * The email Paul gets when a dealer's chat is paused (3 blocked messages in 30 days). Sent through the SAFE MODE sender
 * (lib/dealerEmail.ts), so it lands at the safe recipient. Never contains the blocked text; only who, how many and where to lift it.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildChatPauseNotice(i: { dealerName: string; attempts: number; adminUrl: string }): { subject: string; html: string } {
  const subject = `[SAFE MODE] Dealer chat paused: ${i.dealerName}`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#111;">
    <p style="font-size:12px;color:#a16207;background:#fef9c3;border-radius:8px;padding:8px 10px;">
      <strong>SAFE MODE:</strong> this admin notification was redirected here per site-owner override.
    </p>
    <h1 style="font-size:18px;margin:16px 0 8px;">Chat paused for ${esc(i.dealerName)}</h1>
    <p style="font-size:14px;line-height:1.6;color:#374151;">${esc(i.dealerName)} had ${i.attempts} messages blocked for trying to share contact information in 30 days, so chat is now paused for this dealership on all deals. The buyer never saw any of them. An admin can lift the pause from the chat review page.</p>
    <a href="${esc(i.adminUrl)}" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#22c55e;color:#000;font-weight:800;text-decoration:none;">Open chat review</a>
  </div>`.trim();
  return { subject, html };
}
