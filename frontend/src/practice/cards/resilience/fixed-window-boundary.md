---
type: flip
difficulty: medium
related: [rate-limiter]
---

## Front

What is the flaw of a fixed-window rate limiter (100 requests per calendar
minute), and what fixes it?

## Back

A client can send 100 requests at 12:00:59 and 100 more at 12:01:00:
**200 in two seconds**, twice the intended rate. A **sliding window** (a log of
timestamps, or the cheaper sliding window counter that weights the previous
window) or a token bucket avoids the boundary burst.
