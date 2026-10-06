---
type: estimate
difficulty: hard
tags: [replication, estimation]
related: [discord-messages, github-repo-replication, distributed-kv]
answer: 90000
unit: replica operations/s
tolerance: 1.5
---

## Question

A store with N = 3 sends each write to all 3 replicas and each read to 2
replicas (R = 2). Clients make 10,000 writes/s and 30,000 reads/s. How many
operations per second do the replicas handle in total?

## Solution

Writes: 10,000 × 3 = 30,000. Reads: 30,000 × 2 = 60,000. Total =
**90,000 operations/s**, more than twice the 40,000 the clients send. Size
the replicas for that multiplied load.

Numbers: [Numbers to know](../docs/numbers/#servers-and-data-stores).
