---
type: flip
difficulty: medium
tags: [replication]
---

## Front

Active-active versus active-passive across two sites: what does each cost?

## Back

**Active-passive**: one site serves, the other waits. Data stays simple (one
writer), but the standby's capacity sits idle and failover takes time and may
fail when finally needed. **Active-active**: both serve, so failover is almost
instant and capacity is used, but each site needs headroom to take all the
load, and writes in both sites must be replicated or reconciled.
