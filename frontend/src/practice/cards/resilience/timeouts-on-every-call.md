---
type: flip
difficulty: easy
tags: [networking]
---

## Front

Why must every remote call have a timeout, and how do you pick its value?

## Back

Without one, a hung dependency holds the caller's threads and connections
forever, until the caller fails too, and the failure cascades upstream. Set
it from the dependency's normal **p99 latency plus a margin**, and within the
time the caller itself has left.
