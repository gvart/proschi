---
type: choice
difficulty: medium
related: [rate-limiter]
---

## Question

Which rate-limiting algorithm lets a client burst up to N requests at once,
then continue at a steady average rate?

## Options

- [x] Token bucket
- [ ] Leaky bucket that queues requests and drains them at a fixed rate
- [ ] Fixed window counter
- [ ] Sliding log

## Why

Tokens refill at rate R up to a capacity of N; each request spends one. A
client that was idle has a full bucket and may burst, which suits real
traffic. A leaky bucket instead smooths output to a constant rate.
