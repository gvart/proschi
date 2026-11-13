---
type: flip
difficulty: hard
tags: [replication]
related: [multi-region-active-active]
---

## Front

Each region has its own cache in front of a database that replicates
between regions. A write lands in region A. How does region B's cache stop
serving the old value, without replicating the cache itself?

## Back

Region A sends B an **invalidation** for the key (Netflix's EVCache client
puts it on a queue to the other region). B deletes the entry, and its next
read falls through to its own database copy and fills the cache again.

## Why

If the invalidation arrives before the database replication, B's next read
can load the old row and cache it again. A short TTL or a delayed second
delete closes that window.
