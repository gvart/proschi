---
type: choice
difficulty: easy
decks: [sample]
tags: [resilience]
related: [payments]
---

## Question

Which HTTP method is **not** idempotent by definition, so retrying it can
create a second resource?

## Options

- [ ] GET
- [ ] PUT
- [ ] DELETE
- [x] POST

## Why

PUT and DELETE leave the same state however often they are repeated. A
retried POST can charge a card twice unless the API takes an **idempotency
key** and remembers the requests it has already processed.
