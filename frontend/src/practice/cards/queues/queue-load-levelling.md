---
type: flip
difficulty: easy
tags: [resilience]
related: [notification-fanout]
---

## Front

Why put a queue between a bursty producer and a slower consumer?

## Back

The queue **absorbs bursts**: producers hand off work and return at once, and
consumers work through it at their own steady pace, so the consumer is sized
for the average load rather than the peak. The price is delay, and you must
watch the backlog so it does not grow without end.
