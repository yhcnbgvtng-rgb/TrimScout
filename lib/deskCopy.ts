/** Step 3 wording for a dealership's contact state, kept in one place so the wizard and its tests agree. */

/** We have an email for the store but no person's name to put beside it. */
export const SALES_DESK_NO_NAME_LABEL = "Sales desk (no contact name on file)";

/** The store has no deliverable email at all — the buyer may know an advisor from a visit. */
export const NO_CONTACT_HELPER = "Went on a test drive? Enter the sales advisor's details below.";

/** The one field label/placeholder for a buyer-supplied advisor address (spelled "advisor" everywhere). */
export const ADVISOR_EMAIL_PLACEHOLDER = "Sales advisor email (optional)";

/** Step 4 / Step 3 label for a desk we can reach by a shared sales inbox: no person's name, but a contact is on file. */
export const SALES_CONTACT_ON_FILE_LABEL = "Sales contact on file";

/**
 * The label for a desk with no named person. A reachable rooftop (shared inbox on file, `rooftop_inbox`)
 * has a sales contact on file; "no contact name on file" is only true when the request goes to our routing queue (`unassigned`).
 */
export function salesDeskLabel(routing?: "named" | "adviser" | "rooftop_inbox" | "unassigned" | null): string {
  return routing === "unassigned" || routing == null ? SALES_DESK_NO_NAME_LABEL : SALES_CONTACT_ON_FILE_LABEL;
}
