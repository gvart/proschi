---
type: choice
difficulty: medium
tags: [consistency]
related: [rate-limiter]
---

## Question

A rate limiter runs as 10 replicas, and each keeps its own counter with a
limit of 100 requests a minute per client. What happens?

## Options

- [ ] The limit works exactly as intended
- [x] A client spread across replicas can get up to 1,000 requests a minute
- [ ] Each client is limited to 10 a minute
- [ ] Requests are rejected at random

## Why

Each replica sees only its share of a client's traffic. Keep the counter in a
shared store and use an atomic increment (such as Redis `INCR`) before the
decision, so two replicas cannot both admit the last request.
