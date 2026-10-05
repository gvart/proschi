---
type: choice
difficulty: easy
---

## Question

One message makes the consumer fail every time it is processed. What should
happen to it?

## Options

- [ ] Retry it forever until it succeeds
- [x] After a few attempts, move it to a dead-letter queue for inspection
- [ ] Delete it silently
- [ ] Stop the consumer until someone fixes it

## Why

Retrying a "poison" message forever wastes work and, in an ordered queue,
blocks everything behind it. A dead-letter queue keeps it safe for a human or
a repair job, and an alert on that queue's size tells you it happened.
