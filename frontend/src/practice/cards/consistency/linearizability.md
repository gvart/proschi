---
type: flip
difficulty: medium
tags: [replication]
---

## Front

What does **linearizability** promise that eventual consistency does not,
and what does it cost?

## Back

Once a write completes, **every later read sees it** (or something newer), as
if there were a single copy of the data. It costs coordination on each
operation (extra round trips, a leader or a quorum), so higher latency, and
some requests must fail during a partition.
