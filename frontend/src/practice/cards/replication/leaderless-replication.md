---
type: flip
difficulty: medium
tags: [consistency]
related: [shopping-cart]
---

## Front

How do reads and writes work in leaderless (Dynamo-style) replication?

## Back

There is no leader: the client (or a coordinator node) sends each write to
all N replicas and succeeds when **W** confirm; a read asks replicas and
waits for **R** answers, taking the newest version. Replicas that missed
writes are fixed by read repair and background anti-entropy. Any replica can
take writes, so one node down does not stop them.
