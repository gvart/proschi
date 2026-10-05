---
name: Circuit breaker
icon: unplug
rarity: uncommon
topic: resilience
learn: [circuit-breaker, timeouts-on-every-call]
effect: timeout
value: 100
---

## Text

A call to something that is down costs 100 ms instead of a 1 second timeout.

## Why

When a dependency fails, waiting for every call to time out ties up threads and blows the latency budget. A circuit breaker notices the failures and fails fast until the dependency recovers, so the fallback runs at once.
