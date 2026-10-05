---
type: flip
difficulty: medium
decks: [sample]
tags: [availability]
---

## Front

What does the CAP theorem actually force you to choose, and when?

## Back

Only **during a network partition**: either refuse some requests to stay
consistent (CP), or answer them with possibly stale data to stay available
(AP). When the network is healthy, you can have both.

## Why

PACELC adds the other half: even without a partition (Else), you trade
Latency against Consistency, for example by waiting for replicas or not.
