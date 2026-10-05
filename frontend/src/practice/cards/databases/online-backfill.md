---
type: flip
difficulty: medium
tags: [queues]
---

## Front

Why does a backfill of millions of rows run in small batches from a
background job, after dual writes have started, rather than as one
`UPDATE` before them?

## Back

One big `UPDATE` holds locks and floods the primary (and its replicas'
replication lag) while users are writing. Small, throttled batches leave
room for live traffic. Starting dual writes first means every row written
during the backfill already has the new shape, so the backfill only has to
cover rows written before, and it ends with nothing left behind.
