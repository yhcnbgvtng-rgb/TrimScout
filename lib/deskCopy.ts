/** Step 3 wording for a dealership's contact state, kept in one place so the wizard and its tests agree. */

/** We have an email for the store but no person's name to put beside it. */
export const SALES_DESK_NO_NAME_LABEL = "Sales desk (no contact name on file)";

/** The store has no deliverable email at all — the buyer may know an advisor from a visit. */
export const NO_CONTACT_HELPER = "Went on a test drive? Enter the sales advisor's details below.";

/** Shown when an email is on file but unassigned routing (ops hand-routes it) — no name to address it to. */
export const EMAIL_ONLY_HELPER = "No named sales contact on file yet — our team routes the request to this dealership's sales desk by hand, and every reply comes back through TrimScout. Have a sales adviser there? Add their email (optional) and it goes to them directly.";

/** The label for a desk with no named person: the no-name wording when an email is on file, else the generic desk. */
export function salesDeskLabel(contactState: "named" | "email_only" | "none" | undefined): string {
  return contactState === "email_only" ? SALES_DESK_NO_NAME_LABEL : "Dealership sales desk";
}
