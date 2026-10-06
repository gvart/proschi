---
type: estimate
difficulty: hard
tags: [consistency, replication, estimation]
answer: 70
unit: ms
tolerance: 1.5
distinct-from: [raft-commit]
---

## Question

A 3-node Raft group has its leader in US East and followers in US West
(70 ms round trip from the leader) and Europe (80 ms). About how long does
the leader take to commit a write?

## Solution

A commit needs a majority, 2 of 3: the leader itself plus the first follower
to store the entry. That is one round trip to the nearest follower,
**about 70 ms**, plus disk writes. The slower European follower does not
delay commits, but if US West fails, every write waits 80 ms.

Numbers: [Numbers to know](../docs/numbers/#latency).
