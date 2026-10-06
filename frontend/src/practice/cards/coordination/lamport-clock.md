---
type: flip
difficulty: medium
tags: [consistency]
distinct-from: [version-vectors, vector-clock-compare]
---

## Front

How does a **Lamport clock** work, and what can it not tell you?

## Back

Each node keeps a counter, adds one for every event, and sends it with every
message; a receiver sets its counter to max(its own, received) + 1. If event
A happened before B, A's number is lower. But a lower number does **not**
mean A happened before B: it cannot tell causally related events from
concurrent ones.

## Why

Breaking ties by node id gives a total order that respects causality, which
is enough for things like ordering lock requests. To detect concurrent
writes, use vector clocks, which keep one counter per node.
