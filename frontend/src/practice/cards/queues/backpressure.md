---
type: flip
difficulty: medium
tags: [resilience]
related: [job-queue]
---

## Front

What is **backpressure**, and why is an unbounded queue not a substitute for
it?

## Back

Backpressure is a signal from a component that is falling behind telling
upstream to **slow down**: a bounded queue that blocks or rejects, a 429, a
paused read. An unbounded queue just hides the overload until memory runs out
or messages wait so long they are useless.
