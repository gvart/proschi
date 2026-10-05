---
type: flip
difficulty: hard
distinct-from: [saga-over-2pc]
---

## Front

What does a saga give up compared with one ACID transaction?

## Back

**Isolation**: other requests see the in-between states (the card is charged
but the order is not yet confirmed). Every step needs a **compensating
action**, designed and idempotent, and some steps cannot be undone (an email
was sent), so they go last or get a "sorry" follow-up.
