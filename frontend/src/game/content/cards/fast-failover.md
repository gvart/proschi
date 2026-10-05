---
name: Fast failover
rarity: uncommon
topic: replication
learn: [failover-timeout, promoting-a-lagging-follower]
effect: failover
value: 0
---

## Text

A database primary failing over no longer interrupts writes, when it has a replica to promote.

## Why

Failover time is mostly detection and DNS: how long before anyone decides the primary is gone, and how long clients keep the old address. Tight health checks and a proxy that switches connections cut it from minutes to seconds.
