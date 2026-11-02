// Plans the one-off cleanup of dealership_contacts.contact_email after the 2026-10-30 "Sales email on file" audit. Pure — the
// script (scripts/box/2026-10-30-contact-email-cleanup.mjs) reads the rows and does the I/O; this decides what would change.
//
//   clear — a stored address the shared rule calls invalid (department mailbox, vendor/OEM domain, scraped file name, bad format)
//           becomes NULL. Public-mail and unrelated-domain addresses are "unverified", not invalid: they are left alone.
//   move  — a row with NO usable contact_email whose notes carry an address that passes the SAME check gets it in contact_email.
//           The notes text is left as it is (a copy, not an edit), so rollback is just putting contact_email back.
import { classifyContactEmail, contactEmailProblem, emailDomainOf, isQuoteReachable, stampGroupDomains } from "./quoteReachable.js";

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g;

/**
 * rows: [{ id, dealerName, contactEmail, notes, website, domainsJson|domains, emailOptOut }]
 * activeIds: Set of ids with live inventory (optional — only for the "active" counts). It only needs to cover the ids the plan touches
 * (clear, move, lostReachableIds); the script looks those up one dealer at a time.
 * Returns { clear: [{id, old, kind}], move: [{id, old: null, next}], counts }.
 * @param {Array<{ id: number, dealerName?: string | null, contactEmail?: string | null, notes?: string | null, website?: string | null, domainsJson?: string | null, domains?: unknown, emailOptOut?: unknown }>} rows
 * @param {{ activeIds?: Set<number> | null }} [opts]
 */
export function planContactEmailCleanup(rows, { activeIds = null } = {}) {
  const stamped = stampGroupDomains(rows.map((r) => ({ ...r, domains: r.domains ?? r.domainsJson })));
  // Group domains are judged on the addresses as they are TODAY, so a cleanup cannot create or destroy a group.
  const groups = new Set(stamped.filter((r) => r.emailInGroupDomain).map((r) => emailDomainOf(r.contactEmail)));
  const clear = [];
  const move = [];
  const moveRejected = { no_address_in_notes: 0, bad_format: 0, junk_file_name: 0, department_mailbox: 0, vendor_or_oem_domain: 0, unverified: 0 };
  for (const r of stamped) {
    const current = String(r.contactEmail || "").trim();
    if (current) {
      const problem = contactEmailProblem(current);
      if (problem) clear.push({ id: r.id, old: r.contactEmail, kind: problem.kind });
      continue;
    }
    const found = String(r.notes || "").match(EMAIL_IN_TEXT);
    if (!found) continue;
    let chosen = null;
    let why = null;
    for (const cand of found) {
      const problem = contactEmailProblem(cand);
      if (problem) { why = why || problem.kind; continue; }
      const verdict = classifyContactEmail({ ...r, contactEmail: cand, emailInGroupDomain: groups.has(emailDomainOf(cand)) });
      if (verdict.status === "valid") { chosen = cand.toLowerCase(); break; }
      why = why || "unverified";
    }
    if (chosen) move.push({ id: r.id, old: null, next: chosen });
    else moveRejected[why || "no_address_in_notes"]++;
  }
  const isActive = (x) => (activeIds ? activeIds.has(x.id) : false);
  // Reachability before and after, judged the way the product judges it (isQuoteReachable: a valid address and no unsubscribe). The "after"
  // rows get their group domains re-stamped from the cleaned directory, exactly as the web app and box do once the directory reloads.
  const edit = new Map();
  for (const c of clear) edit.set(c.id, null);
  for (const m of move) edit.set(m.id, m.next);
  const after = stampGroupDomains(rows.map((r) => ({ ...r, domains: r.domains ?? r.domainsJson, contactEmail: edit.has(r.id) ? edit.get(r.id) : r.contactEmail })));
  const wasReachable = new Set(stamped.filter((r) => isQuoteReachable(r)).map((r) => r.id));
  const nowReachable = new Set(after.filter((r) => isQuoteReachable(r)).map((r) => r.id));
  const noReachableAfterIds = rows.filter((r) => !nowReachable.has(r.id)).map((r) => r.id);
  const lostReachableIds = [...wasReachable].filter((id) => !nowReachable.has(id));
  const byKind = {};
  for (const c of clear) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  return {
    clear,
    move,
    lostReachableIds,
    counts: {
      rows: rows.length,
      clear: clear.length,
      clearByKind: byKind,
      clearActive: activeIds ? clear.filter(isActive).length : null,
      move: move.length,
      moveActive: activeIds ? move.filter(isActive).length : null,
      moveRejected,
      reachableBefore: wasReachable.size,
      reachableAfter: nowReachable.size,
      // dealers (directory rows) with no reachable email once the cleanup is done, and the subset that has one today and would lose it
      noReachableAfter: noReachableAfterIds.length,
      lostReachable: lostReachableIds.length,
      lostReachableActive: activeIds ? lostReachableIds.filter((id) => activeIds.has(id)).length : null,
    },
  };
}

/** Restore statements for a plan: puts every touched contact_email back to its old value, guarded on the value the cleanup wrote. */
export function rollbackStatements(plan) {
  return [...plan.clear.map((c) => ({ id: c.id, writtenValue: null, restore: c.old })), ...plan.move.map((m) => ({ id: m.id, writtenValue: m.next, restore: m.old }))];
}
