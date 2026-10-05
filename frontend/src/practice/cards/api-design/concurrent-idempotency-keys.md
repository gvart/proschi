---
type: choice
difficulty: hard
tags: [databases]
related: [payments]
distinct-from: [idempotency-key-design]
---

## Question

Two retries with the same idempotency key reach two servers at the same
moment. What stops both from charging the card?

## Options

- [ ] Each server checks a cache for the key and proceeds if it is absent
- [x] Inserting the key under a unique constraint before charging; the second insert fails
- [ ] Comparing the two requests' timestamps afterwards
- [ ] Nothing is needed; clients never retry that fast

## Why

"Check, then act" is a race: both servers see no key and both charge. An
atomic insert lets the database pick exactly one winner; the loser waits for
the winner's result or returns 409 Conflict.
