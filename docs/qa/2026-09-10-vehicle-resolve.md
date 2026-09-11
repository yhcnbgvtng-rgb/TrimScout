# QA: broken vehicle resolve — before / after

Captured from the configure step (Step 1) on the dev server. The visual
screenshots were reviewed in-session; below are the exact on-screen text
captures and the Continue button's state, which is the thing QA reported.

## Before (main @ b7236b5)

Paste `1FMDE8AH9SLA26049` (a VIN with no released Ford sticker):

```
VEHICLE
Paste the dealership link to the exact vehicle, or its 17-character VIN. One car is required to continue.
[ 1FMDE8AH9SLA26049 ] [Add]
┌────────────────────────────────────────────────────────────────────────────┐
│ The factory build for VIN 1FMDE8AH9SLA26049 has not yet been released.     │
│ Dealer ad copy is not proof — status is unconfirmed.                       │
└────────────────────────────────────────────────────────────────────────────┘
+ Add additional vehicles to the offer package

Continue: DISABLED   ← no vehicle, no retry hint, no remove
```

A released Ford sticker whose headline the parser couldn't read produced
a vehicle with `year: 0`, accepted because only the VIN was checked, and
rendered as **"0 Ford F-150"**.

## After

Same paste, with a check-digit-valid VIN (`1FMDE8AH0SLA26049`):

```
VEHICLE
[ 1FMDE8AH0SLA26049 ] [Add]
┌────────────────────────────────────────────────────────────────────────────┐
│ ✓ 2025 Ford Bronco                       [UNCONFIRMED BUILD]  Factory build ✕ │
│   1FMDE8AH0SLA26049                                                        │
└────────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────────┐
│ Unconfirmed build — dealer listing only. No factory build sheet is         │
│ available for this VIN yet, so the details above come from the VIN and the │
│ dealer's page, and must-have options can't be matched. You can continue    │
│ with it, or remove it and try another link.                                │
└────────────────────────────────────────────────────────────────────────────┘
+ Add additional vehicles to the offer package

Continue: ENABLED
```

Released sticker (`1FMWK8JCXTGB47204`), unchanged behaviour but now labelled:

```
│ ✓ 2026 Ford Explorer Tremor · $64,705 MSRP   [FACTORY VERIFIED]  Factory build ✕ │
│   1FMWK8JCXTGB47204 · Route 23 Auto Mall, LLC                                    │
```

Failures are now explicit and clearable:

| Paste | Before | After |
|---|---|---|
| `htp:/broken` | sent to the Ford route; "Could not find a 17-character VIN in that paste." | `invalid_input` — "That's not a VIN or a link…" (no fetch) |
| `https://www.youtube.com/watch?v=…` | fetched; "Could not read a VIN from that page." | `unsupported_host` — "youtube.com isn't a dealer listing…" (no fetch) |
| same VIN twice | added twice | `duplicate` — "VIN … is already in your package." (no fetch) |
| released sticker, year unparsed | **"0 Ford F-150"** shown as a car | `parse_failed` — "We found VIN … but couldn't read the vehicle's details…" |
| unreleased sticker | dead end, Continue disabled | imports as dealer-listing-only, Continue enabled |

Every error banner now carries a **Clear** action; the confirmation row
carries **✕** to remove.
