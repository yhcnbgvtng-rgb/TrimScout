Volvo roster source: volvocars.com/us/dealers/dealer-locator/ ships the full US retailer list (280) inside the
Next.js RSC payload (`self.__next_f.push` inline scripts; look for `addressLine1`). volvocars.com is Akamai-walled
to curl, so the list was lifted from the rendered page in the Browser pane (2026-09-15) and saved as roster_raw.json.
Fields: partnerId, parmaPartnerCode, name, address, url, phoneNumbers, generalContactEmail, capabilities.
