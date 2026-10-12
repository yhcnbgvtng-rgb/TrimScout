/**
 * What may not be said in the buyer <-> dealer conversation: nothing that reveals who someone is. No email, no phone number in any
 * form (digits, spelled out, split across words), no social handle, messenger or street address, and no names (introductions,
 * titles, sign-offs). One rule set shared with the deals server (scrapers/lightsail-crawler/src/identityFilter.js). Returns a
 * short description of what was found ("a phone number", "a name", ...) or null. Prices, VINs and stock numbers stay allowed.
 */
import { findIdentityInfo as find } from "../scrapers/lightsail-crawler/src/identityFilter.js";

export const findIdentityInfo = find as (text: string) => string | null;
