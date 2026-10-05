---
type: choice
difficulty: medium
tags: [consistency]
related: [ticket-booking, flash-sale]
---

## Question

Which decision should never be made from a cache alone?

## Options

- [ ] Which trending topics to show
- [x] Whether a seat is still free when a fan pays for it
- [ ] Which avatar URL to show for a user
- [ ] Which product page HTML to serve

## Why

A cache can be stale or lose writes, so two buyers could both see the seat
as free. The final check belongs in the database, as one conditional write;
the cache can still serve the seat map people browse.
