---
type: flip
difficulty: hard
tags: [replication]
---

## Front

How do you move a shard's data to a new machine without stopping writes?

## Back

**Copy a snapshot** to the new machine, then **replay the change log** (the
replication stream or CDC) until it is nearly caught up. Briefly pause writes
to that shard (or fence them), apply the last changes, **switch the routing
entry**, and resume. Verify, then delete the old copy.
