/** Step 3 wording for a dealership's contact state, kept in one place so the wizard and its tests agree. */

/** We have an email for the store but no person's name to put beside it. */
export const SALES_DESK_NO_NAME_LABEL = "Sales desk (no contact name on file)";

/** The store has no deliverable email at all — the buyer may know an advisor from a visit. */
export const NO_CONTACT_HELPER = "Went on a test drive? Enter the sales advisor's details below.";

/** The one field label/placeholder for a buyer-supplied advisor address (spelled "advisor" everywhere). */
export const ADVISOR_EMAIL_PLACEHOLDER = "Sales advisor email (optional)";

/** The label for any desk with no named person — same badge whether or not an unnamed email is on file. */
export function salesDeskLabel(_contactState?: "named" | "email_only" | "unverified" | "none"): string {
  return SALES_DESK_NO_NAME_LABEL;
}
