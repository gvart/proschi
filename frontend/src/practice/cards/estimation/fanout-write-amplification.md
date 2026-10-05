---
type: estimate
difficulty: easy
tags: [queues]
related: [news-feed]
answer: 1000000
unit: feed inserts/s
---

## Question

Users publish 5,000 posts a second, and an author has 200 followers on
average. With fan-out on write, how many feed-cache inserts per second does
that cause?

## Solution

Each post is copied into every follower's feed: 5,000 × 200 =
**1,000,000 inserts/s**. A modest write rate becomes the busiest path in the
system, which is why the fan-out runs on workers behind a queue.

Numbers: [Numbers to know](../docs/numbers/#servers-and-data-stores).
