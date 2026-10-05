---
type: choice
difficulty: medium
decks: [sample]
tags: [availability]
related: [push-gateway]
---

## Question

What does a **circuit breaker** do when calls to a dependency keep failing?

## Options

- [ ] Retries each failed call until it succeeds
- [x] Fails calls fast for a while instead of sending them, then lets a few through to test recovery
- [ ] Moves the dependency to another region
- [ ] Queues calls until the dependency is back

## Why

Failing fast frees the caller's threads and connections and stops piling load
on a struggling dependency. After a cool-down it goes "half-open" and lets
trial calls through.
